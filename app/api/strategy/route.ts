import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'
import { cookies } from 'next/headers'
import watchlist from '@/config/watchlist.json'
import strategy from '@/config/strategy.json'
import { getMarketBriefing } from '@/lib/marketBriefing'

interface WatchlistStock { nse: string; name?: string; trades?: number }

interface Recommendation {
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

// Parse a percent string like "-1.26%" or "+0.5%" → number
function parsePct(s: string | undefined): number {
  if (!s) return 0
  const m = String(s).replace(/[%\s]/g, '').replace('+', '')
  const v = parseFloat(m)
  return isNaN(v) ? 0 : v
}

function parseNumber(s: string | undefined): number | null {
  if (s === undefined || s === null) return null
  const v = parseFloat(String(s).replace(/[,₹\s]/g, ''))
  return isNaN(v) ? null : v
}

export async function POST(req: NextRequest) {
  const token = cookies().get('dt_session')?.value
  if (!token || !(await verifySession(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 1. Get the daily market briefing (mock or live)
  const briefing = await getMarketBriefing()
  if (!briefing.ok || !briefing.data) {
    return NextResponse.json({
      mode: 'unknown',
      recommendations: [],
      message: `Could not fetch market briefing: ${briefing.error || 'unknown error'}`,
      generatedAt: new Date().toISOString(),
    }, { status: 502 })
  }

  // 2. Detect market mode from GIFT Nifty change %
  const giftChangePct = parsePct(briefing.data.giftNifty?.change)
  const circuitThreshold = strategy.limits.circuitBreakerPct  // e.g. -5

  let mode: 'catalyst' | 'dip' | 'circuit' = 'catalyst'
  if (giftChangePct <= circuitThreshold) mode = 'circuit'
  else if (giftChangePct <= -0.5) mode = 'dip'

  if (mode === 'circuit') {
    return NextResponse.json({
      mode,
      recommendations: [],
      message: `Circuit breaker — GIFT Nifty ${giftChangePct.toFixed(2)}%. No trades today.`,
      giftChangePct,
      generatedAt: new Date().toISOString(),
    })
  }

  if (mode === 'dip') {
    return NextResponse.json({
      mode,
      recommendations: [],
      message: 'Strategy 1 (Oscillator / EMA dip) needs the paid Kite Connect plan (₹500/mo) for historical-candle data. Upgrade Kite subscription to enable EMA-based entries on gap-down days.',
      giftChangePct,
      generatedAt: new Date().toISOString(),
    })
  }

  // 3. Strategy 2 — catalyst mode. Pull recs from briefing, intersect with watchlist.
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

    const perTrade = strategy.capital.perTrade
    const qty = Math.floor(perTrade / price)
    if (qty < 1) continue  // can't afford even 1 share at per-trade cap

    const t1 = +(price * (1 + strategy.targets.intraday_t1_pct / 100)).toFixed(2)
    const t2 = +(price * (1 + strategy.targets.intraday_t2_pct / 100)).toFixed(2)
    const sl = +(price * 0.985).toFixed(2)  // -1.5% stop

    recs.push({
      symbol,
      name: r.name || inWatchlist.name || symbol,
      price,
      action: (r.action || 'BUY').toUpperCase(),
      strategy: 'catalyst',
      source: r.source || 'AI briefing',
      reason: r.reason || 'Featured in today\'s daily catalyst',
      target1: t1,
      target2: t2,
      stopLoss: sl,
      suggestedQty: qty,
      confidence: 'normal',
    })
  }

  const buysRemaining = strategy.limits.maxBuysPerDay
  const sellsRemaining = strategy.limits.maxSellsPerDay

  return NextResponse.json({
    mode,
    recommendations: recs.slice(0, 5),
    limits: { buysRemaining, sellsRemaining },
    giftChangePct,
    counts: {
      briefingRecs: topRecs.length,
      skippedOffWatchlist,
      skippedNoPrice,
      produced: recs.length,
    },
    generatedAt: new Date().toISOString(),
  })
}
