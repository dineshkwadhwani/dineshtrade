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
import { listPositions } from '@/lib/positions'
import { getStrategies } from '@/lib/strategyConfig'
import { readJournalDay, istDateString, type JournalRecord, type TradeRecord } from '@/lib/journal'

// Live broker data — every request must hit Kite fresh, never serve from cache.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export interface EnrichedPosition {
  symbol: string
  exchange: string
  product: string
  strategyId?: string      // inferred from latest today's BUY tag (dt-*)
  strategyName?: string
  strategyColor?: string
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
  journalReconciled?: boolean  // avgPrice/strategy/realized came from the journal's trade record, not Kite — don't second-guess it
  orderIds: string[]       // today's COMPLETE order ids for this symbol
}

export interface ClosedTodaySummary {
  symbol: string
  closedQty: number
  buyVwap: number
  sellVwap: number
  realized: number
}

function strategyIdFromTag(tag?: string): string | undefined {
  if (!tag) return 'accumulator'
  if (tag === 'dt-manual' || tag === 'manual') return 'accumulator'
  if (!tag.startsWith('dt-')) return 'accumulator'
  let sid = tag.slice(3).replace(/-(t1|t2|exit)$/, '')
  if (sid === 's1') sid = 'accumulator'
  else if (sid === 's2') sid = 'catalyst'
  return sid || 'accumulator'
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
  const trackedPositions = await listPositions({ account }).catch(() => [])
  const trackedStrategyBySymbol = new Map(
    trackedPositions.map(p => [p.symbol.toUpperCase(), p.strategyId]),
  )
  const strategiesById = new Map(getStrategies().map(s => [s.id, s]))

  // Kite's two endpoints disagree on price:
  //   - /portfolio/positions returns p.last_price that's updated when the
  //     POSITION changes (every few seconds at best, often stale by 20–30 sec)
  //   - /quote returns the live tick (same source the Watchlist uses)
  // We use /quote for the LTP shown on this page and RECOMPUTE pnl from it,
  // so the same row shows live price + matching P&L, and stays in sync with
  // Watchlist's price. Without /quote the LTP would lag Watchlist on the same
  // symbol by ~20 rupees, which is what the user was seeing.
  const completedOrders = orders.filter(o => o.status === 'COMPLETE')
  // Today's completed BUY+SELL trades from the bot's own journal — ground truth
  // for what actually executed, independent of Kite's Positions/Orders view.
  // A SELL of a lot bought on a PRIOR day (e.g. a settled CNC holding exited
  // today) doesn't create a same-day Kite "day" position and its order alone
  // doesn't carry the original multi-day-old buy price, so relying on Kite
  // alone can drop the row entirely or show ₹0 entry price / ₹0 realized P&L.
  const todaysTrades = (await readJournalDay(istDateString()).catch(() => [] as JournalRecord[]))
    .filter((r): r is TradeRecord => r.type === 'trade' && r.account.toUpperCase() === account.toUpperCase())
  const allSymbols = Array.from(new Set([
    ...positions.day.map(p => p.tradingsymbol.toUpperCase()),
    ...completedOrders.map(o => o.tradingsymbol.toUpperCase()),
    ...todaysTrades.map(t => t.symbol.toUpperCase()),
  ]))
  const quotes = allSymbols.length > 0
    ? await getQuotes(creds, allSymbols).catch(() => ({} as Awaited<ReturnType<typeof getQuotes>>))
    : ({} as Awaited<ReturnType<typeof getQuotes>>)

  // Index today's filled orders by symbol → ids + buy/sell-side avgs.
  const orderIdsBySymbol = new Map<string, string[]>()
  const lastOrderBySymbol = new Map<string, KiteOrder>()
  const latestBuyOrderBySymbol = new Map<string, KiteOrder>()
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
    if (o.transaction_type === 'BUY') {
      const prev = latestBuyOrderBySymbol.get(sym)
      if (!prev || o.order_timestamp > prev.order_timestamp) latestBuyOrderBySymbol.set(sym, o)
    }
    const bucket = o.transaction_type === 'BUY' ? buyAggBySymbol : sellAggBySymbol
    const cur = bucket.get(sym) || { qty: 0, notional: 0 }
    cur.qty += filled
    cur.notional += filled * price
    bucket.set(sym, cur)
  }

  const openRows: EnrichedPosition[] = positions.day.map(p => {
    const sym = p.tradingsymbol.toUpperCase()
    const trackedStrategyId = trackedStrategyBySymbol.get(sym)
    // Prefer latest BUY tag for long attribution, but for short positions (or
    // symbols without a BUY today) fall back to the latest completed order tag.
    const strategyId = trackedStrategyId || strategyIdFromTag(
      latestBuyOrderBySymbol.get(sym)?.tag || lastOrderBySymbol.get(sym)?.tag,
    )
    const strategyMeta = strategyId ? strategiesById.get(strategyId) : undefined
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
      strategyId,
      strategyName: strategyMeta?.name,
      strategyColor: strategyMeta?.color,
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
    const trackedStrategyId = trackedStrategyBySymbol.get(sym)
    const strategyId = trackedStrategyId || strategyIdFromTag(
      latestBuyOrderBySymbol.get(sym)?.tag || lastOrderBySymbol.get(sym)?.tag,
    )
    const strategyMeta = strategyId ? strategiesById.get(strategyId) : undefined

    closedOrderOnlyRows.push({
      symbol: sym,
      exchange: lastOrder?.exchange || 'NSE',
      product: lastOrder?.product || 'CNC',
      strategyId,
      strategyName: strategyMeta?.name,
      strategyColor: strategyMeta?.color,
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

  // Reconcile against the journal's trade records. Kite's day position is
  // PER SYMBOL, not per-lot/per-trade — a symbol can have multiple distinct
  // closed-today trades (e.g. two different lots, under two different
  // strategies, both sold out of holdings with no offsetting buy) that Kite
  // nets into a SINGLE row that can't correctly represent even one of them,
  // let alone both (e.g. two -15 sells net to one -30 "row", which reads like
  // an open short position, not two closed lots). Rather than patch that one
  // row in place, drop it for any symbol the journal has trade coverage for
  // today, and rebuild one row per trade directly from the journal — ground
  // truth for what actually closed, however many trades there were.
  const tradesBySymbol = new Map<string, TradeRecord[]>()
  for (const trade of todaysTrades) {
    const sym = trade.symbol.toUpperCase()
    const list = tradesBySymbol.get(sym) || []
    list.push(trade)
    tradesBySymbol.set(sym, list)
  }
  for (const [sym, trades] of Array.from(tradesBySymbol.entries())) {
    const orderIds = new Set(trades.map(t => t.orderIdSell).filter((id): id is string => !!id))
    for (let i = filtered.length - 1; i >= 0; i--) {
      if (filtered[i].symbol === sym && filtered[i].orderIds.some(id => orderIds.has(id))) {
        filtered.splice(i, 1)
      }
    }
    for (const trade of trades) {
      const strategyMeta = strategiesById.get(trade.strategy)
      const quote = quotes[`NSE:${sym}`]
      const liveLtp = Number(quote?.last_price) || trade.exitPrice
      const prevClose = Number((quote as any)?.ohlc?.close) || 0
      const dayChangePct = prevClose > 0 && liveLtp > 0 ? ((liveLtp - prevClose) / prevClose) * 100 : undefined
      filtered.push({
        symbol: sym,
        exchange: 'NSE',
        product: 'CNC',
        strategyId: trade.strategy,
        strategyName: strategyMeta?.name,
        strategyColor: strategyMeta?.color,
        qty: 0,
        avgPrice: trade.entryPrice,
        ltp: liveLtp,
        dayChangePct,
        dayBuyQty: 0,
        daySellQty: trade.qty,
        pnl: trade.pnlRupees,
        m2m: 0,
        unrealized: 0,
        realized: trade.pnlRupees,
        orderIds: trade.orderIdSell ? [trade.orderIdSell] : [],
        journalReconciled: true,
      })
    }
  }

  // Also make sure any still-OPEN lot bought TODAY gets its own row. Kite's day
  // position is per-SYMBOL, not per-lot: if a symbol has both an old lot sold
  // AND a brand new lot bought today (possibly under a different strategy),
  // Kite nets them into a single row that can only reflect one side — and the
  // journal reconciliation above already claimed that row for the closed lot.
  // The position store is authoritative for per-lot state regardless of what
  // Kite's aggregated view shows, so use it directly for anything not already
  // visibly represented.
  const today = istDateString()
  for (const p of trackedPositions) {
    for (const lot of p.lots || []) {
      if (lot.remainingQty <= 0) continue
      if (istDateString(new Date(lot.boughtAt)) !== today) continue
      const sym = p.symbol.toUpperCase()
      const alreadyRepresented = filtered.some(row =>
        row.symbol === sym && row.qty === lot.remainingQty && Math.abs(row.avgPrice - lot.entryPrice) <= 0.01)
      if (alreadyRepresented) continue
      const lotStrategyId = lot.strategyId || p.strategyId
      const strategyMeta = strategiesById.get(lotStrategyId)
      const quote = quotes[`NSE:${sym}`]
      const liveLtp = Number(quote?.last_price) || lot.entryPrice
      const prevClose = Number((quote as any)?.ohlc?.close) || 0
      const dayChangePct = prevClose > 0 && liveLtp > 0 ? ((liveLtp - prevClose) / prevClose) * 100 : undefined
      filtered.push({
        symbol: sym,
        exchange: 'NSE',
        product: 'CNC',
        strategyId: lotStrategyId,
        strategyName: strategyMeta?.name,
        strategyColor: strategyMeta?.color,
        qty: lot.remainingQty,
        avgPrice: lot.entryPrice,
        ltp: liveLtp,
        dayChangePct,
        dayBuyQty: lot.remainingQty,
        daySellQty: 0,
        pnl: lot.remainingQty * (liveLtp - lot.entryPrice),
        m2m: 0,
        unrealized: lot.remainingQty * (liveLtp - lot.entryPrice),
        realized: 0,
        orderIds: [],
        journalReconciled: true,
      })
    }
  }

  const closedToday: ClosedTodaySummary[] = []
  for (const sym of allSymbols) {
    const buyAgg = buyAggBySymbol.get(sym)
    const sellAgg = sellAggBySymbol.get(sym)
    if (!buyAgg || !sellAgg || buyAgg.qty <= 0 || sellAgg.qty <= 0) continue
    const closedQty = Math.min(buyAgg.qty, sellAgg.qty)
    if (closedQty <= 0) continue
    const buyVwap = buyAgg.notional / buyAgg.qty
    const sellVwap = sellAgg.notional / sellAgg.qty
    closedToday.push({
      symbol: sym,
      closedQty,
      buyVwap,
      sellVwap,
      realized: closedQty * (sellVwap - buyVwap),
    })
  }

  filtered.sort((a, b) => a.symbol.localeCompare(b.symbol))
  closedToday.sort((a, b) => b.closedQty - a.closedQty || a.symbol.localeCompare(b.symbol))

  return NextResponse.json({ positions: filtered, closedToday, fetchedAt: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
