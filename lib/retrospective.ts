// Daily retrospective — collects today's journal records, enriches with live
// Kite OHLC (so day-high/left-on-table reflect the full session), and computes
// rolling 30-day stats. Used by both the cron'd email and the in-app Retrospective tab.

import strategyCfg from '@/config/strategy.json'
import {
  readJournalDay, readJournalRange, readJournalMonth, istDateString,
  type TradeRecord, type SignalSkippedRecord,
} from './journal'
import { listStrategy1Positions } from './strategy1'
import { resolveAccountCreds, getQuotes } from './kite'
import { getState } from './state'
import type { MonthlyReportData } from './email'

export interface EnrichedTrade extends TradeRecord {
  finalDayHigh?: number
  finalLeftOnTable?: number
}

export type MissedOutcome = 'good_miss' | 'missed_opportunity' | 'unknown'

export interface EnrichedMissed extends SignalSkippedRecord {
  finalClose?: number
  hitT1?: boolean
  outcome: MissedOutcome
}

export interface DailyReport {
  date: string                // YYYY-MM-DD IST
  displayDate: string         // "18 May 2026 (Monday)"
  shouldSend: boolean
  skipReason?: string

  // Section 1 — hero
  tradesCount: number
  wins: number
  totalPnl: number
  capitalDeployed: number

  // Section 2 — trade-by-trade
  trades: EnrichedTrade[]

  // Section 3 — missed signals
  missedSignals: EnrichedMissed[]

  // Section 4 — rolling 30-day
  rolling30: {
    sampleSize: number
    winRate: number | null
    avgGainPct: number | null
    deliveryOpen: number
    capitalEfficiency: number | null
  }

  // Section 5 — fine-tuning (empty if nothing actionable)
  fineTuning: string[]
}

function formatDisplayDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(n => parseInt(n, 10))
  const date = new Date(Date.UTC(y, m - 1, d))
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getUTCDay()]
  return `${d} ${month} ${y} (${dayName})`
}

// Best-effort batched quote fetch — uses the first connected account's creds.
async function fetchDayOHLC(symbols: string[]): Promise<Record<string, { high: number; low: number; close: number; ltp: number }>> {
  if (symbols.length === 0) return {}
  try {
    const state = await getState()
    const firstAcc = Object.keys(state.kiteTokens)[0]
    if (!firstAcc) return {}
    const creds = await resolveAccountCreds(firstAcc)
    if (!creds.ok) return {}
    const quotes = await getQuotes({ apiKey: creds.apiKey, accessToken: creds.accessToken }, Array.from(new Set(symbols)))
    const out: Record<string, { high: number; low: number; close: number; ltp: number }> = {}
    for (const [k, v] of Object.entries(quotes)) {
      const sym = k.replace(/^NSE:/, '')
      const ohlc = (v as any).ohlc || {}
      out[sym] = {
        high: Number(ohlc.high) || Number((v as any).last_price) || 0,
        low:  Number(ohlc.low)  || Number((v as any).last_price) || 0,
        close: Number((v as any).last_price) || 0,
        ltp:  Number((v as any).last_price) || 0,
      }
    }
    return out
  } catch (err) {
    console.warn('[retrospective] OHLC enrichment failed:', String(err).slice(0, 200))
    return {}
  }
}

function generateFineTuning(opts: {
  todayTrades: EnrichedTrade[]
  todayMissed: EnrichedMissed[]
  rolling: TradeRecord[]
  rolling30Stats: DailyReport['rolling30']
}): string[] {
  const bullets: string[] = []

  // 1. T1 leaves money on the table
  const last10 = opts.rolling.slice(-10).filter(t => t.verdict === 'correct_exit' && t.exitPrice > 0)
  if (last10.length >= 8) {
    const avgLeftPct = last10.reduce((s, t) => s + (t.leftOnTable / Math.max(1, t.exitPrice)), 0) / last10.length * 100
    if (avgLeftPct > 1.5) {
      bullets.push(`Last ${last10.length} T1 exits left an average of +${avgLeftPct.toFixed(2)}% on the table — consider raising T1 from +${strategyCfg.targets.intraday_t1_pct}% to +${(strategyCfg.targets.intraday_t1_pct + 0.3).toFixed(1)}%.`)
    }
  }

  // 2. Missed signals that actually hit T1 today
  const missedOpps = opts.todayMissed.filter(m => m.outcome === 'missed_opportunity').length
  if (opts.todayMissed.length >= 3 && missedOpps / opts.todayMissed.length > 0.4) {
    bullets.push(`${missedOpps} of ${opts.todayMissed.length} skipped signals hit T1 today — check if the filter is too strict or if quota / funds gates are firing too aggressively.`)
  }

  // 3. Win rate vs 70% target (rolling)
  if (opts.rolling30Stats.sampleSize >= 10 && opts.rolling30Stats.winRate !== null) {
    if (opts.rolling30Stats.winRate < 60) {
      bullets.push(`30-day win rate is ${opts.rolling30Stats.winRate.toFixed(0)}% — below the 70% target. Review entry criteria, particularly the volume + candle filters.`)
    } else if (opts.rolling30Stats.winRate >= 85) {
      bullets.push(`30-day win rate is ${opts.rolling30Stats.winRate.toFixed(0)}% — comfortably above target. Could consider tightening filters slightly to increase rec count without sacrificing quality.`)
    }
  }

  return bullets.slice(0, 3)
}

export async function buildDailyReport(dateYmd?: string): Promise<DailyReport> {
  const date = dateYmd || istDateString()
  const displayDate = formatDisplayDate(date)

  // Today's journal
  const todays = await readJournalDay(date)
  const tradesToday = todays.filter((r): r is TradeRecord => r.type === 'trade')
  const missedToday = todays.filter((r): r is SignalSkippedRecord => r.type === 'signal_skipped')

  // Enrich both with current day OHLC
  const allSymbols = [
    ...tradesToday.map(t => t.symbol),
    ...missedToday.map(m => m.symbol),
  ]
  const ohlc = await fetchDayOHLC(allSymbols)

  const trades: EnrichedTrade[] = tradesToday.map(t => {
    const ohlcRow = ohlc[t.symbol.toUpperCase()]
    const finalDayHigh = ohlcRow?.high ?? t.dayHighAfterEntry
    return {
      ...t,
      finalDayHigh,
      finalLeftOnTable: Math.max(0, finalDayHigh - t.exitPrice),
    }
  })

  const missedSignals: EnrichedMissed[] = missedToday.map(m => {
    const ohlcRow = ohlc[m.symbol.toUpperCase()]
    if (!ohlcRow || !m.signalPrice) return { ...m, outcome: 'unknown' as MissedOutcome }
    const t1Trigger = m.signalPrice * (1 + strategyCfg.targets.intraday_t1_pct / 100)
    const hitT1 = ohlcRow.high >= t1Trigger
    return {
      ...m, finalClose: ohlcRow.close, hitT1,
      outcome: hitT1 ? 'missed_opportunity' : 'good_miss',
    }
  })

  // Section 1 — hero
  const wins = trades.filter(t => t.pnlRupees > 0).length
  const totalPnl = trades.reduce((s, t) => s + t.pnlRupees, 0)
  const capitalDeployed = trades.reduce((s, t) => s + (t.entryPrice * t.qty), 0)

  // Section 4 — rolling 30-day
  const today = new Date(date + 'T00:00:00Z')
  const startDate = new Date(today); startDate.setDate(startDate.getDate() - 29)
  const startYmd = startDate.toISOString().slice(0, 10)
  const rollingAll = await readJournalRange(startYmd, date)
  const rollingTrades = rollingAll.filter((r): r is TradeRecord => r.type === 'trade')
  const winsR = rollingTrades.filter(t => t.pnlRupees > 0).length
  const winRate = rollingTrades.length > 0 ? (winsR / rollingTrades.length) * 100 : null
  const avgGainPct = rollingTrades.length > 0
    ? rollingTrades.reduce((s, t) => s + t.pnlPct, 0) / rollingTrades.length
    : null
  const deliveryOpen = (await listStrategy1Positions()).length
  const totalCapital = rollingTrades.reduce((s, t) => s + (t.entryPrice * t.qty), 0)
  const totalPnlR = rollingTrades.reduce((s, t) => s + t.pnlRupees, 0)
  const capitalEfficiency = totalCapital > 0 ? (totalPnlR / totalCapital) * 100 : null

  const rolling30 = {
    sampleSize: rollingTrades.length,
    winRate, avgGainPct, deliveryOpen, capitalEfficiency,
  }

  // Section 5 — fine-tuning
  const fineTuning = generateFineTuning({ todayTrades: trades, todayMissed: missedSignals, rolling: rollingTrades, rolling30Stats: rolling30 })

  // Skip rules
  const hasActivity = trades.length > 0 || missedSignals.length > 0
  const shouldSend = hasActivity

  return {
    date, displayDate, shouldSend,
    skipReason: hasActivity ? undefined : 'No trades and no signals today',
    tradesCount: trades.length, wins, totalPnl, capitalDeployed,
    trades, missedSignals, rolling30, fineTuning,
  }
}

// Aggregates the month's journal into a MonthlyReportData payload. Pass any
// date in the target month (defaults to "today IST"); we slice to YYYY-MM.
export async function buildMonthlyReport(dateYmd?: string): Promise<MonthlyReportData> {
  const date = dateYmd || istDateString()
  const ym = date.slice(0, 7)
  const [y, m] = ym.split('-').map(n => parseInt(n, 10))
  const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]
  const monthLabel = `${monthName} ${y}`

  const records = await readJournalMonth(ym)
  const trades = records.filter((r): r is TradeRecord => r.type === 'trade')
  const skipped = records.filter((r): r is SignalSkippedRecord => r.type === 'signal_skipped')

  const totalTrades = trades.length
  const wins = trades.filter(t => t.pnlRupees > 0).length
  const totalPnl = trades.reduce((s, t) => s + t.pnlRupees, 0)

  // Best / worst by absolute rupee P&L
  let best: MonthlyReportData['best'] | undefined
  let worst: MonthlyReportData['worst'] | undefined
  for (const t of trades) {
    if (!best || t.pnlRupees > best.pnl) best = { symbol: t.symbol, pnl: t.pnlRupees, pct: t.pnlPct, date: t.date }
    if (!worst || t.pnlRupees < worst.pnl) worst = { symbol: t.symbol, pnl: t.pnlRupees, pct: t.pnlPct, date: t.date }
  }

  // Avg daily return: average of (sum-of-pct-per-day) across days that traded.
  const byDate = new Map<string, number>()
  for (const t of trades) byDate.set(t.date, (byDate.get(t.date) || 0) + t.pnlPct)
  const dailyReturns = Array.from(byDate.values())
  const avgDailyReturn = dailyReturns.length > 0
    ? dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length
    : 0

  const signalsMissed = skipped.length

  // Lightweight recommendation — surfaces the single most actionable signal.
  let recommendation: string | undefined
  if (totalTrades >= 5) {
    const winRate = (wins / totalTrades) * 100
    if (winRate < 60) {
      recommendation = `Win rate ${winRate.toFixed(0)}% is below the 70% target — review entry filters (volume + 3-candle momentum) before next month.`
    } else if (avgDailyReturn < 0.3 && totalTrades >= 10) {
      recommendation = `Win rate is healthy but avg daily return of ${avgDailyReturn.toFixed(2)}% is light — consider raising T1 from +${strategyCfg.targets.intraday_t1_pct}% to +${(strategyCfg.targets.intraday_t1_pct + 0.3).toFixed(1)}%.`
    } else if (winRate >= 75 && totalTrades < 8) {
      recommendation = `Quality is excellent (${winRate.toFixed(0)}% wins) but volume is light (${totalTrades} trades) — consider loosening the funds-gate or expanding the candidate universe.`
    }
  }

  return {
    monthLabel, totalTrades, wins, totalPnl, best, worst,
    avgDailyReturn, signalsMissed, recommendation,
  }
}

// Useful for "is today the last trading day of the month?" → monthly rollup
export function isLastWeekdayOfMonth(dateYmd: string): boolean {
  const [y, m, d] = dateYmd.split('-').map(n => parseInt(n, 10))
  const today = new Date(Date.UTC(y, m - 1, d))
  for (let i = 1; i <= 5; i++) {
    const next = new Date(today); next.setUTCDate(next.getUTCDate() + i)
    if (next.getUTCMonth() !== today.getUTCMonth()) return true  // exhausted month
    const dow = next.getUTCDay()
    if (dow !== 0 && dow !== 6) return false  // a weekday exists ahead
  }
  return true
}
