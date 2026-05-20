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
  return `Today is ${today}. You are a professional Indian equity market analyst.

CRITICAL — Read this before answering:
- Every value in the schema below is a PLACEHOLDER (wrapped in <…>). Do NOT echo the placeholders.
- Search the web for today's actual data (overnight US session close, Asian session prints, GIFT Nifty futures level, Indian broker calls published today).
- Replace every <…> placeholder with the real value you found.
- The "topRecommendations" entries must be DIFFERENT stocks and DIFFERENT reasons each day, sourced from today's broker calls / research notes — not a fixed list.
- Output JSON only — no markdown fences, no commentary outside the JSON object.

Schema (replace every <…> with today's researched value):
{
  "globalIndices": [
    { "name": "S&P 500",     "value": "<index_level>", "change": "<signed_pct>", "direction": "<up|down|flat>" },
    { "name": "Nasdaq",      "value": "<index_level>", "change": "<signed_pct>", "direction": "<up|down|flat>" },
    { "name": "Dow Jones",   "value": "<index_level>", "change": "<signed_pct>", "direction": "<up|down|flat>" },
    { "name": "DAX",         "value": "<index_level>", "change": "<signed_pct>", "direction": "<up|down|flat>" },
    { "name": "FTSE 100",    "value": "<index_level>", "change": "<signed_pct>", "direction": "<up|down|flat>" },
    { "name": "Nikkei",      "value": "<index_level>", "change": "<signed_pct>", "direction": "<up|down|flat>" },
    { "name": "Hang Seng",   "value": "<index_level>", "change": "<signed_pct>", "direction": "<up|down|flat>" },
    { "name": "Kospi",       "value": "<index_level>", "change": "<signed_pct>", "direction": "<up|down|flat>" },
    { "name": "Brent Crude", "value": "<usd_price>",   "change": "<signed_pct>", "direction": "<up|down|flat>" }
  ],
  "giftNifty": {
    "value":       "<futures_level>",
    "change":      "<signed_pct>",
    "direction":   "<up|down|flat>",
    "impliedOpen": "<gap up|gap down|flat> ~<N> pts",
    "signal":      "<bullish|bearish|cautious|neutral>"
  },
  "indiaOutlook": {
    "bias":          "<positive|negative|cautious-positive|cautious-negative|neutral>",
    "expectedRange": "<nifty_low>–<nifty_high>",
    "keyFactors":    ["<factor_today_1>", "<factor_today_2>", "<factor_today_3>"],
    "support":       "<nifty_support_level>",
    "resistance":    "<nifty_resistance_level>",
    "strategy":      "<one_line_trading_strategy_for_today>"
  },
  "topRecommendations": [
    { "symbol": "<NSE_TRADINGSYMBOL>", "name": "<full_company_name>", "cmp": "<live_price_inr>", "action": "BUY", "source": "<broker_or_publication_name>", "reason": "<short_reason_from_today_broker_call>" },
    { "symbol": "<NSE_TRADINGSYMBOL>", "name": "<full_company_name>", "cmp": "<live_price_inr>", "action": "BUY", "source": "<broker_or_publication_name>", "reason": "<short_reason_from_today_broker_call>" },
    { "symbol": "<NSE_TRADINGSYMBOL>", "name": "<full_company_name>", "cmp": "<live_price_inr>", "action": "BUY", "source": "<broker_or_publication_name>", "reason": "<short_reason_from_today_broker_call>" }
  ],
  "headline": "<one_sentence_summary_of_today_market_mood>"
}

If ANY <…> placeholder remains in your output, the response is invalid. Cmp must be a numeric string in INR sourced from a live quote today. Reasons must reference today's events, not generic themes.`
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
