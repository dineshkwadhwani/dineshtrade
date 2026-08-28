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
import { getBackendInfo, getState, saveState } from './state'
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
import { checkAndSendTokenAlert, sendPrimaryTokenMissingAlert } from './tokenAlert'
import { listPositions } from './positions'
import { getSupabaseAdmin, withCustomer } from './supabase'
import { decrypt } from './encryption'
import { getQuotes, setTickQuoteCache, clearTickQuoteCache } from './kite'
import { rehydrateForCustomer, waitForInitialHydration } from './strategyConfigStore'

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

function envTrue(key: string): boolean {
  return String(process.env[key] || '').trim().toLowerCase() === 'true'
}

// Test-only switches for validating AUTO cron behavior after market hours.
const CRON_TEST_ALL_DAY = envTrue('CRON_TEST_ALL_DAY')
const CRON_TEST_IGNORE_MARKET_HOURS = envTrue('CRON_TEST_IGNORE_MARKET_HOURS')

function weekdayHoursField(): string {
  return CRON_TEST_ALL_DAY ? '*' : '9-15'
}

function everyNWeekdayMinutesExpr(intervalMin: number): string {
  return `*/${Math.max(1, intervalMin)} ${weekdayHoursField()} * * 1-5`
}

function atMinuteWeekdayExpr(minute: number, hour: number): string {
  return CRON_TEST_ALL_DAY ? `${minute} * * * 1-5` : `${minute} ${hour} * * 1-5`
}

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

// ──────── MULTI-CUSTOMER SUPPORT ────────

// Parses CUSTOMER_IDS env var. Returns an array of UUIDs.
function parseCustomerIds(): string[] {
  return (process.env.CUSTOMER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
}

// Loads the Zerodha access token from broker_accounts for a customer.
// Returns null if no active row or no token yet captured.
async function loadKiteToken(customerId: string): Promise<{ apiKey: string; accessToken: string } | null> {
  try {
    const admin = getSupabaseAdmin()
    const { data } = await admin
      .from('broker_accounts')
      .select('access_token_enc, api_key_enc')
      .eq('customer_id', customerId)
      .eq('broker_name', 'zerodha')
      .eq('active', true)
      .maybeSingle()
    if (!data?.access_token_enc) return null
    const accessToken = decrypt(data.access_token_enc)
    const customerApiKey = data.api_key_enc ? (() => { try { return decrypt(data.api_key_enc!) } catch { return '' } })() : ''
    if (!customerApiKey) return null
    return { apiKey: customerApiKey, accessToken }
  } catch (err) {
    console.error(`[cron] loadKiteToken(${customerId}) failed:`, err)
    return null
  }
}

// Builds the union of all watchlist symbols across all customers.
// Uses primary customer's context since watchlists are customer-scoped.
async function collectAllWatchlistSymbols(customerIds: string[]): Promise<string[]> {
  const symbolSet = new Set<string>()
  const admin = getSupabaseAdmin()
  for (const customerId of customerIds) {
    try {
      const { data: rows } = await admin
        .from('customer_watchlists')
        .select('symbols')
        .eq('customer_id', customerId)
      for (const row of rows ?? []) {
        const entries: { nse?: string }[] = Array.isArray(row.symbols) ? row.symbols : []
        for (const e of entries) {
          if (e.nse) symbolSet.add(e.nse.toUpperCase())
        }
      }
    } catch (err) {
      console.error(`[cron] collectAllWatchlistSymbols(${customerId}) failed:`, err)
    }
  }
  return Array.from(symbolSet)
}

// Runs the full tick for one customer inside their async context.
// Loads their own Kite token (for order placement), seeds state.kiteTokens,
// then runs tick(). Market data (quotes) is already in the per-tick cache
// from the primary account pre-fetch — no extra Kite data API calls needed.
async function runCustomerTick(customerId: string): Promise<void> {
  await withCustomer(customerId, async () => {
    const credentials = await loadKiteToken(customerId)
    if (credentials) {
      await saveState({
        kiteTokens: { [customerId]: credentials.accessToken },
        selectedAccounts: [customerId],
      }).catch(err =>
        console.error(`[cron] customer=${customerId} saveState kiteTokens failed:`, err)
      )
    }
    // Refresh this customer's strategy config from Supabase before the tick runs
    await rehydrateForCustomer()
    await tick()
  })
}

async function runCustomerEOD(customerId: string): Promise<void> {
  const admin = getSupabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', customerId)
    .single()
  const toEmail = profile?.email || process.env.NOTIFY_TO || process.env.FROM_EMAIL || ''
  await withCustomer(customerId, () => dailyRetrospective(toEmail))
}

async function runCustomerTokenAlert(customerId: string): Promise<void> {
  await withCustomer(customerId, () => checkAndSendTokenAlert())
}

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

  const market = await isMarketOpen()
  if (!market.open && !CRON_TEST_IGNORE_MARKET_HOURS) {
    console.log(`[cron tick] skipped — market closed (${market.status})`)
    return
  }
  if (!market.open && CRON_TEST_IGNORE_MARKET_HOURS) {
    console.log(`[cron tick] test override — proceeding while market closed (${market.status})`)
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
  return everyNWeekdayMinutesExpr(currentSellCadenceMin)
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
    tickTask = cron.schedule(everyNWeekdayMinutesExpr(nextCadence), () => {
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

  const customerIds = parseCustomerIds()
  if (customerIds.length === 0) {
    throw new Error('[cron] CUSTOMER_IDS is required when CRON_ENABLED=true')
  }

  started = true
  const backend = getBackendInfo()
  console.log(`[cron] state backend=${backend.backend}${backend.path ? ` path=${backend.path}` : ''} · Running for ${customerIds.length} customer(s): ${customerIds.join(', ')}`)

  // Strategy readers are synchronous, so wait for their initial Supabase
  // hydration before registering per-strategy tasks.
  await waitForInitialHydration()

  // Core tick: loop over all customers sequentially on each fire.
  const tickExpr = await buildTickExpr()
  tickTask = cron.schedule(tickExpr, () => {
    ;(async () => {
      clearTickQuoteCache()

      // §6.7 — Primary account (first in CUSTOMER_IDS) must have a Connect
      // plan. It fetches market data for ALL customers. If its token is missing,
      // skip the entire tick and alert everyone.
      const primaryId = customerIds[0]
      const primaryCreds = await loadKiteToken(primaryId)
      if (!primaryCreds) {
        console.error(`[cron tick] primary customer ${primaryId} has no Kite token — skipping tick for all ${customerIds.length} customer(s)`)
        sendPrimaryTokenMissingAlert(primaryId, customerIds).catch(err =>
          console.error('[cron tick] sendPrimaryTokenMissingAlert failed:', err))
        return
      }

      // Pre-fetch live quotes for the union of ALL customers' watchlist symbols
      // using the primary's Connect plan API. Sets the module-level cache so
      // secondary customers' getQuotes() calls return from cache at zero cost.
      try {
        const allSymbols = await collectAllWatchlistSymbols(customerIds)
        if (allSymbols.length > 0) {
          const quotes = await getQuotes(primaryCreds, allSymbols)
          setTickQuoteCache(quotes)
          console.log(`[cron tick] pre-fetched ${Object.keys(quotes).length} quote(s) for ${allSymbols.length} symbol(s) using primary account`)
        }
      } catch (err) {
        console.error('[cron tick] pre-fetch quotes failed (continuing with empty cache):', err)
      }

      for (const customerId of customerIds) {
        try {
          await runCustomerTick(customerId)
        } catch (err) {
          console.error(`[cron] Customer ${customerId} tick failed:`, err)
        }
      }
    })().catch(err => console.error('[cron tick] loop error:', err))
  }, { timezone: 'Asia/Kolkata' })
  tickTask.start()

  sellCadenceWatcher = setInterval(() => {
    checkSellCadence().catch(err => console.error('[cron] sell cadence watcher failed:', err))
  }, 5 * 60 * 1000)

  // Daily retrospective — run for each customer, sending to their own email
  eodTask = cron.schedule(atMinuteWeekdayExpr(35, 15), () => {
    ;(async () => {
      for (const customerId of customerIds) {
        try {
          await runCustomerEOD(customerId)
        } catch (err) {
          console.error(`[cron] Customer ${customerId} EOD failed:`, err)
        }
      }
    })().catch(err => console.error('[cron retro] loop error:', err))
  }, { timezone: 'Asia/Kolkata' })
  eodTask.start()

  // Token alert — run for each customer
  tokenAlertTask = cron.schedule(atMinuteWeekdayExpr(0, 9), () => {
    ;(async () => {
      for (const customerId of customerIds) {
        try {
          await runCustomerTokenAlert(customerId)
        } catch (err) {
          console.error(`[cron] Customer ${customerId} token alert failed:`, err)
        }
      }
    })().catch(err => console.error('[cron tokenAlert] loop error:', err))
  }, { timezone: 'Asia/Kolkata' })
  tokenAlertTask.start()

  // Per-strategy BUY-scan tasks. Each active strategy runs inside ALL customers' contexts.
  const active = getActiveStrategies()
  for (const strategy of active) {
    registerStrategyTask(strategy, customerIds)
  }
  const summary = active.map(s => `${s.id}@${s.scanIntervalMin}m`).join(', ')
  console.log(`[cron] starting — core tick every ${currentSellCadenceMin} min · retro 15:35 IST · token alert 09:00 IST · per-strategy: ${summary || 'none'} · testAllDay=${CRON_TEST_ALL_DAY} · ignoreMarketHours=${CRON_TEST_IGNORE_MARKET_HOURS}`)
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

function registerStrategyTask(strategy: Strategy, customerIds: string[]): void {
  if (strategyTasks.has(strategy.id)) return
  const interval = Math.max(1, strategy.scanIntervalMin)
  const expr = everyNWeekdayMinutesExpr(interval)
  const task = cron.schedule(expr, () => {
    console.log(`[cron strategy:${strategy.id}] callback fired (${expr})`)
    ;(async () => {
      const fresh = getStrategyById(strategy.id)
      if (!fresh || !fresh.active) {
        console.log(`[cron strategy:${strategy.id}] skipped — strategy missing or inactive`)
        return
      }
      for (const customerId of customerIds) {
        try {
          await withCustomer(customerId, () => runStrategyTaskBody(fresh))
        } catch (err) {
          console.error(`[cron strategy:${strategy.id}] Customer ${customerId} failed:`, err)
        }
      }
    })().catch(err => console.error(`[cron strategy:${strategy.id}] error:`, err))
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
  const customerIds = parseCustomerIds()
  const active = getActiveStrategies()
  const activeIds = new Set(active.map(s => s.id))
  const added: string[] = []
  const removed: string[] = []
  const restarted: string[] = []

  Array.from(strategyTasks.keys()).forEach(id => {
    if (!activeIds.has(id)) {
      strategyTasks.get(id)!.stop()
      strategyTasks.delete(id)
      removed.push(id)
    }
  })

  for (const s of active) {
    const existing = strategyTasks.get(s.id)
    if (!existing) {
      registerStrategyTask(s, customerIds)
      added.push(s.id)
    } else {
      existing.stop()
      strategyTasks.delete(s.id)
      registerStrategyTask(s, customerIds)
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
