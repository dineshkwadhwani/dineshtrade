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

// Live broker data — every request must hit Kite fresh, never serve from cache.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const MANUAL_TAG = 'dt-manual'

// Position-pill descriptor. Replaces the old fixed-vocabulary tag with a
// strategy-aware shape so any user-created strategy can render its own
// display name + color on the Positions row.
export interface PositionTag {
  kind: 'strategy' | 'manual' | 'pre' | 'mixed'
  strategyId?: string      // present when kind === 'strategy'
  label: string            // short label shown in the pill
  color: string            // hex/rgba — pill background/text color
}

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

// Build a tag from (1) the position store's strategyId (long-term ownership)
// and (2) today's Kite order tags (today's activity). Store wins when present;
// order tags drive the legacy fallbacks. Strategy lookup gives us display +
// color for any registered strategy id.
function classifyTag(
  symbol: string,
  todaysOrderTags: Set<string>,
  positionStoreStrategyId: string | null,
  strategiesById: Map<string, { name: string; color: string }>,
): PositionTag {
  // Position store record exists → that's authoritative for long-term ownership
  if (positionStoreStrategyId) {
    const s = strategiesById.get(positionStoreStrategyId)
    return {
      kind: 'strategy',
      strategyId: positionStoreStrategyId,
      label: s?.name?.slice(0, 12) || positionStoreStrategyId,
      color: s?.color || '#c9a84c',
    }
  }
  // No store record — classify from today's order tags
  const hasManual = todaysOrderTags.has(MANUAL_TAG)
  // Legacy tags + new dt-${id} tags
  const dtPrefixed = Array.from(todaysOrderTags).filter(t => t.startsWith('dt-') && t !== MANUAL_TAG)
  const strategyIdsFromTags = new Set<string>()
  for (const t of dtPrefixed) {
    let sid = t.slice(3).replace(/-(t1|t2|exit)$/, '')   // strip tranche/exit suffix
    if (sid === 's1') sid = 'accumulator'
    else if (sid === 's2') sid = 'catalyst'
    strategyIdsFromTags.add(sid)
  }
  if (strategyIdsFromTags.size === 0 && !hasManual) {
    return { kind: 'pre', label: 'OOS', color: 'rgba(255,255,255,0.5)' }
  }
  if (strategyIdsFromTags.size === 1 && !hasManual) {
    const sid = Array.from(strategyIdsFromTags)[0]
    const s = strategiesById.get(sid)
    return { kind: 'strategy', strategyId: sid, label: s?.name?.slice(0, 12) || sid, color: s?.color || '#c9a84c' }
  }
  if (strategyIdsFromTags.size === 0 && hasManual) {
    return { kind: 'manual', label: 'MANUAL', color: '#a78bfa' }
  }
  return { kind: 'mixed', label: 'MIXED', color: '#f59e0b' }
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

  const [positions, orders, posStore] = await Promise.all([
    getPositions(creds).catch(() => ({ day: [], net: [] })),
    getOrders(creds).catch(() => [] as KiteOrder[]),
    (async () => {
      // Load the unified position store + strategy map for tag derivation.
      // Best-effort: if either fails, the tag falls through to legacy logic.
      try {
        const [{ listPositions }, { getStrategies }] = await Promise.all([
          import('@/lib/positions'),
          import('@/lib/strategyConfig'),
        ])
        const rows = await listPositions({ account })
        const byKey = new Map<string, string>()
        for (const r of rows) byKey.set(r.symbol.toUpperCase(), r.strategyId)
        const strategiesById = new Map<string, { name: string; color: string }>()
        for (const s of getStrategies()) strategiesById.set(s.id, { name: s.name, color: s.color })
        return { byKey, strategiesById }
      } catch { return { byKey: new Map<string, string>(), strategiesById: new Map<string, { name: string; color: string }>() } }
    })(),
  ])

  // Kite's two endpoints disagree on price:
  //   - /portfolio/positions returns p.last_price that's updated when the
  //     POSITION changes (every few seconds at best, often stale by 20–30 sec)
  //   - /quote returns the live tick (same source the Watchlist uses)
  // We use /quote for the LTP shown on this page and RECOMPUTE pnl from it,
  // so the same row shows live price + matching P&L, and stays in sync with
  // Watchlist's price. Without /quote the LTP would lag Watchlist on the same
  // symbol by ~20 rupees, which is what the user was seeing.
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
      tag: classifyTag(sym, tags, posStore.byKey.get(sym) || null, posStore.strategiesById),
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

  return NextResponse.json({ positions: filtered, fetchedAt: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
