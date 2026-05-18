// GET /api/positions?account=DINESH — today's positions for one account,
// enriched with the strategy tag derived from today's order book.
//
// Output per row:
//   symbol, qty, avgPrice, ltp, dayBuyQty, daySellQty, pnl, m2m, product,
//   tag       : 's1' | 's2' | 'manual' | 'pre' | 'mixed'
//   realized  : (rough) day_sell_qty × (sell_avg − buy_avg)  -- if we can derive
//   unrealized: qty × (ltp − avgPrice)
//
// `pre` = position we have no order tag for today (started the day already held).
// `mixed` = today had orders with conflicting tags (rare; reported but not
//           merged).

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { resolveAccountCreds, getPositions, getOrders, getQuotes, type KiteOrder } from '@/lib/kite'
import {
  STRATEGY_1_BUY_TAG, STRATEGY_1_TRANCHE1_TAG, STRATEGY_1_TRANCHE2_TAG,
} from '@/lib/strategy1'
import { STRATEGY_2_BUY_TAG, STRATEGY_2_SELL_TAG } from '@/lib/strategy2'

const MANUAL_TAG = 'dt-manual'

export type PositionTag = 's1' | 's2' | 'manual' | 'pre' | 'mixed'

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
  tag: PositionTag
  unrealized: number       // qty × (ltp − avgPrice)  -- 0 when fully closed
  realized: number         // best-effort closed-leg P&L for today
  orderIds: string[]       // today's COMPLETE order ids for this symbol
}

function classifyTag(tags: Set<string>): PositionTag {
  const s1 = [STRATEGY_1_BUY_TAG, STRATEGY_1_TRANCHE1_TAG, STRATEGY_1_TRANCHE2_TAG].some(t => tags.has(t))
  const s2 = [STRATEGY_2_BUY_TAG, STRATEGY_2_SELL_TAG].some(t => tags.has(t))
  const manual = tags.has(MANUAL_TAG)
  if (tags.size === 0) return 'pre'
  // Single-source-of-truth rules; if a symbol was traded by multiple strategies
  // today, surface 'mixed' so the user knows something unusual happened.
  if (s1 && !s2 && !manual) return 's1'
  if (s2 && !s1 && !manual) return 's2'
  if (manual && !s1 && !s2) return 'manual'
  return 'mixed'
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

  // Fetch today's quotes for every symbol we hold/traded so we can compute
  // today's % change from previous close. Best-effort — falls back to no
  // change-pct on the row if /quote fails (Kite plan tier or token issue).
  const allSymbols = Array.from(new Set([
    ...positions.net.map(p => p.tradingsymbol),
    ...positions.day.map(p => p.tradingsymbol),
  ]))
  const quotes = allSymbols.length > 0
    ? await getQuotes(creds, allSymbols).catch(() => ({} as Awaited<ReturnType<typeof getQuotes>>))
    : ({} as Awaited<ReturnType<typeof getQuotes>>)

  // Index today's filled orders by symbol → tags + ids + buy/sell-side avgs.
  const tagsBySymbol = new Map<string, Set<string>>()
  const orderIdsBySymbol = new Map<string, string[]>()
  // For best-effort realized P&L: track per-symbol sum(qty × price) on each side
  // from today's COMPLETE orders. realized = sellNotional − buyNotional × (min sold qty).
  const buyAggBySymbol = new Map<string, { qty: number; notional: number }>()
  const sellAggBySymbol = new Map<string, { qty: number; notional: number }>()

  for (const o of orders) {
    if (o.status !== 'COMPLETE') continue
    const sym = o.tradingsymbol.toUpperCase()
    if (o.tag) {
      const set = tagsBySymbol.get(sym) || new Set<string>()
      set.add(o.tag)
      tagsBySymbol.set(sym, set)
    }
    const ids = orderIdsBySymbol.get(sym) || []
    ids.push(o.order_id)
    orderIdsBySymbol.set(sym, ids)
    const filled = o.filled_quantity || o.quantity || 0
    const price = o.average_price || 0
    const bucket = o.transaction_type === 'BUY' ? buyAggBySymbol : sellAggBySymbol
    const cur = bucket.get(sym) || { qty: 0, notional: 0 }
    cur.qty += filled
    cur.notional += filled * price
    bucket.set(sym, cur)
  }

  // Prefer net (holds both intraday + carry positions held today). Fall back to
  // day only if net is empty — shouldn't happen on a normal account.
  const rawPositions = positions.net.length > 0 ? positions.net : positions.day
  const out: EnrichedPosition[] = rawPositions.map(p => {
    const sym = p.tradingsymbol.toUpperCase()
    const tags = tagsBySymbol.get(sym) || new Set<string>()
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
    const unrealized = p.quantity * ((p.last_price || 0) - (p.average_price || 0))
    const quote = quotes[`NSE:${sym}`]
    const liveLtp = Number(quote?.last_price) || p.last_price || 0
    const prevClose = Number((quote as any)?.ohlc?.close)
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
      pnl: p.pnl || 0,
      m2m: p.m2m || 0,
      tag: classifyTag(tags),
      unrealized,
      realized,
      orderIds: orderIdsBySymbol.get(sym) || [],
    }
  })

  // Drop fully flat rows that had no activity at all today (no order, no qty).
  const filtered = out.filter(p => p.qty !== 0 || p.dayBuyQty > 0 || p.daySellQty > 0)

  // Sort: open positions first (qty != 0), then by symbol.
  filtered.sort((a, b) => {
    const ao = a.qty !== 0 ? 0 : 1
    const bo = b.qty !== 0 ? 0 : 1
    if (ao !== bo) return ao - bo
    return a.symbol.localeCompare(b.symbol)
  })

  return NextResponse.json({ positions: filtered })
}
