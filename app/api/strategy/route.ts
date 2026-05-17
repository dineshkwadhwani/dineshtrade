import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { detectMarketMode, calculateTarget, STRATEGY_RULES } from '@/lib/strategy'
import watchlist from '@/config/watchlist.json'

export async function POST(req: NextRequest) {
  const token = cookies().get('dt_session')?.value
  if (!token || !(await verifySession(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { giftNiftyChangePct, quotes, brokerRecs, cashAvailable, todayBuys, todaySells } = await req.json()

  // 1. Detect market mode
  const mode = detectMarketMode(giftNiftyChangePct)

  if (mode === 'circuit') {
    return NextResponse.json({
      mode: 'circuit',
      recommendations: [],
      message: 'Nifty circuit breaker — no trades today. Market down 5%+.'
    })
  }

  // 2. Check limits
  const buysRemaining = STRATEGY_RULES.limits.maxBuysPerDay - (todayBuys || 0)
  const sellsRemaining = STRATEGY_RULES.limits.maxSellsPerDay - (todaySells || 0)
  const canBuy = buysRemaining > 0 && cashAvailable >= STRATEGY_RULES.capital.perTrade

  // 3. Build recommendations
  const recs: any[] = []
  const allStocks = [...(watchlist.listA || []), ...(watchlist.listB || [])]

  for (const stock of allStocks) {
    const quote = quotes?.[stock.nse]
    if (!quote) continue

    const price = quote.last_price || quote.close
    const ema20 = quote.ema20 // will be calculated separately
    const brokerRec = brokerRecs?.find((r: any) =>
      r.symbol?.toUpperCase() === stock.nse.toUpperCase()
    )

    if (mode === 'catalyst' && brokerRec) {
      // Strategy 2: Catalyst-based intraday
      recs.push({
        symbol: stock.nse,
        name: stock.name,
        price,
        action: 'BUY',
        strategy: 'catalyst',
        source: brokerRec.source,
        reason: brokerRec.reason || 'Broker recommendation',
        target1: calculateTarget(price, STRATEGY_RULES.strategy2.targetPct1),
        target2: calculateTarget(price, STRATEGY_RULES.strategy2.targetPct2),
        stopLoss: parseFloat((price * 0.985).toFixed(2)),
        suggestedQty: Math.floor(STRATEGY_RULES.capital.perTrade / price),
        confidence: 'high',
      })
    } else if (mode === 'dip' && ema20) {
      // Strategy 1: EMA dip buying
      const deviation = ((price - ema20) / ema20) * 100
      if (deviation <= -STRATEGY_RULES.strategy1.entryBelowEMAPct) {
        recs.push({
          symbol: stock.nse,
          name: stock.name,
          price,
          action: 'BUY',
          strategy: 'oscillator',
          source: 'EMA Signal',
          reason: `${Math.abs(deviation).toFixed(1)}% below 20-EMA — stretched`,
          target1: parseFloat((ema20 * 1.01).toFixed(2)),
          target2: parseFloat((ema20 * 1.025).toFixed(2)),
          stopLoss: parseFloat((price * 0.975).toFixed(2)),
          suggestedQty: Math.floor(STRATEGY_RULES.capital.perTrade / price),
          confidence: deviation <= -STRATEGY_RULES.strategy1.strongBuyBelowEMAPct ? 'high' : 'normal',
        })
      }
    }
  }

  // Sort by confidence, limit to top 5
  const sorted = recs
    .sort((a, b) => (b.confidence === 'high' ? 1 : 0) - (a.confidence === 'high' ? 1 : 0))
    .slice(0, 5)

  return NextResponse.json({
    mode,
    recommendations: sorted,
    limits: { buysRemaining, sellsRemaining, canBuy },
    cashAvailable,
    generatedAt: new Date().toISOString(),
  })
}
