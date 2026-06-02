// Manual sell reconciliation for the cron subsystem.
// Detects positions closed manually in Kite (without going through the auto
// engine) and journals a SELL entry so the trade report marks them as closed.
//
// Two cases handled:
//   1. Sold today — find the matching completed SELL order in today's Kite
//      order book and journal it at the actual fill price.
//   2. Sold a prior day — Kite qty is 0 but no order found today. Journal a
//      synthetic SELL at the current LTP (fetched at reconcile time) so the
//      trade shows as closed rather than perpetually open. If LTP unavailable,
//      falls back to the original entry price (breakeven close).
//
// Runs inside the 5-min tick (catches same-day closes in near-real-time) and
// again at 15:35 EOD for a final sweep with closing prices.

import { getState } from './state'
import { resolveAccountCreds, getPositions, getHoldings, getOrders, getQuotes, buildLiveQtyBySymbol } from './kite'
import { appendJournal, istDateString, readJournalRange, journalOrder, type OrderRecord } from './journal'
import { listPositions } from './positions'
import { istHHMM } from './cronState'

export async function reconcileManualSells(): Promise<void> {
  const state = await getState()
  const connectedAccounts = Object.keys(state.kiteTokens)
  if (connectedAccounts.length === 0) return

  const today = istDateString()

  for (const account of connectedAccounts) {
    const creds = await resolveAccountCreds(account)
    if (!creds.ok) continue

    const openPositions = await listPositions({ account })
    if (openPositions.length === 0) continue

    // Fetch live qty, today's Kite SELL orders, and quotes for zero-qty symbols in parallel
    const [{ day, net }, holdings, kiteOrders] = await Promise.all([
      getPositions(creds).catch(() => ({ day: [], net: [] })),
      getHoldings(creds).catch(() => [] as Awaited<ReturnType<typeof getHoldings>>),
      getOrders(creds).catch(() => [] as Awaited<ReturnType<typeof getOrders>>),
    ])

    const liveQty = buildLiveQtyBySymbol([...day, ...net], holdings)

    // Build map of today's completed SELL orders by symbol, and a set of
    // symbols with in-flight (pending) SELL orders. Case 2 must not fire for
    // pending sells — the order will complete shortly, and Case 1 will journal
    // it at the actual fill price. Firing Case 2 first would record the wrong
    // price (firstBuyPrice fallback) and block Case 1 via idempotency.
    const todaySellBySymbol = new Map<string, typeof kiteOrders[0]>()
    const pendingSellSymbols = new Set<string>()
    for (const o of kiteOrders) {
      if (o.transaction_type !== 'SELL') continue
      const sym = o.tradingsymbol.toUpperCase()
      if (o.status === 'COMPLETE') {
        todaySellBySymbol.set(sym, o)
      } else if (['OPEN', 'PENDING', 'PUT ORDER REQ RECEIVED', 'VALIDATION PENDING', 'TRIGGER PENDING'].includes(o.status)) {
        pendingSellSymbols.add(sym)
      }
    }

    // Find already-journaled SELL order IDs for today (avoid duplicate entries)
    const todayJournal = await readJournalRange(today, today).catch(() => [] as Awaited<ReturnType<typeof readJournalRange>>)
    const journaledOrderIds = new Set(
      todayJournal
        .filter((r): r is OrderRecord => r.type === 'order' && (r as OrderRecord).side === 'SELL' && !!(r as OrderRecord).orderId)
        .map(r => r.orderId as string)
    )

    // Identify closed-externally positions and fetch quotes for prior-day closes
    const zeroQtyPositions = openPositions.filter(p => (liveQty.get(p.symbol.toUpperCase()) ?? 0) <= 0)
    if (zeroQtyPositions.length === 0) continue

    // For Case 2 idempotency: read journal from earliest firstBuyAt across all
    // zero-qty positions. If a dt-manual SELL already exists for a symbol after
    // its firstBuyAt, it's already been reconciled — don't re-journal.
    // (Positions are NOT removed from the store after manual sell so the strategy
    // tag remains visible in the Holdings UI.)
    const earliestBuyDate = zeroQtyPositions.reduce((min, p) => {
      const d = (p.firstBuyAt || today).slice(0, 10)
      return d < min ? d : min
    }, today)
    const priorJournal = earliestBuyDate < today
      ? await readJournalRange(earliestBuyDate, today).catch(() => [] as Awaited<ReturnType<typeof readJournalRange>>)
      : todayJournal
    // Map: sym → latest dt-manual SELL ts (to compare against pos.firstBuyAt)
    const lastManualSellTs = new Map<string, string>()
    for (const r of priorJournal) {
      if (r.type !== 'order') continue
      const o = r as OrderRecord
      if (o.side !== 'SELL' || o.tag !== 'dt-manual') continue
      const s = o.symbol?.toUpperCase()
      const ts = o.ts
      if (s && (!lastManualSellTs.has(s) || ts > lastManualSellTs.get(s)!)) lastManualSellTs.set(s, ts)
    }

    const priorDaySymbols = zeroQtyPositions
      .filter(p => !todaySellBySymbol.has(p.symbol.toUpperCase()))
      .map(p => p.symbol.toUpperCase())
    const quotes = priorDaySymbols.length > 0
      ? await getQuotes(creds, priorDaySymbols).catch(() => ({} as Record<string, any>))
      : {}

    for (const pos of zeroQtyPositions) {
      const sym = pos.symbol.toUpperCase()
      const kiteOrder = todaySellBySymbol.get(sym)

      if (kiteOrder && !journaledOrderIds.has(kiteOrder.order_id)) {
        // Case 1: sold today manually — journal the actual fill attributed to the buying strategy
        const fillPrice = Number(kiteOrder.average_price) || pos.firstBuyPrice
        const fillQty = Number(kiteOrder.filled_quantity || kiteOrder.quantity) || pos.remainingQty
        await journalOrder({
          account, symbol: pos.symbol, side: 'SELL',
          qty: fillQty, price: fillPrice,
          tag: 'dt-manual', strategyId: pos.strategyId, source: 'manual',
          orderId: kiteOrder.order_id,
        }).catch(err => console.error(`[reconcile] journalOrder failed ${account} ${sym}:`, err))
        console.log(`[reconcile] ${account} ${sym}: journaled manual SELL @ ₹${fillPrice} (order ${kiteOrder.order_id}) strategy=${pos.strategyId}`)
      } else if (!kiteOrder) {
        // Case 2: sold a prior day — but first skip if there's a pending SELL
        // order today. The order will complete and Case 1 will journal it at
        // the actual fill price on the next tick. Don't journal with wrong price now.
        if (pendingSellSymbols.has(sym)) {
          console.log(`[reconcile] ${account} ${sym}: sell order pending — deferring to next tick`)
          continue
        }
        // Also skip if already reconciled after this position's firstBuyAt
        const lastSellTs = lastManualSellTs.get(sym)
        if (lastSellTs && lastSellTs >= pos.firstBuyAt) continue
        // Use LTP if available, else entry price
        const ltp = quotes[`NSE:${sym}`]?.last_price
        const closePrice = typeof ltp === 'number' && ltp > 0 ? ltp : pos.firstBuyPrice
        await journalOrder({
          account, symbol: pos.symbol, side: 'SELL',
          qty: pos.remainingQty, price: closePrice,
          tag: 'dt-manual', strategyId: pos.strategyId, source: 'manual',
        }).catch(err => console.error(`[reconcile] journalOrder failed ${account} ${sym}:`, err))
        console.log(`[reconcile] ${account} ${sym}: synthetic SELL @ ₹${closePrice} (prior-day manual close; LTP ${ltp ?? 'unavailable'}) strategy=${pos.strategyId}`)
      }
      // Position stays in store — strategy tag remains visible in Holdings UI.
      // Cleaned up on next re-buy (recordBuy overwrites) or manual reset.
    }
  }
}
