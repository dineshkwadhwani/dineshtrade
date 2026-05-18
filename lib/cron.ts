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
import { sendEODSummary, sendEmail, isEmailConfigured, type EODLineItem } from './email'
import { generateRecommendations, getMarketMode, type Recommendation } from './strategyEngine'
import { monitorAllConnected, STRATEGY_2_BUY_TAG } from './strategy2'
import {
  monitorAllAccountsStrategy1, recordStrategy1Buy, STRATEGY_1_BUY_TAG,
} from './strategy1'
import { resolveAccountCreds, placeKiteOrder } from './kite'
import { runPreflight, markPlaced } from './preflight'

let started = false
let tickTask: ScheduledTask | null = null
let eodTask: ScheduledTask | null = null

// ──────── DAY-OF STATS (in-process) ────────

let currentDateKey = ''
// Strategy 1 (dip mode) runs once per day. Strategy 2 (catalyst) runs every tick
// during 9:30–14:30 IST via the strategyEngine's own time-window check.
let dipScanDoneDate = ''
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
  }
}

function isMarketDay(): boolean {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dow = ist.getDay()
  if (dow === 0 || dow === 6) return false
  return !NSE_HOLIDAYS.includes(istDateKey())
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
  for (const rec of recs) {
    const pre = await runPreflight({
      account, symbol: rec.symbol, side: 'BUY',
      quantity: rec.suggestedQty, pricePerShare: rec.price,
    })
    if (!pre.ok) {
      recordSkipped({
        time: istHHMM(), account, symbol: rec.symbol, side: 'BUY', quantity: rec.suggestedQty,
        reason: `[${pre.gate}] ${pre.reason}`,
      })
      sendEmail('trade_failed', {
        account, accountDisplayName, symbol: rec.symbol, side: 'BUY',
        quantity: rec.suggestedQty, price: rec.price,
        failedAt: 'preflight', gate: pre.gate, reason: pre.reason || 'Unknown',
        mode: 'auto',
      }).catch(err => console.error('[cron autoBuy] preflight-email failed:', err))
      continue
    }
    const tag = rec.strategy === 'oscillator' ? STRATEGY_1_BUY_TAG : STRATEGY_2_BUY_TAG
    const placed = await placeKiteOrder(creds, {
      symbol: rec.symbol, side: 'BUY', quantity: rec.suggestedQty, tag,
    })
    if (placed.ok && placed.data?.data?.order_id) {
      markPlaced(account, rec.symbol, 'BUY')
      // Persist Strategy 1 position so the SELL monitor manages it across days.
      if (rec.strategy === 'oscillator') {
        recordStrategy1Buy(account, rec.symbol, rec.suggestedQty, rec.price)
          .catch(err => console.error('[cron autoBuy] strategy1 record failed:', err))
      }
      recordExecuted({
        time: istHHMM(), account, symbol: rec.symbol, side: 'BUY',
        quantity: rec.suggestedQty, price: rec.price, orderId: placed.data.data.order_id,
      })
      sendEmail('trade_executed', {
        account, accountDisplayName, symbol: rec.symbol, symbolName: rec.name,
        side: 'BUY', quantity: rec.suggestedQty, price: rec.price,
        target1: rec.target1, target2: rec.target2, stopLoss: rec.stopLoss,
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
  console.log(`[cron tick] ${t} IST — scan #${dayStats.scans}`)

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

  // 2. BUY scan — Strategy 2 (catalyst) every tick; Strategy 1 (dip) first of day only.
  try {
    const modeInfo = await getMarketMode()
    if (!modeInfo) {
      console.log('[cron tick] BUY scan skipped — no market mode (briefing fetch failed?)')
      return
    }
    if (modeInfo.mode === 'circuit') return
    if (modeInfo.mode === 'error') return

    let shouldScan = false
    if (modeInfo.mode === 'catalyst') {
      shouldScan = true   // every tick; runStrategy2's internal window check gates 9:30-14:30
    } else if (modeInfo.mode === 'dip' && dipScanDoneDate !== currentDateKey) {
      dipScanDoneDate = currentDateKey
      shouldScan = true
    }

    if (!shouldScan) return

    const result = await generateRecommendations()
    if (result.recommendations.length === 0) {
      if (result.message) console.log(`[cron tick] BUY scan — ${result.mode}, 0 recs: ${result.message}`)
      return
    }
    const accounts = getAccountList()
    const targetAccounts = state.selectedAccounts.filter(a => !!state.kiteTokens[a])
    if (targetAccounts.length === 0) {
      console.log('[cron tick] BUY scan — no selectedAccounts with tokens')
      return
    }
    for (const account of targetAccounts) {
      const display = accounts.find(a => a.name === account)?.displayName
      await autoBuyOnAccount(account, display, result.recommendations)
    }
  } catch (err) {
    console.error('[cron tick] BUY scan failed:', err)
  }
}

// ──────── EOD SUMMARY ────────

async function eodSummary(): Promise<void> {
  maybeRollDay()
  if (!isMarketDay()) return
  if (!isEmailConfigured()) return
  if (dayStats.scans === 0 && dayStats.executed.length === 0
      && dayStats.failed.length === 0 && dayStats.delivery.length === 0) {
    console.log('[cron eod] no activity today, skipping email')
    return
  }
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dateStr = ist.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ` (${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][ist.getDay()]})`
  await sendEODSummary({
    date: dateStr,
    scans: dayStats.scans,
    executed: dayStats.executed,
    failed: dayStats.failed,
    skipped: dayStats.skipped,
    delivery: dayStats.delivery,
    realizedPnl: dayStats.realizedPnl,
  })
}

// ──────── REGISTRATION ────────

export function startCron(): void {
  if (started) return
  if (process.env.CRON_ENABLED !== 'true') {
    console.log('[cron] disabled (set CRON_ENABLED=true to enable)')
    return
  }
  started = true
  console.log('[cron] starting — tick every 5 min during 9:15–15:30 IST Mon–Fri; EOD summary at 15:35 IST')

  tickTask = cron.schedule('*/5 9-15 * * 1-5', () => {
    tick().catch(err => console.error('[cron tick] error:', err))
  }, { timezone: 'Asia/Kolkata' })

  eodTask = cron.schedule('35 15 * * 1-5', () => {
    eodSummary().catch(err => console.error('[cron eod] error:', err))
  }, { timezone: 'Asia/Kolkata' })
}

export function stopCron(): void {
  if (tickTask) { tickTask.stop(); tickTask = null }
  if (eodTask)  { eodTask.stop();  eodTask = null }
  started = false
}
