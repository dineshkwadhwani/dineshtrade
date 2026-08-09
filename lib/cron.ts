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

// Must be first — loads .env.local before any module reads process.env
import * as dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

import cron, { ScheduledTask } from 'node-cron'
import { getBackendInfo, getState } from './state'
import { isMarketOpen } from './market'
import { getAccountList } from './accounts'
import { type EODLineItem } from './email'
import { runReactiveDipScan } from './strategyEngine'
import { getActiveStrategies, getStrategyById, type Strategy } from './strategyConfig'
import strategyCfg from '@/config/strategy.json'
import { monitorAllConnected } from './strategy2'
import { monitorAllAccountsStrategy1 } from './strategy1'
import { monitorAllPivotalAccounts } from './pivotal'
import {
  maybeRollDay, istHHMM, recordScan, recordExecuted, recordFailed,
  recordDelivery, shouldRunReactiveDip, dayStats, recordCoreTickRun,
} from './cronState'
import { autoBuyOnAccount, runStrategyTaskBody } from './cronBuy'
import { runEODSquareOff, dailyRetrospective } from './cronEOD'
import { reconcileManualSells } from './cronReconcile'
import { journalMonitorHeartbeat } from './journal'
import { getFixedRules } from './fixedRules'
import { isHeartbeatDbEnabled, updateInstanceStatus, checkKiteTokenStatus } from './instanceStatus'
import { checkAndSendTokenAlert } from './tokenAlert'
import { listPositions } from './positions'

// Re-export record functions and getDayStats so external callers that were
// using @/lib/cron keep working without any import-path change.
export {
  recordExecuted, recordFailed, recordSkipped, recordDelivery, recordPnl,
  recordScan, getDayStats,
} from './cronState'

let started = false
let tickTask: ScheduledTask | null = null
let eodTask: ScheduledTask | null = null
let tokenAlertTask: ScheduledTask | null = null

// Task 5.6 — sellMonitorCadenceMin drives the core tick's cron expression.
// node-cron can't reschedule a live task in place, so we track the interval
// this task was BUILT with and, on a periodic check, stop+recreate it if
// Fixed Rules changed. sellCadenceWatcher is that periodic check's timer.
let currentSellCadenceMin = 5
let sellCadenceWatcher: ReturnType<typeof setInterval> | null = null

// Per-strategy scan tasks. Each active strategy in strategy.json gets its own
// cron task at its scanIntervalMin. The map keys are strategy ids so we can
// start/stop individual tasks when the user toggles a strategy in Settings
// (Phase 4). For Phase 3 the registry is populated once at startCron() time.
const strategyTasks = new Map<string, ScheduledTask>()

// ──────── TICK ────────

// Task 5.3/5.4 — heartbeat + Kite token status, combined into a single
// customer_instances upsert per tick (see lib/instanceStatus.ts). No-ops
// entirely (no Supabase calls, no extra Kite API call for the token probe)
// unless the SuperAdmin has HEARTBEAT_DB_ENABLED='true' (default off).
async function reportInstanceStatus(state: Awaited<ReturnType<typeof getState>>): Promise<void> {
  if (!(await isHeartbeatDbEnabled())) return
  const [openPositions, tokenStatus] = await Promise.all([
    listPositions().catch(() => []),
    checkKiteTokenStatus(state.kiteTokens),
  ])
  const executedToday = dayStats.executed
  await updateInstanceStatus({
    cronMode: state.mode,
    kiteTokenStatus: tokenStatus,
    openPositionsCount: openPositions.length,
    todaysOrdersCount: executedToday.length,
    todaysBuyCount: executedToday.filter(e => e.side === 'BUY').length,
    todaysSellCount: executedToday.filter(e => e.side === 'SELL').length,
  })
}

async function tick(): Promise<void> {
  maybeRollDay()
  const state = await getState()

  // Heartbeat fires on every tick regardless of what happens below — the
  // health dashboard needs "last cron tick" + current mode even when trading
  // itself is paused (market closed / manual mode / no token).
  reportInstanceStatus(state).catch(err => console.error('[cron tick] instance status report failed:', err))

  const market = isMarketOpen()
  if (!market.open) {
    console.log(`[cron tick] skipped — market closed (${market.status})`)
    return
  }
  if (state.mode !== 'auto') {
    console.log(`[cron tick] skipped — mode=${state.mode}`)
    return
  }
  if (Object.keys(state.kiteTokens).length === 0) {
    console.log('[cron tick] skipped — no Kite tokens in state')
    return
  }

  recordScan()
  recordCoreTickRun()
  const t = istHHMM()
  const accs = Object.keys(state.kiteTokens)
  console.log(`[cron tick] ${t} IST — scan #${dayStats.scans} · mode=auto · accounts=${accs.join(',')}`)

  let monitorPositionsChecked = 0

  // 1a. SELL engine — Strategy 2 (intraday catalyst) monitor
  try {
    const s2Results = await monitorAllConnected()
    for (const r of s2Results) {
      monitorPositionsChecked += r.positionsChecked || 0
      for (const e of r.entries) {
        const item: EODLineItem = {
          time: t, account: e.account, symbol: e.symbol, side: 'SELL',
          quantity: e.quantity || 0, price: e.ltp, orderId: e.orderId, reason: e.reason,
        }
        if (e.action === 'sold')             recordExecuted(item)
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
      monitorPositionsChecked += r.positionsChecked || 0
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

  // 1c. SELL engine — Pivotal breakout monitor
  try {
    const pivotalResults = await monitorAllPivotalAccounts()
    for (const r of pivotalResults) {
      monitorPositionsChecked += r.positionsChecked || 0
      for (const e of r.entries) {
        const item: EODLineItem = {
          time: t, account: e.account, symbol: e.symbol, side: 'SELL',
          quantity: e.quantity || 0, price: e.ltp, orderId: e.orderId, reason: e.reason,
        }
        if (e.action === 'sold') recordExecuted(item)
        else if (e.action === 'sold_failed') recordFailed(item)
        else if (e.action === 'handoff') recordDelivery(item)
      }
    }
  } catch (err) {
    console.error('[cron tick] Pivotal monitor failed:', err)
  }

  // 1d. EOD square-off for momentum strategies
  try { await runEODSquareOff() } catch (err) { console.error('[cron tick] EOD square-off failed:', err) }

  // 1e. Manual sell reconciliation — journals any Kite SELL orders not placed
  // through the auto engine so the trade report marks those positions as closed.
  try { await reconcileManualSells() } catch (err) { console.error('[cron tick] reconcile manual sells failed:', err) }

  // 1f. REACTIVE DIP scan
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

  journalMonitorHeartbeat({
    source: 'cron',
    accountsChecked: accs.length,
    positionsChecked: monitorPositionsChecked,
  }).catch(err => console.error('[cron tick] journal monitor heartbeat failed:', err))

  // BUY scans are now handled by per-strategy cron tasks (see strategyTasks
  // registry in startCron). The 5-min tick only handles SELL monitors + the
  // reactive dip trigger above. This means a strategy with scanIntervalMin=5
  // and scanIntervalMin=30 each run at their own cadence, independent of
  // GIFT-Nifty market mode — the user controls activation explicitly in
  // strategy.json.
}

// ──────── REGISTRATION ────────

// Builds the core-tick cron expression from Fixed Rules' sellMonitorCadenceMin
// (Task 5.6) and updates currentSellCadenceMin as a side effect so the
// watcher below can detect a subsequent change.
async function buildTickExpr(): Promise<string> {
  const rules = await getFixedRules()
  currentSellCadenceMin = Math.max(1, Math.round(rules.sellMonitorCadenceMin) || 5)
  return `*/${currentSellCadenceMin} 9-15 * * 1-5`
}

// Re-reads Fixed Rules (cheap — getFixedRules() itself caches 5 min) and
// restarts the core tick task if sellMonitorCadenceMin changed since it was
// last built. Runs on its own 5-min timer, independent of the tick cadence
// itself, so a cadence change is picked up without a process restart.
async function checkSellCadence(): Promise<void> {
  try {
    const rules = await getFixedRules()
    const nextCadence = Math.max(1, Math.round(rules.sellMonitorCadenceMin) || 5)
    if (nextCadence === currentSellCadenceMin) return
    console.log(`[cron] sellMonitorCadenceMin changed ${currentSellCadenceMin} → ${nextCadence} — restarting core tick task`)
    if (tickTask) tickTask.stop()
    currentSellCadenceMin = nextCadence
    tickTask = cron.schedule(`*/${nextCadence} 9-15 * * 1-5`, () => {
      tick().catch(err => console.error('[cron tick] error:', err))
    }, { timezone: 'Asia/Kolkata' })
    tickTask.start()
  } catch (err) {
    console.error('[cron] checkSellCadence failed:', err)
  }
}

export async function startCron(): Promise<void> {
  if (started) return
  if (process.env.CRON_ENABLED !== 'true') {
    console.log('[cron] disabled (set CRON_ENABLED=true to enable)')
    return
  }
  // Task 5.2 — every customer EC2 cron process must know which single
  // customer it is scoped to. All Supabase-backed stores (positions, state,
  // journal, watchlists, strategies, ...) already call getCustomerId()
  // internally and throw on every read/write if this is unset (Phase 4) —
  // this guard just fails fast and loudly at startup instead of on the
  // first store call, with a message that names the actual problem.
  if (!process.env.CUSTOMER_ID) {
    throw new Error('[cron] CUSTOMER_ID env var is required when CRON_ENABLED=true')
  }
  started = true
  const backend = getBackendInfo()
  console.log(`[cron] state backend=${backend.backend}${backend.path ? ` path=${backend.path}` : ''} · customer=${process.env.CUSTOMER_ID}`)

  // Core tick: SELL monitors + reactive dip scan only. BUY scans live on
  // per-strategy schedules below. Interval sourced from Fixed Rules'
  // sellMonitorCadenceMin (Task 5.6) — falls back to 5 min on any read
  // failure (getFixedRules() itself never throws).
  const tickExpr = await buildTickExpr()
  tickTask = cron.schedule(tickExpr, () => {
    tick().catch(err => console.error('[cron tick] error:', err))
  }, { timezone: 'Asia/Kolkata' })
  tickTask.start()

  // Watches for sellMonitorCadenceMin changes every 5 min and restarts the
  // core tick task in place — no process restart needed for a Fixed Rules edit.
  sellCadenceWatcher = setInterval(() => {
    checkSellCadence().catch(err => console.error('[cron] sell cadence watcher failed:', err))
  }, 5 * 60 * 1000)

  // Daily retrospective email
  eodTask = cron.schedule('35 15 * * 1-5', () => {
    dailyRetrospective().catch(err => console.error('[cron retro] error:', err))
  }, { timezone: 'Asia/Kolkata' })
  eodTask.start()

  // Task 5.5 — 9:00 AM IST weekday token-status alert (this customer only).
  tokenAlertTask = cron.schedule('0 9 * * 1-5', () => {
    checkAndSendTokenAlert().catch(err => console.error('[cron tokenAlert] error:', err))
  }, { timezone: 'Asia/Kolkata' })
  tokenAlertTask.start()

  // Per-strategy BUY-scan tasks. Each active strategy registers its own cron
  // at its scanIntervalMin. Inactive strategies are skipped here; toggling
  // active=true in strategy.json + a process restart will pick them up. Phase
  // 4 will add hot-toggle without restart.
  const active = getActiveStrategies()
  for (const strategy of active) {
    registerStrategyTask(strategy)
  }
  const summary = active.map(s => `${s.id}@${s.scanIntervalMin}m`).join(', ')
  console.log(`[cron] starting — core tick every ${currentSellCadenceMin} min · retro 15:35 IST · token alert 09:00 IST · per-strategy: ${summary || 'none'}`)
}

export function ensureCronStarted(): void {
  if (process.env.CRON_ROUTE_BOOTSTRAP !== 'true') return
  // startCron() is async (Task 5.6 reads Fixed Rules before scheduling) but
  // every call site historically calls it fire-and-forget — keep that
  // contract. The CUSTOMER_ID guard (Task 5.2) is the one case that MUST be
  // loud: let it surface as an unhandled rejection / process crash rather
  // than a silently swallowed log line, since a customer EC2 running with no
  // CUSTOMER_ID must not limp along trading against the wrong (or no) data.
  startCron().catch(err => {
    console.error('[cron] startCron failed:', err)
    throw err
  })
}

function registerStrategyTask(strategy: Strategy): void {
  if (strategyTasks.has(strategy.id)) return
  const interval = Math.max(1, strategy.scanIntervalMin)
  const expr = `*/${interval} 9-15 * * 1-5`
  const task = cron.schedule(expr, () => {
    console.log(`[cron strategy:${strategy.id}] callback fired (${expr})`)
    try {
      // Always re-resolve the strategy by id each tick — picks up any post-save
      // params/watchlist/exits without needing to restart the cron task.
      const fresh = getStrategyById(strategy.id)
      if (!fresh) {
        console.log(`[cron strategy:${strategy.id}] skipped — strategy missing in runtime config`)
        return
      }
      if (!fresh.active) {
        console.log(`[cron strategy:${strategy.id}] skipped — strategy inactive in runtime config`)
        return
      }
      runStrategyTaskBody(fresh).catch(err => console.error(`[cron strategy:${strategy.id}] error:`, err))
    } catch (err) {
      console.error(`[cron strategy:${strategy.id}] callback setup failed:`, err)
    }
  }, { timezone: 'Asia/Kolkata' })
  task.start()
  strategyTasks.set(strategy.id, task)
  console.log(`[cron strategy:${strategy.id}] scheduled ${expr} Asia/Kolkata`)
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
  if (tokenAlertTask) { tokenAlertTask.stop(); tokenAlertTask = null }
  if (sellCadenceWatcher) { clearInterval(sellCadenceWatcher); sellCadenceWatcher = null }
  Array.from(strategyTasks.values()).forEach(t => t.stop())
  strategyTasks.clear()
  started = false
}
