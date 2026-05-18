// Pluggable AI-provider abstraction.
// Selects which LLM to call via env: AI_PROVIDER=anthropic|groq|gemini|openai
// Each provider reads its own API key + (optional) model override from env:
//   <PROVIDER>_AI_API_KEY  (required for the active provider)
//   <PROVIDER>_AI_MODEL    (optional; falls back to DEFAULTS below)

export type AIProvider = 'anthropic' | 'groq' | 'gemini' | 'openai'

export interface AICallOpts {
  prompt: string
  useWebSearch?: boolean
  maxTokens?: number
}

export interface AICallResult {
  ok: boolean
  text: string
  status?: number
  error?: string
  provider: AIProvider
  model: string
  webSearchUsed: boolean
}

const DEFAULTS: Record<AIProvider, { model: string; supportsWebSearch: boolean }> = {
  anthropic: { model: 'claude-sonnet-4-6',       supportsWebSearch: true },
  groq:      { model: 'llama-3.3-70b-versatile', supportsWebSearch: false },
  gemini:    { model: 'gemini-2.5-flash',        supportsWebSearch: true },
  openai:    { model: 'gpt-4o-mini',             supportsWebSearch: true },
}

export function getProvider(): AIProvider {
  const raw = (process.env.AI_PROVIDER || 'anthropic').toLowerCase()
  if (raw === 'anthropic' || raw === 'groq' || raw === 'gemini' || raw === 'openai') return raw
  throw new Error(`Invalid AI_PROVIDER="${process.env.AI_PROVIDER}". Must be one of: anthropic, groq, gemini, openai`)
}

export function getModel(provider: AIProvider): string {
  return process.env[`${provider.toUpperCase()}_AI_MODEL`] || DEFAULTS[provider].model
}

function getApiKey(provider: AIProvider): string {
  const envKey = `${provider.toUpperCase()}_AI_API_KEY`
  const key = process.env[envKey]
  if (!key) throw new Error(`Missing ${envKey} — set it in .env.local`)
  return key
}

export async function callAI(opts: AICallOpts): Promise<AICallResult> {
  const provider = getProvider()
  const model = getModel(provider)
  const useWebSearch = !!opts.useWebSearch && DEFAULTS[provider].supportsWebSearch

  switch (provider) {
    case 'anthropic': return callAnthropic(model, opts, useWebSearch)
    case 'openai':    return callOpenAI(model, opts, useWebSearch)
    case 'gemini':    return callGemini(model, opts, useWebSearch)
    case 'groq':      return callGroq(model, opts)
  }
}

async function callAnthropic(model: string, opts: AICallOpts, useWebSearch: boolean): Promise<AICallResult> {
  const body: any = {
    model,
    max_tokens: opts.maxTokens || 3000,
    messages: [{ role: 'user', content: opts.prompt }],
  }
  if (useWebSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }]

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey('anthropic'),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    return { ok: false, text: '', status: res.status, error: await res.text(), provider: 'anthropic', model, webSearchUsed: useWebSearch }
  }
  const data = await res.json()
  let text = ''
  for (const block of (data.content || [])) {
    if (block.type === 'text') text += block.text
  }
  return { ok: true, text, provider: 'anthropic', model, webSearchUsed: useWebSearch }
}

async function callOpenAI(model: string, opts: AICallOpts, useWebSearch: boolean): Promise<AICallResult> {
  // Responses API — has built-in web_search tool.
  const body: any = {
    model,
    input: opts.prompt,
    max_output_tokens: opts.maxTokens || 3000,
  }
  if (useWebSearch) body.tools = [{ type: 'web_search' }]

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey('openai')}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    return { ok: false, text: '', status: res.status, error: await res.text(), provider: 'openai', model, webSearchUsed: useWebSearch }
  }
  const data = await res.json()
  let text: string = typeof data.output_text === 'string' ? data.output_text : ''
  if (!text && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text' && typeof c.text === 'string') text += c.text
        }
      }
    }
  }
  return { ok: true, text, provider: 'openai', model, webSearchUsed: useWebSearch }
}

async function callGemini(model: string, opts: AICallOpts, useWebSearch: boolean): Promise<AICallResult> {
  const body: any = {
    contents: [{ parts: [{ text: opts.prompt }] }],
    generationConfig: {
      maxOutputTokens: opts.maxTokens || 3000,
      // Disable Gemini 2.5's internal "thinking" tokens — they consume the
      // output budget and aren't useful for structured-JSON tasks like this.
      thinkingConfig: { thinkingBudget: 0 },
    },
  }
  if (useWebSearch) body.tools = [{ google_search: {} }]

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': getApiKey('gemini'),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    return { ok: false, text: '', status: res.status, error: await res.text(), provider: 'gemini', model, webSearchUsed: useWebSearch }
  }
  const data = await res.json()
  // Gemini sometimes emits the answer as two identical parts when truncated;
  // take the last text part rather than concatenating all of them.
  const parts = data.candidates?.[0]?.content?.parts || []
  const textParts = parts.filter((p: any) => typeof p.text === 'string').map((p: any) => p.text as string)
  const text = textParts.length ? textParts[textParts.length - 1] : ''
  return { ok: true, text, provider: 'gemini', model, webSearchUsed: useWebSearch }
}

async function callGroq(model: string, opts: AICallOpts): Promise<AICallResult> {
  // Groq has no native web search — response is from model training data only.
  const body = {
    model,
    messages: [{ role: 'user', content: opts.prompt }],
    max_tokens: opts.maxTokens || 3000,
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey('groq')}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    return { ok: false, text: '', status: res.status, error: await res.text(), provider: 'groq', model, webSearchUsed: false }
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content || ''
  return { ok: true, text, provider: 'groq', model, webSearchUsed: false }
}
