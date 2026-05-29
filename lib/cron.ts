// node-cron registration. Runs in the long-lived Next.js Node process (PM2 on EC2).
//
// Two scheduled jobs (both Asia/Kolkata):
//   - tick: every 5 min weekdays — fires only during 9:15–15:30 IST + Auto mode
//   - eodSummary: 15:35 IST weekdays — emails EOD report if any activity today
//
// Tick body:
//   1. monitorAllConnected() — Strategy 2 SELL engine. Polls open positions for
//      each connected account, fires SELLs at +1.5%, marks as delivery past 15:00.
//   2. First tick of the day only: runs the BUY scan (generateRecommendations)
//      and auto-places orders against state.selectedAccounts via the same
//      preflight + placeKiteOrder path that Manual Execute uses.
//
// Gated by CRON_ENABLED=true. Set CRON_ENABLED=false (or unset) for local dev.

import cron, { ScheduledTask } from 'node-cron'
import { getState } from './state'
import { isMarketOpen, NSE_HOLIDAYS } from './market'
import { getAccountList } from './accounts'
import { sendEmail, sendDailyReport, sendMonthlyReport, isEmailConfigured, type EODLineItem } from './email'
import { generateRecommendations, getMarketMode, runReactiveDipScan, runStrategyScan, type Recommendation } from './strategyEngine'
import { getActiveStrategies, getCapital, type Strategy } from './strategyConfig'
import strategyCfg from '@/config/strategy.json'
import { monitorAllConnected, STRATEGY_2_BUY_TAG } from './strategy2'
import {
  monitorAllAccountsStrategy1, recordStrategy1Buy, STRATEGY_1_BUY_TAG,
} from './strategy1'
import { resolveAccountCreds, placeKiteOrder, getQuotes, getPositions, getHoldings, getOrders } from './kite'
import { runPreflight, markPlaced } from './preflight'
import { appendJournal, istDateString, readJournalRange, journalOrder } from './journal'
import { buildDailyReport, buildMonthlyReport, isLastWeekdayOfMonth } from './retrospective'
import { listPositions, removePosition } from './positions'

let started = false
let tickTask: ScheduledTask | null = null
let eodTask: ScheduledTask | null = null

// Prevents runEODSquareOff from firing twice for the same strategy on the same
// calendar day (key=strategyId, value=YYYY-MM-DD IST date key).
let eodSquareOffDone: Record<string, string> = {}

// Per-strategy scan tasks. Each active strategy in strategy.json gets its own
// cron task at its scanIntervalMin. The map keys are strategy ids so we can
// start/stop individual tasks when the user toggles a strategy in Settings
// (Phase 4). For Phase 3 the registry is populated once at startCron() time.
const strategyTasks = new Map<string, ScheduledTask>()

// ──────── DAY-OF STATS (in-process) ────────

let currentDateKey = ''
let dipScanDoneDate = ''

// In-process BUY counter + new-positions set — shared across all per-strategy
// cron tasks to prevent the race condition where two concurrent tasks both pass
// the quota gate or positions gate before the other's order shows in Kite.
//
// inProcessBuyCounts: "${account}:${dateKey}" → count of auto-BUYs placed today
// inProcessNewSymbols: "${account}:${dateKey}" → Set of NEW symbols opened today
//   (symbols that weren't already in Kite holdings — each adds 1 to positions count)
//
// Both reset automatically in maybeRollDay() at midnight IST.

const inProcessBuyCounts: Record<string, number> = {}
const inProcessNewSymbols: Record<string, Set<string>> = {}

function inProcessKey(account: string): string {
  return `${account.toUpperCase()}:${currentDateKey}`
}

function incrementInProcessBuy(account: string): void {
  const k = inProcessKey(account)
  inProcessBuyCounts[k] = (inProcessBuyCounts[k] || 0) + 1
}

function getInProcessBuyCount(account: string): number {
  return inProcessBuyCounts[inProcessKey(account)] || 0
}

// Call this when placing a buy for a symbol not already in Kite holdings/positions
// (i.e. it will add 1 to the open positions count).
function registerInProcessNewSymbol(account: string, symbol: string): void {
  const k = inProcessKey(account)
  if (!inProcessNewSymbols[k]) inProcessNewSymbols[k] = new Set()
  inProcessNewSymbols[k].add(symbol.toUpperCase())
}

function getInProcessNewPositionCount(account: string): number {
  return inProcessNewSymbols[inProcessKey(account)]?.size || 0
}
const dayStats = {
  scans: 0,
  executed: [] as EODLineItem[],
  failed:   [] as EODLineItem[],
  skipped:  [] as EODLineItem[],
  delivery: [] as EODLineItem[],
  realizedPnl: {} as Record<string, number>,
}

function istDateKey(): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const y = ist.getFullYear()
  const m = String(ist.getMonth() + 1).padStart(2, '0')
  const d = String(ist.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function istHHMM(): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${String(ist.getHours()).padStart(2,'0')}:${String(ist.getMinutes()).padStart(2,'0')}`
}

function maybeRollDay() {
  const today = istDateKey()
  if (today !== currentDateKey) {
    currentDateKey = today
    dayStats.scans = 0
    dayStats.executed = []
    dayStats.failed = []
    dayStats.skipped = []
    dayStats.delivery = []
    dayStats.realizedPnl = {}
    // Clear in-process buy counters and new-symbol sets for the new day
    for (const k of Object.keys(inProcessBuyCounts)) delete inProcessBuyCounts[k]
    for (const k of Object.keys(inProcessNewSymbols)) delete inProcessNewSymbols[k]
  }
}

function isMarketDay(): boolean {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dow = ist.getDay()
  if (dow === 0 || dow === 6) return false
  return !NSE_HOLIDAYS.includes(istDateKey())
}

// Reactive dip cadence check. Cron tick fires every 5 min; we want the
// reactive scan to fire every `intervalMin` (default 30) within
// [scanStartHHMM, scanEndHHMM]. Anchored to scanStartHHMM, so with start
// 09:15 + interval 30, fires at 09:15, 09:45, 10:15, …, 13:45.
function shouldRunReactiveDip(nowHHMM: string, cfg: {
  scanStartHHMM?: string; scanEndHHMM?: string; intervalMin?: number
}): boolean {
  const startHHMM = cfg.scanStartHHMM || '09:15'
  const endHHMM   = cfg.scanEndHHMM   || '14:00'
  const interval  = cfg.intervalMin   || 30
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(n => parseInt(n, 10))
    return h * 60 + m
  }
  const now = toMin(nowHHMM)
  const start = toMin(startHHMM)
  const end = toMin(endHHMM)
  if (now < start || now > end) return false
  return ((now - start) % interval) === 0
}

export function recordExecuted(item: EODLineItem) { maybeRollDay(); dayStats.executed.push(item) }
export function recordFailed(item: EODLineItem)   { maybeRollDay(); dayStats.failed.push(item) }
export function recordSkipped(item: EODLineItem)  { maybeRollDay(); dayStats.skipped.push(item) }
export function recordDelivery(item: EODLineItem) { maybeRollDay(); dayStats.delivery.push(item) }
export function recordPnl(account: string, pnl: number) {
  maybeRollDay()
  dayStats.realizedPnl[account] = (dayStats.realizedPnl[account] || 0) + pnl
}
export function recordScan() { maybeRollDay(); dayStats.scans++ }
export function getDayStats() { maybeRollDay(); return { date: currentDateKey, dipScanDoneDate, ...dayStats } }

// ──────── AUTO BUY — first-of-day morning scan ────────

async function autoBuyOnAccount(account: string, accountDisplayName: string | undefined, recs: Recommendation[]) {
  const creds = await resolveAccountCreds(account)
  if (!creds.ok) {
    recordSkipped({ time: istHHMM(), account, symbol: '—', side: 'BUY', quantity: 0, reason: creds.error })
    return
  }
  // Read the capital config once for the in-process quota check
  const cap = getCapital()
  for (const rec of recs) {
    // In-process quota guard — prevents two concurrent strategy cron tasks from
    // both passing the Kite quota gate before each other's order shows COMPLETE.
    const inProcessCount = getInProcessBuyCount(account)
    if (inProcessCount >= cap.maxBuysPerDay) {
      recordSkipped({
        time: istHHMM(), account, symbol: rec.symbol, side: 'BUY', quantity: rec.suggestedQty,
        reason: `[inProcessQuota] already ${inProcessCount}/${cap.maxBuysPerDay} in-process buys today`,
      })
      continue
    }

    // In-process positions guard — prevents two concurrent strategy tasks from
    // both passing Gate 6 (positions cap) before each other's order shows in
    // Kite's /portfolio/positions. We track NEW symbols committed in-process
    // today (symbols that will add 1 to the open-position count when settled).
    // Gate 6 in preflight is still the authoritative check (reads live Kite
    // data); this fast pre-check closes the same-process race condition.
    const inProcessNewPos = getInProcessNewPositionCount(account)
    // Conservative: estimate existing positions = positions already in the
    // positions store for this account (includes reset-seeded holdings).
    const existingStorePositions = (await import('./positions'))
      .listPositions({ account }).then(ps => ps.length).catch(() => 0)
    const estimatedTotal = (await existingStorePositions) + inProcessNewPos
    if (estimatedTotal >= cap.maxPositions) {
      recordSkipped({
        time: istHHMM(), account, symbol: rec.symbol, side: 'BUY', quantity: rec.suggestedQty,
        reason: `[inProcessPositions] estimated ${estimatedTotal}/${cap.maxPositions} open positions (including ${inProcessNewPos} in-process today)`,
      })
      continue
    }
    const pre = await runPreflight({
      account, symbol: rec.symbol, side: 'BUY',
      quantity: rec.suggestedQty, pricePerShare: rec.price,
      strategyId: rec.strategy,
    })
    if (!pre.ok) {
      recordSkipped({
        time: istHHMM(), account, symbol: rec.symbol, side: 'BUY', quantity: rec.suggestedQty,
        reason: `[${pre.gate}] ${pre.reason}`,
      })
      // Journal the signal we DIDN'T trade so the retrospective can show "what
      // happened to it by close" — was it a Good Miss or a Missed Opportunity?
      appendJournal({
        type: 'signal_skipped', date: istDateString(), time: istHHMM(),
        account, symbol: rec.symbol, signalPrice: rec.price,
        reasonSkipped: `[${pre.gate}] ${pre.reason || ''}`.trim(),
      }).catch(err => console.error('[cron] journal signal_skipped failed:', err))
      sendEmail('trade_failed', {
        account, accountDisplayName, symbol: rec.symbol, side: 'BUY',
        quantity: rec.suggestedQty, price: rec.price,
        failedAt: 'preflight', gate: pre.gate, reason: pre.reason || 'Unknown',
        mode: 'auto',
      }).catch(err => console.error('[cron autoBuy] preflight-email failed:', err))
      continue
    }
    // Tag carries the strategy id directly — unified store + per-strategy params.
    const tag = `dt-${rec.strategy}`
    const placed = await placeKiteOrder(creds, {
      symbol: rec.symbol, side: 'BUY', quantity: rec.suggestedQty, tag,
    })
    if (placed.ok && placed.data?.data?.order_id) {
      // Increment in-process counters immediately so sibling strategy tasks see them
      incrementInProcessBuy(account)
      registerInProcessNewSymbol(account, rec.symbol)
      // Persist BEFORE doing anything else — critical for preventing duplicate
      // BUYs on the next cron tick if this function were to crash partway.
      await markPlaced(account, rec.symbol, 'BUY', { price: rec.price, manual: false })
      // Single store, single call — strategyId on the row drives monitor ownership.
      const { recordBuy } = await import('./positions')
      recordBuy(rec.strategy, account, rec.symbol, rec.suggestedQty, rec.price)
        .catch(err => console.error('[cron autoBuy] position record failed:', err))
      // Journal the order so historical retrospectives can show today's auto BUYs
      // without depending on Kite's session-scoped /orders endpoint.
      const { journalOrder } = await import('./journal')
      journalOrder({
        account, symbol: rec.symbol, side: 'BUY',
        qty: rec.suggestedQty, price: rec.price,
        tag, orderId: placed.data.data.order_id,
      }).catch(err => console.error('[cron autoBuy] journalOrder failed:', err))
      recordExecuted({
        time: istHHMM(), account, symbol: rec.symbol, side: 'BUY',
        quantity: rec.suggestedQty, price: rec.price, orderId: placed.data.data.order_id,
      })
      sendEmail('trade_executed', {
        account, accountDisplayName, symbol: rec.symbol, symbolName: rec.name,
        side: 'BUY', quantity: rec.suggestedQty, price: rec.price,
        target1: rec.target1, target2: rec.target2,
        orderId: placed.data.data.order_id, source: rec.source, reason: rec.reason,
        mode: 'auto',
      }).catch(err => console.error('[cron autoBuy] executed-email failed:', err))
    } else {
      const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
      recordFailed({
        time: istHHMM(), account, symbol: rec.symbol, side: 'BUY',
        quantity: rec.suggestedQty, price: rec.price, reason: errMsg,
      })
      sendEmail('trade_failed', {
        account, accountDisplayName, symbol: rec.symbol, side: 'BUY',
        quantity: rec.suggestedQty, price: rec.price,
        failedAt: 'kite', reason: errMsg, mode: 'auto',
      }).catch(err => console.error('[cron autoBuy] failed-email failed:', err))
    }
  }
}

// ──────── EOD SQUARE-OFF (momentum strategies) ────────
//
// Runs inside each 5-min tick. Fires once per strategy per day at exactly
// exitSameDayTime (default 15:10 IST). Two modes (non-exclusive):
//   squareOffEOD=true         → sell everything regardless of P&L (bypasses no-loss gate)
//   exitSameDayOnPositive=true → sell only positions where LTP > firstBuyPrice

async function runEODSquareOff(): Promise<void> {
  const t = istHHMM()
  const today = istDateKey()
  const state = await getState()
  if (state.mode !== 'auto') return

  const strategies = getActiveStrategies().filter(s => s.type === 'momentum')
  for (const strategy of strategies) {
    const params = strategy.params as any
    const squareOffEOD: boolean = params.squareOffEOD === true
    const exitOnPositive: boolean = params.exitSameDayOnPositive === true
    if (!squareOffEOD && !exitOnPositive) continue

    const exitTime: string = typeof params.exitSameDayTime === 'string' ? params.exitSameDayTime : '15:10'
    if (t !== exitTime) continue
    if (eodSquareOffDone[strategy.id] === today) continue

    // Mark done immediately to prevent re-entry if any await below takes time
    eodSquareOffDone[strategy.id] = today
    console.log(`[cron eod] ${t} IST — ${strategy.id}: running EOD square-off (squareOffEOD=${squareOffEOD}, exitOnPositive=${exitOnPositive})`)

    const accounts = getAccountList()
    const targetAccounts = Object.keys(state.kiteTokens)
    for (const account of targetAccounts) {
      const displayName = accounts.find(a => a.name === account)?.displayName
      const creds = await resolveAccountCreds(account)
      if (!creds.ok) {
        console.warn(`[cron eod] ${strategy.id} ${account}: creds not available — skipping`)
        continue
      }

      const positions = await listPositions({ account, strategyId: strategy.id })
      if (positions.length === 0) continue

      const symbols = positions.map(p => p.symbol.toUpperCase())  // getQuotes adds NSE: internally
      const quotes = await getQuotes(creds, symbols)

      for (const pos of positions) {
        const quoteKey = `NSE:${pos.symbol.toUpperCase()}`
        const ltp: number | undefined = quotes[quoteKey]?.last_price
        if (ltp === undefined) {
          console.warn(`[cron eod] ${strategy.id} ${account} ${pos.symbol}: no LTP — skipping`)
          continue
        }

        const shouldSell = squareOffEOD || (exitOnPositive && ltp > pos.firstBuyPrice)
        if (!shouldSell) continue

        const qty = pos.remainingQty
        const pre = await runPreflight({
          account, symbol: pos.symbol, side: 'SELL',
          quantity: qty, pricePerShare: ltp,
          strategyId: strategy.id,
          bypassNoLossSell: squareOffEOD,
        })
        const sellQty = pre.adjustedQty ?? qty
        if (!pre.ok) {
          recordFailed({ time: t, account, symbol: pos.symbol, side: 'SELL', quantity: sellQty, reason: `[${pre.gate}] ${pre.reason}` })
          continue
        }

        const placed = await placeKiteOrder(creds, { symbol: pos.symbol, side: 'SELL', quantity: sellQty, tag: `dt-eod-${strategy.id}` })
        if (placed.ok && placed.data?.data?.order_id) {
          await markPlaced(account, pos.symbol, 'SELL')
          await removePosition(account, pos.symbol)
          recordExecuted({ time: t, account, symbol: pos.symbol, side: 'SELL', quantity: sellQty, price: ltp, orderId: placed.data.data.order_id, reason: squareOffEOD ? 'EOD square-off' : 'EOD exit on positive' })
          sendEmail('trade_executed', {
            account, accountDisplayName: displayName, symbol: pos.symbol,
            side: 'SELL', quantity: sellQty, price: ltp,
            orderId: placed.data.data.order_id,
            reason: squareOffEOD ? `EOD square-off (${strategy.name})` : `EOD exit on positive (${strategy.name})`,
            mode: 'auto',
          }).catch(err => console.error('[cron eod] email failed:', err))
        } else {
          const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
          recordFailed({ time: t, account, symbol: pos.symbol, side: 'SELL', quantity: sellQty, price: ltp, reason: errMsg })
        }
      }
    }
  }
}

// ──────── MANUAL SELL RECONCILIATION ────────
//
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

async function reconcileManualSells(): Promise<void> {
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

    const liveQty = new Map<string, number>()
    for (const p of [...day, ...net]) {
      const sym = p.tradingsymbol.toUpperCase()
      liveQty.set(sym, (liveQty.get(sym) || 0) + (p.quantity || 0))
    }
    for (const h of holdings) {
      const sym = h.tradingsymbol.toUpperCase()
      const heldQty = (h.quantity || 0) + ((h as any).t1_quantity || 0)
      liveQty.set(sym, (liveQty.get(sym) || 0) + heldQty)
    }

    // Build map of today's completed SELL orders by symbol
    const todaySellBySymbol = new Map<string, typeof kiteOrders[0]>()
    for (const o of kiteOrders) {
      if (o.transaction_type === 'SELL' && o.status === 'COMPLETE') {
        todaySellBySymbol.set(o.tradingsymbol.toUpperCase(), o)
      }
    }

    // Find already-journaled SELL order IDs for today (avoid duplicate entries)
    const todayJournal = await readJournalRange(today, today).catch(() => [] as Awaited<ReturnType<typeof readJournalRange>>)
    const journaledOrderIds = new Set(
      todayJournal
        .filter(r => r.type === 'order' && (r as any).side === 'SELL' && (r as any).orderId)
        .map(r => (r as any).orderId as string)
    )

    // Identify closed-externally positions and fetch quotes for prior-day closes
    const zeroQtyPositions = openPositions.filter(p => (liveQty.get(p.symbol.toUpperCase()) ?? 0) <= 0)
    if (zeroQtyPositions.length === 0) continue

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
        // Case 1: sold today manually — journal the actual fill
        const fillPrice = Number(kiteOrder.average_price) || pos.firstBuyPrice
        const fillQty = Number(kiteOrder.filled_quantity || kiteOrder.quantity) || pos.remainingQty
        await journalOrder({
          account, symbol: pos.symbol, side: 'SELL',
          qty: fillQty, price: fillPrice,
          tag: 'dt-manual', orderId: kiteOrder.order_id,
        }).catch(err => console.error(`[reconcile] journalOrder failed ${account} ${sym}:`, err))
        console.log(`[reconcile] ${account} ${sym}: journaled manual SELL @ ₹${fillPrice} (order ${kiteOrder.order_id})`)
      } else if (!kiteOrder) {
        // Case 2: sold a prior day — use LTP if available, else entry price
        const ltp = quotes[`NSE:${sym}`]?.last_price
        const closePrice = typeof ltp === 'number' && ltp > 0 ? ltp : pos.firstBuyPrice
        await journalOrder({
          account, symbol: pos.symbol, side: 'SELL',
          qty: pos.remainingQty, price: closePrice,
          tag: 'dt-manual',
        }).catch(err => console.error(`[reconcile] journalOrder failed ${account} ${sym}:`, err))
        console.log(`[reconcile] ${account} ${sym}: synthetic SELL @ ₹${closePrice} (prior-day manual close; LTP ${ltp ?? 'unavailable'})`)
      }

      // Remove from positions store regardless — Kite shows nothing held
      await removePosition(account, pos.symbol)
        .catch(err => console.error(`[reconcile] removePosition failed ${account} ${sym}:`, err))
    }
  }
}

// ──────── TICK ────────

async function tick(): Promise<void> {
  maybeRollDay()
  const market = isMarketOpen()
  if (!market.open) return
  const state = await getState()
  if (state.mode !== 'auto') return
  if (Object.keys(state.kiteTokens).length === 0) return

  recordScan()
  const t = istHHMM()
  const accs = Object.keys(state.kiteTokens)
  console.log(`[cron tick] ${t} IST — scan #${dayStats.scans} · mode=auto · accounts=${accs.join(',')}`)

  // 1a. SELL engine — Strategy 2 (intraday catalyst) monitor
  try {
    const s2Results = await monitorAllConnected()
    for (const r of s2Results) {
      for (const e of r.entries) {
        const item: EODLineItem = {
          time: t, account: e.account, symbol: e.symbol, side: 'SELL',
          quantity: e.quantity || 0, price: e.ltp, orderId: e.orderId, reason: e.reason,
        }
        if (e.action === 'sold')         recordExecuted(item)
        else if (e.action === 'sold_failed') recordFailed(item)
        else if (e.action === 'delivery')    recordDelivery(item)
      }
    }
  } catch (err) {
    console.error('[cron tick] Strategy 2 monitor failed:', err)
  }

  // 1b. SELL engine — Strategy 1 (oscillator/EMA two-tranche) monitor
  try {
    const s1Results = await monitorAllAccountsStrategy1()
    for (const r of s1Results) {
      for (const e of r.entries) {
        const item: EODLineItem = {
          time: t, account: e.account, symbol: e.symbol, side: 'SELL',
          quantity: e.qty || 0, price: e.ltp, orderId: e.orderId, reason: e.reason,
        }
        if (e.action === 'tranche1_sold' || e.action === 'tranche2_sold') recordExecuted(item)
        else if (e.action === 'failed') recordFailed(item)
      }
    }
  } catch (err) {
    console.error('[cron tick] Strategy 1 monitor failed:', err)
  }

  // 1c. EOD square-off for momentum strategies
  try { await runEODSquareOff() } catch (err) { console.error('[cron tick] EOD square-off failed:', err) }

  // 1d. Manual sell reconciliation — journals any Kite SELL orders not placed
  // through the auto engine so the trade report marks those positions as closed.
  try { await reconcileManualSells() } catch (err) { console.error('[cron tick] reconcile manual sells failed:', err) }

  // 1e. REACTIVE DIP scan
  // Fires every 30 min between 09:15 and 14:00 IST (independent of market mode
  // and of the dip-mode once-per-day BUY scan). Looks for List A stocks that
  // dropped ≥3% intraday, re-evaluates Strategy 1 with today counted as a down
  // day, and auto-BUYs anything that qualifies. Idempotency in preflight
  // prevents the same symbol from firing on both the morning scan + reactive,
  // OR on consecutive 30-min reactive ticks.
  try {
    const rcfg = (strategyCfg as any).strategy1_reactive
    if (rcfg && shouldRunReactiveDip(t, rcfg)) {
      console.log(`[cron tick] ${t} IST — reactive dip scan window`)
      const reactive = await runReactiveDipScan()
      if (reactive.recommendations.length > 0) {
        const accounts = getAccountList()
        const targetAccounts = state.selectedAccounts.filter(a => !!state.kiteTokens[a])
        if (targetAccounts.length === 0) {
          console.log('[cron tick] reactive dip — no selectedAccounts with tokens; skipping auto-BUY')
        } else {
          console.log(`[cron tick] reactive dip — ${reactive.recommendations.length} rec(s): ${reactive.recommendations.map(r => r.symbol).join(', ')} (triggered: ${reactive.triggered.length})`)
          for (const account of targetAccounts) {
            const display = accounts.find(a => a.name === account)?.displayName
            await autoBuyOnAccount(account, display, reactive.recommendations)
          }
        }
      } else if (reactive.triggered.length > 0) {
        console.log(`[cron tick] reactive dip — ${reactive.triggered.length} stocks at −3%+ but none met Strategy 1 entry criteria`)
      }
    }
  } catch (err) {
    console.error('[cron tick] reactive dip scan failed:', err)
  }

  // BUY scans are now handled by per-strategy cron tasks (see strategyTasks
  // registry in startCron). The 5-min tick only handles SELL monitors + the
  // reactive dip trigger above. This means a strategy with scanIntervalMin=5
  // and scanIntervalMin=30 each run at their own cadence, independent of
  // GIFT-Nifty market mode — the user controls activation explicitly in
  // strategy.json.
}

// Per-strategy task body. Runs the strategy's scanner with its own params
// and watchlist, then auto-BUYs the resulting recommendations on every
// selected account. Idempotency in preflight prevents duplicates across
// strategies (one BUY per symbol per account per day).
async function runStrategyTaskBody(strategy: Strategy): Promise<void> {
  maybeRollDay()
  const market = isMarketOpen()
  if (!market.open) return
  const state = await getState()
  if (state.mode !== 'auto') return
  if (Object.keys(state.kiteTokens).length === 0) return

  const t = istHHMM()
  console.log(`[cron strategy:${strategy.id}] ${t} IST — scan firing (every ${strategy.scanIntervalMin} min)`)

  let recsCount = 0
  let executedCount = 0
  let scanSymbols: string[] = []
  let skipReason: string | undefined

  try {
    const result = await runStrategyScan(strategy)
    recsCount = result.recommendations.length
    scanSymbols = result.recommendations.map(r => r.symbol)
    if (recsCount === 0) {
      skipReason = result.message
      if (result.message) console.log(`[cron strategy:${strategy.id}] 0 recs: ${result.message}`)
    } else {
      const accounts = getAccountList()
      const targetAccounts = state.selectedAccounts.filter(a => !!state.kiteTokens[a])
      if (targetAccounts.length === 0) {
        console.log(`[cron strategy:${strategy.id}] no selectedAccounts with tokens`)
        skipReason = 'No selectedAccounts with valid tokens'
      } else {
        console.log(`[cron strategy:${strategy.id}] ${recsCount} rec(s) → ${targetAccounts.length} account(s)`)
        for (const account of targetAccounts) {
          const display = accounts.find(a => a.name === account)?.displayName
          const beforeExec = dayStats.executed.length
          await autoBuyOnAccount(account, display, result.recommendations)
          executedCount += (dayStats.executed.length - beforeExec)
        }
      }
    }
  } catch (err) {
    console.error(`[cron strategy:${strategy.id}] scan failed:`, err)
    skipReason = `Scan crashed: ${String(err).slice(0, 120)}`
  }

  // Journal this scan tick so the daily retrospective can compute per-strategy
  // health: scans/signals/executions counts + last-signal-date. Fire-and-forget.
  appendJournal({
    type: 'strategy_scan',
    date: istDateString(),
    ts: new Date().toISOString(),
    strategyId: strategy.id,
    strategyName: strategy.name,
    recs: recsCount,
    executed: executedCount,
    symbols: scanSymbols.length > 0 ? scanSymbols : undefined,
    skipReason,
  }).catch(err => console.error(`[cron strategy:${strategy.id}] journal scan failed:`, err))
}

// ──────── DAILY RETROSPECTIVE (15:35 IST) ────────
//
// Replaces the old plain-text EOD summary. Builds a journal-backed report
// (today's trades + missed signals + 30-day rolling stats + fine-tuning
// bullets), enriches with live Kite OHLC so finalDayHigh/leftOnTable reflect
// the full session, and emails it as an HTML report.
//
// Skip rules (per spec):
//   - weekend or NSE holiday        → skip
//   - no trades AND no signals      → skip ("no empty reports")
//   - SMTP not configured           → skip with warning
//
// On the last trading day of the month we additionally fire a monthly rollup.

async function dailyRetrospective(): Promise<void> {
  maybeRollDay()
  if (!isMarketDay()) {
    console.log('[cron retro] not a market day — skipping')
    return
  }

  // Final EOD sweep — closes any positions sold manually during the day.
  // Runs here (15:35) so closing LTPs are available as the fallback price for
  // prior-day sells where no today's order is found.
  try { await reconcileManualSells() } catch (err) { console.error('[cron retro] reconcile manual sells failed:', err) }

  if (!isEmailConfigured()) {
    console.warn('[cron retro] SMTP not configured — skipping')
    return
  }

  const today = istDateString()
  try {
    const report = await buildDailyReport(today)
    // Always send on a trading day. Even with zero trades, the report acts as
    // a "daily diary": shows open positions, capital status, strategy health,
    // and confirms the engine ran (or that you stayed in manual mode all day).
    console.log(`[cron retro] ${today} — sending daily report: ${report.tradesCount} trades, ${report.missedSignals.length} missed signals`)
    await sendDailyReport(report)
  } catch (err) {
    console.error('[cron retro] daily report failed:', err)
  }

  // Monthly rollup — fire on the last trading day of the month, even if today's
  // daily report was skipped (the month may have plenty of activity earlier).
  if (isLastWeekdayOfMonth(today)) {
    try {
      const monthly = await buildMonthlyReport(today)
      if (monthly.totalTrades === 0 && monthly.signalsMissed === 0) {
        console.log(`[cron retro] ${today} — last trading day, but month had zero activity — skipping monthly`)
      } else {
        console.log(`[cron retro] ${today} — sending monthly rollup for ${monthly.monthLabel}: ${monthly.totalTrades} trades`)
        await sendMonthlyReport(monthly)
      }
    } catch (err) {
      console.error('[cron retro] monthly rollup failed:', err)
    }
  }
}

// ──────── REGISTRATION ────────

export function startCron(): void {
  if (started) return
  if (process.env.CRON_ENABLED !== 'true') {
    console.log('[cron] disabled (set CRON_ENABLED=true to enable)')
    return
  }
  started = true

  // Core 5-min tick: SELL monitors + reactive dip scan only. BUY scans live
  // on per-strategy schedules below.
  tickTask = cron.schedule('*/5 9-15 * * 1-5', () => {
    tick().catch(err => console.error('[cron tick] error:', err))
  }, { timezone: 'Asia/Kolkata' })

  // Daily retrospective email
  eodTask = cron.schedule('35 15 * * 1-5', () => {
    dailyRetrospective().catch(err => console.error('[cron retro] error:', err))
  }, { timezone: 'Asia/Kolkata' })

  // Per-strategy BUY-scan tasks. Each active strategy registers its own cron
  // at its scanIntervalMin. Inactive strategies are skipped here; toggling
  // active=true in strategy.json + a process restart will pick them up. Phase
  // 4 will add hot-toggle without restart.
  const active = getActiveStrategies()
  for (const strategy of active) {
    registerStrategyTask(strategy)
  }
  const summary = active.map(s => `${s.id}@${s.scanIntervalMin}m`).join(', ')
  console.log(`[cron] starting — core tick every 5 min · retro 15:35 IST · per-strategy: ${summary || 'none'}`)
}

function registerStrategyTask(strategy: Strategy): void {
  if (strategyTasks.has(strategy.id)) return
  const interval = Math.max(1, strategy.scanIntervalMin)
  const expr = `*/${interval} 9-15 * * 1-5`
  const task = cron.schedule(expr, () => {
    // Always re-resolve the strategy by id each tick — picks up any post-save
    // params/watchlist/exits without needing to restart the cron task.
    const fresh = require('./strategyConfig').getStrategyById(strategy.id) as Strategy | null
    if (!fresh || !fresh.active) return
    runStrategyTaskBody(fresh).catch(err => console.error(`[cron strategy:${strategy.id}] error:`, err))
  }, { timezone: 'Asia/Kolkata' })
  strategyTasks.set(strategy.id, task)
}

// HOT-RELOAD helpers used by POST /api/strategies. Compares the new active
// set + scanIntervalMin against currently-registered tasks and adjusts:
// new active strategies → register; deactivated strategies → unregister;
// scanIntervalMin changes → restart (stop + register).
export function reloadCronStrategies(): { added: string[]; removed: string[]; restarted: string[] } {
  if (!started) return { added: [], removed: [], restarted: [] }
  const active = getActiveStrategies()
  const activeIds = new Set(active.map(s => s.id))
  const added: string[] = []
  const removed: string[] = []
  const restarted: string[] = []

  // Remove tasks for strategies that are no longer active
  Array.from(strategyTasks.keys()).forEach(id => {
    if (!activeIds.has(id)) {
      strategyTasks.get(id)!.stop()
      strategyTasks.delete(id)
      removed.push(id)
    }
  })

  // Add or restart per the new active list
  for (const s of active) {
    const existing = strategyTasks.get(s.id)
    if (!existing) {
      registerStrategyTask(s)
      added.push(s.id)
    } else {
      // Restart so any scanIntervalMin change takes effect. The task body
      // re-resolves the strategy each fire anyway, but the cron expression
      // (which encodes the interval) must be rebuilt.
      existing.stop()
      strategyTasks.delete(s.id)
      registerStrategyTask(s)
      restarted.push(s.id)
    }
  }

  console.log(`[cron] hot-reload: +${added.length} added, -${removed.length} removed, ~${restarted.length} restarted`)
  return { added, removed, restarted }
}

export function stopCron(): void {
  if (tickTask) { tickTask.stop(); tickTask = null }
  if (eodTask)  { eodTask.stop();  eodTask = null }
  Array.from(strategyTasks.values()).forEach(t => t.stop())
  strategyTasks.clear()
  started = false
}
