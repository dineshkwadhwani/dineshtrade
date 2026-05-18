// Strategy engine — produces buy recommendations.
// Reusable across the /api/strategy HTTP route (Manual mode) and the node-cron
// first-of-day tick (Auto mode). Pure server-side; no request context needed.

import watchlist from '@/config/watchlist.json'
import strategyCfg from '@/config/strategy.json'
import { getMarketBriefing } from './marketBriefing'
import { getState } from './state'
import { resolveAccountCreds, getQuotes } from './kite'

interface WatchlistStock { nse: string; name?: string; trades?: number }

export type PriceSource = 'kite_live' | 'briefing_cmp'

export interface Recommendation {
  symbol: string
  name: string
  price: number
  priceSource: PriceSource    // 'kite_live' (preferred) or 'briefing_cmp' (fallback only)
  action: string
  strategy: string
  source: string
  reason: string
  target1: number
  target2: number
  stopLoss: number
  suggestedQty: number
  confidence: string
}

export type StrategyMode = 'catalyst' | 'dip' | 'circuit' | 'error'

export interface StrategyResult {
  mode: StrategyMode
  recommendations: Recommendation[]
  message?: string
  giftChangePct?: number
  counts?: {
    briefingRecs: number
    skippedOffWatchlist: number
    skippedNoPrice: number
    produced: number
  }
  priceSource?: PriceSource   // 'kite_live' if any rec was Kite-priced; 'briefing_cmp' if all fallback
  generatedAt: string
}

function parsePct(s: string | undefined): number {
  if (!s) return 0
  const v = parseFloat(String(s).replace(/[%\s]/g, '').replace('+', ''))
  return isNaN(v) ? 0 : v
}

function parseNumber(s: string | undefined): number | null {
  if (s === undefined || s === null) return null
  const v = parseFloat(String(s).replace(/[,₹\s]/g, ''))
  return isNaN(v) ? null : v
}

export async function generateRecommendations(): Promise<StrategyResult> {
  const now = new Date().toISOString()

  const briefing = await getMarketBriefing()
  if (!briefing.ok || !briefing.data) {
    return {
      mode: 'error',
      recommendations: [],
      message: `Could not fetch market briefing: ${briefing.error || 'unknown error'}`,
      generatedAt: now,
    }
  }

  const giftChangePct = parsePct(briefing.data.giftNifty?.change)
  const circuitThreshold = strategyCfg.limits.circuitBreakerPct

  let mode: StrategyMode = 'catalyst'
  if (giftChangePct <= circuitThreshold) mode = 'circuit'
  else if (giftChangePct <= -0.5) mode = 'dip'

  if (mode === 'circuit') {
    return {
      mode, recommendations: [], giftChangePct,
      message: `Circuit breaker — GIFT Nifty ${giftChangePct.toFixed(2)}%. No trades today.`,
      generatedAt: now,
    }
  }
  if (mode === 'dip') {
    return {
      mode, recommendations: [], giftChangePct,
      message: 'Strategy 1 (Oscillator / EMA dip) needs the paid Kite Connect plan for historical-candle data. Upgrade Kite subscription to enable EMA-based entries on gap-down days.',
      generatedAt: now,
    }
  }

  // Catalyst mode — broker picks from briefing × watchlist
  const allStocks: WatchlistStock[] = [
    ...(watchlist.listA || []),
    ...(watchlist.listB || []),
  ]
  const stockBySymbol = new Map(allStocks.map(s => [s.nse.toUpperCase(), s]))

  const topRecs = briefing.data.topRecommendations || []

  // Step 1: filter to symbols that are in our watchlist
  type Candidate = { rec: typeof topRecs[number]; symbol: string; inWatchlist: WatchlistStock }
  const candidates: Candidate[] = []
  let skippedOffWatchlist = 0
  for (const r of topRecs) {
    const symbol = String(r.symbol || '').toUpperCase()
    if (!symbol) continue
    const inWatchlist = stockBySymbol.get(symbol)
    if (!inWatchlist) { skippedOffWatchlist++; continue }
    candidates.push({ rec: r, symbol, inWatchlist })
  }

  // Step 2: batch-fetch live LTPs from Kite for every candidate. We use any
  // connected account's creds — the quote is the same regardless of who asks.
  // If no account is connected (or Kite call fails), we fall back to briefing CMP.
  let liveQuotes: Record<string, number> = {}
  let priceSourceForAll: PriceSource = 'briefing_cmp'
  if (candidates.length > 0) {
    try {
      const state = await getState()
      const firstAcc = Object.keys(state.kiteTokens)[0]
      if (firstAcc) {
        const creds = await resolveAccountCreds(firstAcc)
        if (creds.ok) {
          const quotes = await getQuotes(creds, candidates.map(c => c.symbol))
          for (const c of candidates) {
            const ltp = quotes[`NSE:${c.symbol}`]?.last_price
            if (ltp && ltp > 0) liveQuotes[c.symbol] = ltp
          }
          if (Object.keys(liveQuotes).length > 0) priceSourceForAll = 'kite_live'
        }
      }
    } catch (err) {
      console.warn('[strategyEngine] Kite quote enrichment failed, falling back to briefing CMP:', String(err).slice(0, 200))
    }
  }

  // Step 3: build recommendations using live LTPs (preferred) or briefing CMPs (fallback)
  const recs: Recommendation[] = []
  let skippedNoPrice = 0

  for (const c of candidates) {
    const live = liveQuotes[c.symbol]
    const fallback = parseNumber(c.rec.cmp)
    const price = live ?? fallback
    if (!price || price <= 0) { skippedNoPrice++; continue }
    const priceSource: PriceSource = live ? 'kite_live' : 'briefing_cmp'

    const perTrade = strategyCfg.capital.perTrade
    const qty = Math.floor(perTrade / price)
    if (qty < 1) continue

    const t1 = +(price * (1 + strategyCfg.targets.intraday_t1_pct / 100)).toFixed(2)
    const t2 = +(price * (1 + strategyCfg.targets.intraday_t2_pct / 100)).toFixed(2)
    const sl = +(price * 0.985).toFixed(2)

    recs.push({
      symbol: c.symbol,
      name: c.rec.name || c.inWatchlist.name || c.symbol,
      price,
      priceSource,
      action: (c.rec.action || 'BUY').toUpperCase(),
      strategy: 'catalyst',
      source: c.rec.source || 'AI briefing',
      reason: c.rec.reason || `Featured in today's daily catalyst`,
      target1: t1,
      target2: t2,
      stopLoss: sl,
      suggestedQty: qty,
      confidence: 'normal',
    })
  }

  return {
    mode,
    recommendations: recs.slice(0, 5),
    giftChangePct,
    counts: {
      briefingRecs: topRecs.length,
      skippedOffWatchlist,
      skippedNoPrice,
      produced: recs.length,
    },
    priceSource: priceSourceForAll,
    generatedAt: now,
  }
}
