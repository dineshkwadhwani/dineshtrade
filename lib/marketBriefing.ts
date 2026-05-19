// Shared helper that produces the daily market briefing JSON. Used by both
// /api/market (to render the Dashboard) and /api/strategy (to drive recs).
// Honors the USE_MOCK_MARKET env toggle.

import { MOCK_MARKET_DATA } from '@/lib/marketMock'
import { callAI } from '@/lib/ai'

export interface BriefingRec {
  symbol: string
  name?: string
  cmp?: string         // current market price as text, e.g. "910.45"
  action?: string
  source?: string
  reason?: string
}

export interface BriefingData {
  headline?: string
  globalIndices?: Array<{ name: string; value: string; change: string; direction: string }>
  giftNifty?: { value: string; change: string; direction: string; impliedOpen?: string; signal?: string }
  indiaOutlook?: { bias: string; expectedRange?: string; keyFactors?: string[]; support?: string; resistance?: string; strategy?: string }
  topRecommendations?: BriefingRec[]
}

export interface BriefingResult {
  ok: boolean
  data?: BriefingData
  source: 'mock' | 'ai' | 'error'
  provider?: string
  model?: string
  error?: string
  detail?: string
}

function buildPrompt(): string {
  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday:'long', day:'numeric', month:'long', year:'numeric' })
  return `Today is ${today}. You are a professional Indian equity market analyst. Search the web for latest data and provide a concise market briefing in JSON format ONLY (no markdown, no explanation outside JSON).

Return this exact JSON structure (every topRecommendations entry MUST include a numeric "cmp" — current market price in INR — sourced from the web):
{
  "globalIndices": [
    { "name": "S&P 500", "value": "7,444", "change": "+0.58%", "direction": "up" },
    { "name": "Nasdaq", "value": "26,402", "change": "+1.20%", "direction": "up" },
    { "name": "Dow Jones", "value": "49,693", "change": "-0.14%", "direction": "down" },
    { "name": "DAX", "value": "24,162", "change": "+0.87%", "direction": "up" },
    { "name": "FTSE 100", "value": "10,324", "change": "+0.58%", "direction": "up" },
    { "name": "Nikkei", "value": "63,455", "change": "+0.29%", "direction": "up" },
    { "name": "Hang Seng", "value": "26,576", "change": "+0.71%", "direction": "up" },
    { "name": "Kospi", "value": "7,906", "change": "+0.79%", "direction": "up" },
    { "name": "Brent Crude", "value": "$98.43", "change": "+3.10%", "direction": "down" }
  ],
  "giftNifty": { "value": "24,218", "change": "-0.26%", "direction": "down", "impliedOpen": "Gap down ~60 pts", "signal": "cautious" },
  "indiaOutlook": {
    "bias": "cautious-positive",
    "expectedRange": "24,180–24,260",
    "keyFactors": ["S&P 500 at ATH", "Nasdaq +1.2%"],
    "support": "24,100",
    "resistance": "24,600",
    "strategy": "Wait for 9:30 AM candle confirmation"
  },
  "topRecommendations": [
    { "symbol": "BAJFINANCE", "name": "Bajaj Finance", "cmp": "910.45", "action": "BUY", "source": "ICICI Direct", "reason": "20-EMA support, strong NBFC sector" },
    { "symbol": "RELIANCE", "name": "Reliance Industries", "cmp": "1421.30", "action": "BUY", "source": "HDFC Securities", "reason": "Oil price decline, telecom growth" }
  ],
  "headline": "Markets cautiously positive on global tech rally"
}`
}

// IST-day cache — the AI call is expensive (large prompt + websearch).
// EVERY caller of getMarketBriefing() gets the cached value within a single
// trading day, so polling endpoints (LiveTicker, Engine, etc.) can call this
// freely without burning API spend. Cache lives until the IST date rolls.
let briefingCache: { dateKey: string; result: BriefingResult } | null = null
let inFlight: Promise<BriefingResult> | null = null

function istDateKey(): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${ist.getFullYear()}-${String(ist.getMonth()+1).padStart(2,'0')}-${String(ist.getDate()).padStart(2,'0')}`
}

export function clearMarketBriefingCache(): void {
  briefingCache = null
  inFlight = null
}

export async function getMarketBriefing(): Promise<BriefingResult> {
  if (process.env.USE_MOCK_MARKET === 'true') {
    return { ok: true, data: MOCK_MARKET_DATA, source: 'mock' }
  }

  const today = istDateKey()
  if (briefingCache && briefingCache.dateKey === today) return briefingCache.result
  // De-duplicate concurrent callers — if a fetch is already running, all
  // callers await the same promise instead of each triggering their own.
  if (inFlight) return inFlight

  inFlight = (async (): Promise<BriefingResult> => {
    const r = await fetchBriefingFresh()
    if (r.ok) briefingCache = { dateKey: today, result: r }
    inFlight = null
    return r
  })()
  return inFlight
}

async function fetchBriefingFresh(): Promise<BriefingResult> {
  try {
    const result = await callAI({ prompt: buildPrompt(), useWebSearch: true, maxTokens: 3000 })
    if (!result.ok) {
      return { ok: false, source: 'error', provider: result.provider, error: `${result.provider} API ${result.status}`, detail: result.error?.slice(0, 500) }
    }
    // Strip common markdown fences some models wrap output in.
    const cleaned = result.text
      .replace(/^[\s\S]*?```(?:json)?\s*/i, '')
      .replace(/```[\s\S]*$/, '')
      .trim() || result.text

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { ok: false, source: 'error', provider: result.provider, error: 'No JSON in model output', detail: result.text.slice(0, 400) }
    }
    try {
      const parsed = JSON.parse(jsonMatch[0]) as BriefingData
      return { ok: true, data: parsed, source: 'ai', provider: result.provider, model: result.model }
    } catch (e) {
      return { ok: false, source: 'error', provider: result.provider, error: 'Model output is not valid JSON', detail: result.text.slice(0, 600) }
    }
  } catch (e) {
    return { ok: false, source: 'error', error: 'Network error', detail: String(e).slice(0, 200) }
  }
}
