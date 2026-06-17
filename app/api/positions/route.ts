// GET /api/positions?account=DINESH — today's broker positions for one account.
//
// Output per row:
//   symbol, qty, avgPrice, ltp, dayBuyQty, daySellQty, pnl, m2m, product,
//   realized  : (rough) day_sell_qty × (sell_avg − buy_avg)  -- if we can derive
//   unrealized: qty × (ltp − avgPrice)

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { resolveAccountCreds, getPositions, getOrders, getQuotes, type KiteOrder } from '@/lib/kite'

// Live broker data — every request must hit Kite fresh, never serve from cache.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export interface EnrichedPosition {
  symbol: string
  exchange: string
  product: string
  qty: number
  avgPrice: number
  ltp: number
  dayChangePct?: number    // today's % change from previous close (live, may be missing if /quote fails)
  dayBuyQty: number
  daySellQty: number
  pnl: number
  m2m: number
  unrealized: number       // qty × (ltp − avgPrice)  -- 0 when fully closed
  realized: number         // best-effort closed-leg P&L for today
  orderIds: string[]       // today's COMPLETE order ids for this symbol
}

export async function GET(req: Request) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const account = url.searchParams.get('account')
  if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 })

  const creds = await resolveAccountCreds(account)
  if (!creds.ok) return NextResponse.json({ error: creds.error }, { status: 400 })

  const [positions, orders] = await Promise.all([
    getPositions(creds).catch(() => ({ day: [], net: [] })),
    getOrders(creds).catch(() => [] as KiteOrder[]),
  ])

  // Kite's two endpoints disagree on price:
  //   - /portfolio/positions returns p.last_price that's updated when the
  //     POSITION changes (every few seconds at best, often stale by 20–30 sec)
  //   - /quote returns the live tick (same source the Watchlist uses)
  // We use /quote for the LTP shown on this page and RECOMPUTE pnl from it,
  // so the same row shows live price + matching P&L, and stays in sync with
  // Watchlist's price. Without /quote the LTP would lag Watchlist on the same
  // symbol by ~20 rupees, which is what the user was seeing.
  const completedOrders = orders.filter(o => o.status === 'COMPLETE')
  const allSymbols = Array.from(new Set([
    ...positions.day.map(p => p.tradingsymbol.toUpperCase()),
    ...completedOrders.map(o => o.tradingsymbol.toUpperCase()),
  ]))
  const quotes = allSymbols.length > 0
    ? await getQuotes(creds, allSymbols).catch(() => ({} as Awaited<ReturnType<typeof getQuotes>>))
    : ({} as Awaited<ReturnType<typeof getQuotes>>)

  // Index today's filled orders by symbol → ids + buy/sell-side avgs.
  const orderIdsBySymbol = new Map<string, string[]>()
  const lastOrderBySymbol = new Map<string, KiteOrder>()
  // For best-effort realized P&L: track per-symbol sum(qty × price) on each side
  // from today's COMPLETE orders. realized = sellNotional − buyNotional × (min sold qty).
  const buyAggBySymbol = new Map<string, { qty: number; notional: number }>()
  const sellAggBySymbol = new Map<string, { qty: number; notional: number }>()

  for (const o of completedOrders) {
    const sym = o.tradingsymbol.toUpperCase()
    const ids = orderIdsBySymbol.get(sym) || []
    ids.push(o.order_id)
    orderIdsBySymbol.set(sym, ids)
    lastOrderBySymbol.set(sym, o)
    const filled = o.filled_quantity || o.quantity || 0
    const price = o.average_price || 0
    const bucket = o.transaction_type === 'BUY' ? buyAggBySymbol : sellAggBySymbol
    const cur = bucket.get(sym) || { qty: 0, notional: 0 }
    cur.qty += filled
    cur.notional += filled * price
    bucket.set(sym, cur)
  }

  const openRows: EnrichedPosition[] = positions.day.map(p => {
    const sym = p.tradingsymbol.toUpperCase()
    const buyAgg = buyAggBySymbol.get(sym)
    const sellAgg = sellAggBySymbol.get(sym)
    // Closed-leg qty = min of buys and sells filled today. Their VWAP-of-VWAPs gives
    // an approximate realised number — Kite's true P&L includes carry too, but for
    // an intraday view this is a fair signal.
    let realized = 0
    if (buyAgg && sellAgg && buyAgg.qty > 0 && sellAgg.qty > 0) {
      const closedQty = Math.min(buyAgg.qty, sellAgg.qty)
      const buyVwap = buyAgg.notional / buyAgg.qty
      const sellVwap = sellAgg.notional / sellAgg.qty
      realized = closedQty * (sellVwap - buyVwap)
    }
    // LTP — prefer /quote (live tick) over /portfolio/positions (stale ~20s)
    const quote = quotes[`NSE:${sym}`]
    const liveLtp = Number(quote?.last_price) || p.last_price || 0
    // Unrealized P&L recomputed from the LIVE LTP so the row stays internally
    // consistent (we never expose Kite's p.pnl which is tied to the stale price).
    const avg = p.average_price || 0
    const unrealized = p.quantity * (liveLtp - avg)
    // prevClose for today's %: /quote's ohlc.close is the most live source;
    // fall back to p.close_price only if /quote didn't return ohlc.
    const prevClose = Number((quote as any)?.ohlc?.close) || p.close_price || 0
    const dayChangePct = prevClose > 0 && liveLtp > 0 ? ((liveLtp - prevClose) / prevClose) * 100 : undefined
    return {
      symbol: sym,
      exchange: p.exchange,
      product: p.product,
      qty: p.quantity,
      avgPrice: p.average_price || 0,
      ltp: liveLtp,
      dayChangePct,
      dayBuyQty: p.day_buy_quantity || 0,
      daySellQty: p.day_sell_quantity || 0,
      pnl: unrealized + realized,   // live + same source as the row's other numbers
      m2m: p.m2m || 0,
      unrealized,
      realized,
      orderIds: orderIdsBySymbol.get(sym) || [],
    }
  })

  const positionSymbols = new Set(openRows.map(row => row.symbol))
  const closedOrderOnlyRows: EnrichedPosition[] = []
  for (const sym of allSymbols) {
    if (positionSymbols.has(sym)) continue
    const buyAgg = buyAggBySymbol.get(sym)
    const sellAgg = sellAggBySymbol.get(sym)
    if (!buyAgg && !sellAgg) continue

    let realized = 0
    if (buyAgg && sellAgg && buyAgg.qty > 0 && sellAgg.qty > 0) {
      const closedQty = Math.min(buyAgg.qty, sellAgg.qty)
      const buyVwap = buyAgg.notional / buyAgg.qty
      const sellVwap = sellAgg.notional / sellAgg.qty
      realized = closedQty * (sellVwap - buyVwap)
    }

    const quote = quotes[`NSE:${sym}`]
    const liveLtp = Number(quote?.last_price) || 0
    const prevClose = Number((quote as any)?.ohlc?.close) || 0
    const dayChangePct = prevClose > 0 && liveLtp > 0 ? ((liveLtp - prevClose) / prevClose) * 100 : undefined
    const lastOrder = lastOrderBySymbol.get(sym)
    const buyVwap = buyAgg && buyAgg.qty > 0 ? buyAgg.notional / buyAgg.qty : 0

    closedOrderOnlyRows.push({
      symbol: sym,
      exchange: lastOrder?.exchange || 'NSE',
      product: lastOrder?.product || 'CNC',
      qty: 0,
      avgPrice: buyVwap,
      ltp: liveLtp,
      dayChangePct,
      dayBuyQty: buyAgg?.qty || 0,
      daySellQty: sellAgg?.qty || 0,
      pnl: realized,
      m2m: 0,
      unrealized: 0,
      realized,
      orderIds: orderIdsBySymbol.get(sym) || [],
    })
  }

  const filtered = [...openRows, ...closedOrderOnlyRows]

  filtered.sort((a, b) => a.symbol.localeCompare(b.symbol))

  return NextResponse.json({ positions: filtered, fetchedAt: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
