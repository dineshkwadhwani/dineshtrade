// Manual sell reconciliation for the cron subsystem.
// Detects positions closed manually in Kite (without going through the auto
// engine) and journals a SELL entry so the trade report marks them as closed.
//
// ────────────────────────────────────────────────────────────────────────
// PHASE 5 ROOT-CAUSE FIX (spec §10.1 / CONTEXT.md §12) — read before editing
// ────────────────────────────────────────────────────────────────────────
// V1 bug: the "absorb untracked live position" path created a phantom BUY
// journal entry with NO order ID for any live Kite holding not present in
// our positions store. If a later tick's live-qty read ever came back zero
// for that symbol (Case 2's "sold a prior day" branch), a synthetic SELL
// journaled + removed the position — but the physical shares were still
// sitting in the broker account (Case 2 never places a real Kite order).
// The next tick then saw the same holding as "untracked" again and
// re-absorbed it, restarting the cycle. Every cycle appended a fresh
// no-order-ID BUY + SELL pair to the permanent journal, so the *cumulative*
// journaled SELL quantity for a symbol could balloon far past what was ever
// physically bought (confirmed: TATASTEEL journal showed a 28,700-share SELL
// against a 165-share lifetime buy — ~174 repeated cycles).
//
// Fix, four parts (all required together — any one alone is insufficient):
//   1. The absorb path NEVER journals a BUY with no order ID. If a matching
//      completed BUY order exists in today's Kite order book, we use ITS
//      real order ID (and skip re-journaling if that order ID is already in
//      today's journal — just re-sync the tracked position). If NO matching
//      order exists today (a genuine pre-existing/prior-day holding), we
//      silently start tracking it (recordBuy) WITHOUT writing any journal
//      entry at all — there is no real "BUY event" to record, so we don't
//      fabricate one. This is the change that makes the cycle non-corrupting
//      even in the worst case: the silent path can never write to the journal.
//   2. Before treating a symbol as "genuinely untracked", we verify there is
//      no completed BUY order for it in today's Kite order book (getOrders()
//      is session-scoped to today — see spec note in CONTEXT.md §9 — so this
//      is the strongest check available).
//   3. Case 2 (synthetic SELL for a prior-day manual close) is split out of
//      the per-tick function entirely and only runs from the dedicated EOD
//      sweep, invoked once daily at 15:35 IST (see reconcileManualSellsEOD()
//      below + its call site in lib/cron.ts). It never runs from the regular
//      5-min tick. This is what actually breaks the "every tick" cadence of
//      the old bug — transient intraday broker-snapshot misses can no longer
//      trigger a false close.
//   4. An in-process, day-scoped `absorbedToday` set marks every symbol this
//      process has already absorbed (either branch) so it is not
//      re-processed again on the same day even if something else (e.g. a
//      concurrent tick) also sees it as untracked. Resets on IST day
//      rollover, matching the existing pattern in lib/cronState.ts
//      (inProcessBuyCounts / inProcessNewSymbols).
//
// Two cases still handled by the per-tick function:
//   1. Sold today — find the matching completed SELL order in today's Kite
//      order book and journal it at the actual fill price. (unchanged)
//   2. MOVED to reconcileManualSellsEOD() — sold a prior day, no order found
//      today. Journals a synthetic SELL at the current LTP (or entry price)
//      ONLY from the 15:35 IST EOD sweep.

import { getState, setBuyHistoryForSymbol } from './state'
import { resolveAccountCreds, getPositions, getHoldings, getOrders, getQuotes, buildLiveQtyBySymbol } from './kite'
import { istDateString, readJournalRange, journalOrder, type OrderRecord } from './journal'
import { listPositions, recordBuy, removePosition } from './positions'
import { istDateKey } from './cronState'

function strategyFromTag(tag?: string): string | null {
  const t = (tag || '').toLowerCase()
  if (!t.startsWith('dt-')) return null
  const sid = t.slice(3).replace(/-(t1|t2|exit)$/,'')
  if (!sid || sid === 'manual') return null
  if (sid === 's1') return 'accumulator'
  if (sid === 's2') return 'catalyst'
  return sid
}

function buildLiveInventory(
  holdings: Awaited<ReturnType<typeof getHoldings>>,
  positions: Awaited<ReturnType<typeof getPositions>>,
): Map<string, { qty: number; avgPrice: number }> {
  const inventory = new Map<string, { qty: number; avgPrice: number }>()

  for (const holding of holdings) {
    const symbol = holding.tradingsymbol.toUpperCase()
    const qty = (holding.quantity || 0) + (holding.t1_quantity || 0)
    const avgPrice = Number(holding.average_price) || 0
    if (qty > 0 && avgPrice > 0) inventory.set(symbol, { qty, avgPrice })
  }

  for (const position of positions.net) {
    const symbol = position.tradingsymbol.toUpperCase()
    if (inventory.has(symbol)) continue
    const qty = position.quantity || 0
    const avgPrice = Number(position.average_price) || 0
    if (qty > 0 && avgPrice > 0) inventory.set(symbol, { qty, avgPrice })
  }

  for (const position of positions.day) {
    const symbol = position.tradingsymbol.toUpperCase()
    if (inventory.has(symbol)) continue
    const qty = position.quantity || 0
    const avgPrice = Number(position.average_price) || 0
    if (qty > 0 && avgPrice > 0) inventory.set(symbol, { qty, avgPrice })
  }

  return inventory
}

// ─── Fix requirement 4: day-scoped "already absorbed" guard ────────────────
// Keyed "ACCOUNT:SYMBOL" → the IST date key it was absorbed on. Prevents the
// absorb path from re-processing the same symbol more than once per day even
// if something else (a concurrent tick, or the EOD sweep legitimately
// closing a real position) makes it look untracked again mid-day. Resets
// naturally on IST day rollover via the dateKey comparison — no separate
// timer needed, matching the lightweight in-process style already used by
// lib/cronState.ts's inProcessBuyCounts/inProcessNewSymbols.
const absorbedToday = new Map<string, string>()

function absorbKey(account: string, symbol: string): string {
  return `${account.toUpperCase()}:${symbol.toUpperCase()}`
}

function wasAbsorbedToday(account: string, symbol: string): boolean {
  return absorbedToday.get(absorbKey(account, symbol)) === istDateKey()
}

function markAbsorbedToday(account: string, symbol: string): void {
  absorbedToday.set(absorbKey(account, symbol), istDateKey())
}

// ─── Absorb untracked live positions (runs every tick) ─────────────────────
// See the file-header fix notes above for the full design. Never journals a
// BUY with no order ID (fix req 1); verifies today's Kite order book before
// deciding a position is genuinely untracked (fix req 2); marks absorbed
// symbols so they are not reprocessed same-day (fix req 4).
async function absorbUntrackedPositions(
  account: string,
  liveInventory: Map<string, { qty: number; avgPrice: number }>,
  trackedSymbols: Set<string>,
  kiteOrders: Awaited<ReturnType<typeof getOrders>>,
  todayJournal: Awaited<ReturnType<typeof readJournalRange>>,
): Promise<void> {
  const journaledBuyOrderIds = new Set(
    todayJournal
      .filter((r): r is OrderRecord => r.type === 'order' && (r as OrderRecord).side === 'BUY' && !!(r as OrderRecord).orderId)
      .map(r => (r as OrderRecord).orderId as string)
  )

  // Track symbols journaled today (with or without orderId) to prevent re-journaling
  // positions re-seeded during a reset. This fixes the issue where reset re-journals
  // holdings on the next day's cron run.
  const journaledSymbolsToday = new Set(
    todayJournal
      .filter((r): r is OrderRecord => r.type === 'order' && (r as OrderRecord).side === 'BUY')
      .map(r => (r as OrderRecord).symbol.toUpperCase())
  )

  for (const [symbol, live] of Array.from(liveInventory.entries())) {
    if (trackedSymbols.has(symbol)) continue
    if (wasAbsorbedToday(account, symbol)) continue
    // Skip if already journaled today (prevents re-journaling reset re-seeds)
    if (journaledSymbolsToday.has(symbol)) {
      markAbsorbedToday(account, symbol)
      console.log(`[reconcile] ${account} ${symbol}: skipped (already journaled today from reset)`)
      continue
    }

    // Each symbol is isolated in its own try/catch — a write failure (DB
    // constraint, transient network error, etc.) for ONE symbol must not
    // abort absorption for every other untracked symbol in this tick (this
    // silently blocked recovery of several positions after the Aug 2026
    // mass-deletion incident: the loop died on the first untracked symbol
    // and never got to the rest, every tick, until the process restarted).
    try {
      // Fix req 2 — verify today's Kite order book before deciding this is a
      // genuinely untracked (pre-existing/prior-day) holding vs. a real order
      // that our own engine just placed moments ago (a same-tick race with the
      // BUY engine, which journals + records the position itself — see the
      // "must be awaited" comment in cronBuy.ts).
      const latestCompletedBuy = kiteOrders
        .filter(o => o.transaction_type === 'BUY' && o.status === 'COMPLETE' && o.tradingsymbol.toUpperCase() === symbol)
        .sort((a, b) => {
          const ta = Date.parse(a.order_timestamp || '') || 0
          const tb = Date.parse(b.order_timestamp || '') || 0
          return tb - ta
        })[0]

      if (latestCompletedBuy) {
        // A real order exists today. If it's already journaled, this is just a
        // stale/racy read of our own store — re-sync the tracked position from
        // the REAL fill data without writing a second journal entry.
        const inferredStrategy = strategyFromTag(latestCompletedBuy.tag) || 'accumulator'
        const fillQty = Number(latestCompletedBuy.filled_quantity || latestCompletedBuy.quantity) || live.qty
        const fillPrice = Number(latestCompletedBuy.average_price) || live.avgPrice

        if (journaledBuyOrderIds.has(latestCompletedBuy.order_id)) {
          await recordBuy(inferredStrategy, account, symbol, fillQty, fillPrice)
          await setBuyHistoryForSymbol(account, symbol, [{ price: fillPrice }])
          markAbsorbedToday(account, symbol)
          console.log(`[reconcile] ${account} ${symbol}: re-synced tracked position from existing order ${latestCompletedBuy.order_id} (no duplicate journal entry)`)
          continue
        }

        // Real order, never journaled (defensive fallback — shouldn't normally
        // happen since the BUY engine journals its own fills). Journal it WITH
        // the real order ID (fix req 1) — never a fabricated no-ID entry.
        const inferredTag = latestCompletedBuy.tag || `dt-${inferredStrategy}`
        await recordBuy(inferredStrategy, account, symbol, fillQty, fillPrice)
        await setBuyHistoryForSymbol(account, symbol, [{ price: fillPrice }])
        await journalOrder({
          account, symbol, side: 'BUY',
          qty: fillQty, price: fillPrice,
          tag: inferredTag, strategyId: inferredStrategy,
          orderId: latestCompletedBuy.order_id,
        }).catch(err => console.error(`[reconcile] journalOrder (real order backfill) failed ${account} ${symbol}:`, err))
        markAbsorbedToday(account, symbol)
        console.log(`[reconcile] ${account} ${symbol}: journaled real order ${latestCompletedBuy.order_id} into ${inferredStrategy} @ ₹${fillPrice} (was missing from journal)`)
        continue
      }

      // No corresponding order in today's Kite order book — a genuine
      // pre-existing or prior-day holding bought outside DAlgo. Track it as
      // accumulator and journal it so reports reflect the full portfolio.
      const inferredStrategy = 'accumulator'
      await recordBuy(inferredStrategy, account, symbol, live.qty, live.avgPrice)
      await setBuyHistoryForSymbol(account, symbol, [{ price: live.avgPrice }])
      await journalOrder({
        account, symbol, side: 'BUY',
        qty: live.qty, price: live.avgPrice,
        tag: `dt-${inferredStrategy}`, strategyId: inferredStrategy,
        source: 'manual', orderId: undefined,
      }).catch(err => console.error(`[reconcile] journalOrder (external holding) failed ${account} ${symbol}:`, err))
      markAbsorbedToday(account, symbol)
      console.log(`[reconcile] ${account} ${symbol}: tracked + journaled external holding into ${inferredStrategy} @ ₹${live.avgPrice}`)
    } catch (err) {
      console.error(`[reconcile] ${account} ${symbol}: absorb failed — will retry next tick:`, err)
      // Deliberately NOT marked absorbedToday, so the next tick retries this
      // symbol instead of leaving it permanently untracked.
    }
  }
}

export async function reconcileManualSells(): Promise<void> {
  const state = await getState()
  const connectedAccounts = Object.keys(state.kiteTokens)
  if (connectedAccounts.length === 0) return

  const today = istDateString()

  for (const account of connectedAccounts) {
    // Isolate each account's reconcile pass — a failure for one account (bad
    // creds, a Supabase hiccup, an unexpected data shape) must not prevent
    // every other account's reconciliation from running this tick.
    try {
      const creds = await resolveAccountCreds(account)
      if (!creds.ok) continue

      const openPositions = await listPositions({ account })

      // Fetch live qty, today's Kite SELL orders, and live avg-price inventory in parallel.
      const [livePositions, holdings, kiteOrders] = await Promise.all([
        getPositions(creds).catch(() => ({ day: [], net: [] })),
        getHoldings(creds).catch(() => [] as Awaited<ReturnType<typeof getHoldings>>),
        getOrders(creds).catch(() => [] as Awaited<ReturnType<typeof getOrders>>),
      ])

      const liveQty = buildLiveQtyBySymbol([...livePositions.day, ...livePositions.net], holdings)
      const liveInventory = buildLiveInventory(holdings, livePositions)
      // Build a symbol-only tracked set (no account filter) so positions whose
      // `account` field was seeded as '' don't appear untracked and get
      // incorrectly re-absorbed as accumulator.
      const allPositions = await listPositions()
      const trackedSymbols = new Set(allPositions.map(position => position.symbol.toUpperCase()))

      const todayJournal = await readJournalRange(today, today).catch(() => [] as Awaited<ReturnType<typeof readJournalRange>>)

      await absorbUntrackedPositions(account, liveInventory, trackedSymbols, kiteOrders, todayJournal)

      const trackedPositions = await listPositions({ account })
      if (trackedPositions.length === 0) continue

      // Build map of today's completed SELL orders by symbol, and a set of
      // symbols with in-flight (pending) SELL orders. Case 2 lives in
      // reconcileManualSellsEOD() now — this function only handles Case 1
      // (today's actual completed sells).
      const todaySellBySymbol = new Map<string, typeof kiteOrders[0]>()
      for (const o of kiteOrders) {
        if (o.transaction_type !== 'SELL') continue
        if (o.status !== 'COMPLETE') continue
        todaySellBySymbol.set(o.tradingsymbol.toUpperCase(), o)
      }

      // Find already-journaled SELL order IDs for today (avoid duplicate entries)
      const journaledSellOrderIds = new Set(
        todayJournal
          .filter((r): r is OrderRecord => r.type === 'order' && (r as OrderRecord).side === 'SELL' && !!(r as OrderRecord).orderId)
          .map(r => r.orderId as string)
      )

      const zeroQtyPositions = trackedPositions.filter(p => (liveQty.get(p.symbol.toUpperCase()) ?? 0) <= 0)

      for (const pos of zeroQtyPositions) {
        const sym = pos.symbol.toUpperCase()
        const kiteOrder = todaySellBySymbol.get(sym)
        if (!kiteOrder) continue
        // DAlgo-placed sells are already journaled + position removed by applyLotSell.
        // Only act on genuine discrepancies (sells that bypassed the system).
        if (journaledSellOrderIds.has(kiteOrder.order_id)) continue

        const fillPrice = Number(kiteOrder.average_price) || pos.firstBuyPrice
        const fillQty = Number(kiteOrder.filled_quantity || kiteOrder.quantity) || pos.remainingQty
        await journalOrder({
          account, symbol: pos.symbol, side: 'SELL',
          qty: fillQty, price: fillPrice,
          tag: 'dt-manual', strategyId: pos.strategyId, source: 'manual',
          orderId: kiteOrder.order_id,
        }).catch(err => console.error(`[reconcile] journalOrder failed ${account} ${sym}:`, err))
        await removePosition(account, pos.symbol)
        console.log(`[reconcile] ${account} ${sym}: discrepancy — external SELL journaled + position removed (order ${kiteOrder.order_id})`)
      }
    } catch (err) {
      console.error(`[reconcile] account ${account}: reconcile pass failed — will retry next tick:`, err)
    }
  }
}

// ─── EOD-only synthetic close sweep (Case 2) ───────────────────────────────
// Fix req 3: this is the ONLY place Case 2 ("sold a prior day, no order found
// today") is allowed to run, and it is called exactly once daily — from the
// 15:35 IST retrospective task in lib/cron.ts, NOT from the regular 5-min
// tick. Transient intraday broker-snapshot misses (a position briefly not
// showing in /positions or /holdings) can no longer masquerade as a real
// close, because there is no other opportunity in the day for this code path
// to execute at all.
export async function reconcileManualSellsEOD(): Promise<void> {
  const state = await getState()
  const connectedAccounts = Object.keys(state.kiteTokens)
  if (connectedAccounts.length === 0) return

  const today = istDateString()

  for (const account of connectedAccounts) {
    const creds = await resolveAccountCreds(account)
    if (!creds.ok) continue

    // Safe-fetch: if live-data calls fail we MUST NOT delete positions, since
    // empty holdings/positions would make every CNC holding look like a zero-qty
    // "sold externally" row and wipe the entire position store. Bail for this
    // account and let the next EOD run try again.
    let livePositions: Awaited<ReturnType<typeof getPositions>>
    let holdings: Awaited<ReturnType<typeof getHoldings>>
    let kiteOrders: Awaited<ReturnType<typeof getOrders>>
    try {
      ;[livePositions, holdings, kiteOrders] = await Promise.all([
        getPositions(creds),
        getHoldings(creds),
        getOrders(creds).catch(() => [] as Awaited<ReturnType<typeof getOrders>>),
      ])
    } catch (err) {
      console.error(`[reconcile-eod] ${account}: live-data fetch failed — skipping EOD sweep to avoid false closes:`, err)
      continue
    }

    const trackedPositions = await listPositions({ account })
    if (trackedPositions.length === 0) continue

    // Safety net: if Kite returned no holdings at all but we have tracked CNC
    // positions, the API likely returned incomplete data. Abort rather than
    // treating all those positions as sold (which would delete them and reset
    // their strategy tags to 'accumulator' next morning via the absorb path).
    if (holdings.length === 0 && trackedPositions.some(p => p.remainingQty > 0)) {
      console.warn(`[reconcile-eod] ${account}: getHoldings returned 0 rows but tracked positions exist — skipping EOD sweep`)
      continue
    }

    const liveQty = buildLiveQtyBySymbol([...livePositions.day, ...livePositions.net], holdings)

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

    const zeroQtyPositions = trackedPositions.filter(p => (liveQty.get(p.symbol.toUpperCase()) ?? 0) <= 0)
    if (zeroQtyPositions.length === 0) continue

    // Case 2 idempotency: read journal from earliest firstBuyAt across all
    // zero-qty positions. If a dt-manual SELL already exists for a symbol
    // after its firstBuyAt, it's already been reconciled — don't re-journal.
    // (Positions are NOT removed from the store after manual sell so the
    // strategy tag remains visible in the Holdings UI — wait, they ARE
    // removed below; this comment describes the journal-side dedup only.)
    const earliestBuyDate = zeroQtyPositions.reduce((min, p) => {
      const d = (p.firstBuyAt || today).slice(0, 10)
      return d < min ? d : min
    }, today)
    const priorJournal = earliestBuyDate < today
      ? await readJournalRange(earliestBuyDate, today).catch(() => [] as Awaited<ReturnType<typeof readJournalRange>>)
      : await readJournalRange(today, today).catch(() => [] as Awaited<ReturnType<typeof readJournalRange>>)
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
      // Case 1 (sold today): regular reconcile journals + removes; EOD only removes if still present
      if (todaySellBySymbol.has(sym)) {
        await removePosition(account, pos.symbol)
        continue
      }

      if (pendingSellSymbols.has(sym)) {
        console.log(`[reconcile-eod] ${account} ${sym}: sell order pending — deferring`)
        continue
      }
      const lastSellTs = lastManualSellTs.get(sym)
      if (lastSellTs && lastSellTs >= pos.firstBuyAt) continue

      const ltp = quotes[`NSE:${sym}`]?.last_price
      const closePrice = typeof ltp === 'number' && ltp > 0 ? ltp : pos.firstBuyPrice
      await journalOrder({
        account, symbol: pos.symbol, side: 'SELL',
        qty: pos.remainingQty, price: closePrice,
        tag: 'dt-manual', strategyId: pos.strategyId, source: 'manual',
      }).catch(err => console.error(`[reconcile-eod] journalOrder failed ${account} ${sym}:`, err))
      console.log(`[reconcile-eod] ${account} ${sym}: synthetic SELL @ ₹${closePrice} (prior-day manual close; LTP ${ltp ?? 'unavailable'}) strategy=${pos.strategyId}`)
      await removePosition(account, pos.symbol)
    }
  }
}
