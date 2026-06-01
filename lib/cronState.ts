// Shared in-process state and helper functions for the cron subsystem.
// No imports from other cron files — this is the base of the dependency tree.

import { isMarketOpen, NSE_HOLIDAYS } from './market'
import type { EODLineItem } from './email'

// ──────── DAY-OF STATS (in-process) ────────

export let currentDateKey = ''
export let dipScanDoneDate = ''

// In-process BUY counter + new-positions set — shared across all per-strategy
// cron tasks to prevent the race condition where two concurrent tasks both pass
// the quota gate or positions gate before the other's order shows in Kite.
//
// inProcessBuyCounts: "${account}:${dateKey}" → count of auto-BUYs placed today
// inProcessNewSymbols: "${account}:${dateKey}" → Set of NEW symbols opened today
//   (symbols that weren't already in Kite holdings — each adds 1 to positions count)
//
// Both reset automatically in maybeRollDay() at midnight IST.

export const inProcessBuyCounts: Record<string, number> = {}
export const inProcessNewSymbols: Record<string, Set<string>> = {}

export const dayStats = {
  scans: 0,
  executed: [] as EODLineItem[],
  failed:   [] as EODLineItem[],
  skipped:  [] as EODLineItem[],
  delivery: [] as EODLineItem[],
  realizedPnl: {} as Record<string, number>,
}

export function istDateKey(): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const y = ist.getFullYear()
  const m = String(ist.getMonth() + 1).padStart(2, '0')
  const d = String(ist.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function istHHMM(): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${String(ist.getHours()).padStart(2,'0')}:${String(ist.getMinutes()).padStart(2,'0')}`
}

export function maybeRollDay() {
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

export function isMarketDay(): boolean {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dow = ist.getDay()
  if (dow === 0 || dow === 6) return false
  return !NSE_HOLIDAYS.includes(istDateKey())
}

// Reactive dip cadence check. Cron tick fires every 5 min; we want the
// reactive scan to fire every `intervalMin` (default 30) within
// [scanStartHHMM, scanEndHHMM]. Anchored to scanStartHHMM, so with start
// 09:15 + interval 30, fires at 09:15, 09:45, 10:15, …, 13:45.
export function shouldRunReactiveDip(nowHHMM: string, cfg: {
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

export function inProcessKey(account: string): string {
  return `${account.toUpperCase()}:${currentDateKey}`
}

export function incrementInProcessBuy(account: string): void {
  const k = inProcessKey(account)
  inProcessBuyCounts[k] = (inProcessBuyCounts[k] || 0) + 1
}

export function getInProcessBuyCount(account: string): number {
  return inProcessBuyCounts[inProcessKey(account)] || 0
}

// Call this when placing a buy for a symbol not already in Kite holdings/positions
// (i.e. it will add 1 to the open positions count).
export function registerInProcessNewSymbol(account: string, symbol: string): void {
  const k = inProcessKey(account)
  if (!inProcessNewSymbols[k]) inProcessNewSymbols[k] = new Set()
  inProcessNewSymbols[k].add(symbol.toUpperCase())
}

export function getInProcessNewPositionCount(account: string): number {
  return inProcessNewSymbols[inProcessKey(account)]?.size || 0
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
