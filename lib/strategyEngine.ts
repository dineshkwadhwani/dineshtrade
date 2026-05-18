// Strategy engine — produces buy recommendations.
// Reusable across the /api/strategy HTTP route (Manual mode) and the node-cron
// first-of-day tick (Auto mode). Pure server-side; no request context needed.

import watchlist from '@/config/watchlist.json'
import strategyCfg from '@/config/strategy.json'
import { getMarketBriefing } from './marketBriefing'

interface WatchlistStock { nse: string; name?: string; trades?: number }

export interface Recommendation {
  symbol: string
  name: string
  price: number
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
  const recs: Recommendation[] = []
  let skippedNoPrice = 0
  let skippedOffWatchlist = 0

  for (const r of topRecs) {
    const symbol = String(r.symbol || '').toUpperCase()
    if (!symbol) continue
    const inWatchlist = stockBySymbol.get(symbol)
    if (!inWatchlist) { skippedOffWatchlist++; continue }
    const price = parseNumber(r.cmp)
    if (!price || price <= 0) { skippedNoPrice++; continue }
    const perTrade = strategyCfg.capital.perTrade
    const qty = Math.floor(perTrade / price)
    if (qty < 1) continue

    const t1 = +(price * (1 + strategyCfg.targets.intraday_t1_pct / 100)).toFixed(2)
    const t2 = +(price * (1 + strategyCfg.targets.intraday_t2_pct / 100)).toFixed(2)
    const sl = +(price * 0.985).toFixed(2)

    recs.push({
      symbol,
      name: r.name || inWatchlist.name || symbol,
      price,
      action: (r.action || 'BUY').toUpperCase(),
      strategy: 'catalyst',
      source: r.source || 'AI briefing',
      reason: r.reason || `Featured in today's daily catalyst`,
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
    generatedAt: now,
  }
}
