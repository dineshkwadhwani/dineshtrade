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
import { isMarketOpen } from './market'
import { getAccountList } from './accounts'
import { type EODLineItem } from './email'
import { runReactiveDipScan } from './strategyEngine'
import { getActiveStrategies, type Strategy } from './strategyConfig'
import strategyCfg from '@/config/strategy.json'
import { monitorAllConnected } from './strategy2'
import { monitorAllAccountsStrategy1 } from './strategy1'
import { monitorAllPivotalAccounts } from './pivotal'
import {
  maybeRollDay, istHHMM, recordScan, recordExecuted, recordFailed,
  recordDelivery, shouldRunReactiveDip, dayStats,
} from './cronState'
import { autoBuyOnAccount, runStrategyTaskBody } from './cronBuy'
import { runEODSquareOff, dailyRetrospective } from './cronEOD'
import { reconcileManualSells } from './cronReconcile'

// Re-export record functions and getDayStats so external callers that were
// using @/lib/cron keep working without any import-path change.
export {
  recordExecuted, recordFailed, recordSkipped, recordDelivery, recordPnl,
  recordScan, getDayStats,
} from './cronState'

let started = false
let tickTask: ScheduledTask | null = null
let eodTask: ScheduledTask | null = null

// Per-strategy scan tasks. Each active strategy in strategy.json gets its own
// cron task at its scanIntervalMin. The map keys are strategy ids so we can
// start/stop individual tasks when the user toggles a strategy in Settings
// (Phase 4). For Phase 3 the registry is populated once at startCron() time.
const strategyTasks = new Map<string, ScheduledTask>()

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

  // BUY scans are now handled by per-strategy cron tasks (see strategyTasks
  // registry in startCron). The 5-min tick only handles SELL monitors + the
  // reactive dip trigger above. This means a strategy with scanIntervalMin=5
  // and scanIntervalMin=30 each run at their own cadence, independent of
  // GIFT-Nifty market mode — the user controls activation explicitly in
  // strategy.json.
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

export function ensureCronStarted(): void {
  if (process.env.CRON_ROUTE_BOOTSTRAP === 'true') startCron()
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
