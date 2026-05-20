// Daily retrospective — collects today's journal records, enriches with live
// Kite OHLC (so day-high/left-on-table reflect the full session), and computes
// rolling 30-day stats. Used by both the cron'd email and the in-app Retrospective tab.

import strategyCfg from '@/config/strategy.json'
import {
  readJournalDay, readJournalRange, readJournalMonth, istDateString,
  type TradeRecord, type SignalSkippedRecord, type StrategyScanRecord,
} from './journal'
import { listStrategy1Positions } from './strategy1'
import { resolveAccountCreds, getQuotes, getOrders, getHoldings, getPositions } from './kite'
import { getState } from './state'
import { getCapital, getStrategies } from './strategyConfig'
import { listStrategy2Positions } from './strategy2Positions'
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

// One row in the "Today's Activity" section — all Kite orders placed today.
export interface ActivityRow {
  time: string              // "HH:MM"
  account: string
  symbol: string
  side: 'BUY' | 'SELL'
  qty: number
  price: number
  status: string
  tag?: string
}

// One row in the "Open Positions" section — symbols currently held.
export interface OpenPositionRow {
  account: string
  symbol: string
  qty: number
  avgPrice: number
  ltp: number
  pnl: number
  pnlPct: number
  strategySource: 's1' | 's2' | 'pre' | 'mixed'   // where the position came from
  pyramidStatus?: string    // e.g. "2/3 BUYs"
  s2HandoffIn?: number      // days until S2→S1 handoff (only for S2-managed positions)
}

// Per-strategy diagnostics — answers "is this strategy actually working?"
export interface StrategyHealthRow {
  id: string
  name: string
  active: boolean
  scans30d: number
  signals30d: number       // count of scans where recs > 0
  executions30d: number    // count of scans where executed > 0 (cumulative executions)
  lastSignalAt: string | null
  daysSinceLastSignal: number | null
  warning?: string         // populated when something diagnostic is wrong
}

export interface DailyReport {
  date: string                // YYYY-MM-DD IST
  displayDate: string         // "18 May 2026 (Monday)"
  shouldSend: boolean
  skipReason?: string

  // Hero
  tradesCount: number         // completed round trips today (legacy)
  wins: number
  totalPnl: number
  capitalDeployed: number     // historical: capital used by completed round trips today

  // NEW — Today's activity (all orders, BUY+SELL)
  activityToday: ActivityRow[]
  capitalDeployedToday: number    // sum of today's BUY notional
  capitalRecoveredToday: number   // sum of today's SELL notional

  // NEW — Open positions snapshot
  openPositions: OpenPositionRow[]
  openPositionValue: number       // total ₹ across all open positions at LTP

  // NEW — Capital status (vs caps)
  capitalStatus: {
    available: number              // from Kite margins
    maxDeployable: number          // available × maxDeployPct/100
    deployedNow: number            // qty × LTP across all open positions
    remainingDeployable: number
    pctDeployed: number            // 0-100
  } | null

  // Trades + missed (existing)
  trades: EnrichedTrade[]
  missedSignals: EnrichedMissed[]

  // 30-day rolling (existing, now meaningful even with 0 trades via openCount)
  rolling30: {
    sampleSize: number
    winRate: number | null
    avgGainPct: number | null
    deliveryOpen: number
    capitalEfficiency: number | null
  }

  // NEW — Per-strategy health
  strategyHealth: StrategyHealthRow[]

  // Fine-tuning bullets (existing)
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

  // ── NEW SECTIONS ──

  // Activity today + open positions snapshot + capital status — pulled live
  // from Kite for the first connected account. Best-effort: if Kite is down
  // or no account connected, sections render empty without breaking the email.
  const { activityToday, openPositions, capitalStatus, capitalDeployedToday, capitalRecoveredToday, openPositionValue } =
    await buildLiveSnapshot(date)

  // Per-strategy 30-day health from journal strategy_scan records
  const strategyHealth = buildStrategyHealth(rollingAll, date)

  // Skip rules — expanded: send if ANY of (trades, missed signals, today's
  // orders, open positions). On a low-activity day we still want the report
  // to show carry-forward positions + strategy health.
  const hasActivity = trades.length > 0 || missedSignals.length > 0 || activityToday.length > 0 || openPositions.length > 0
  const shouldSend = hasActivity

  return {
    date, displayDate, shouldSend,
    skipReason: hasActivity ? undefined : 'No trades, no signals, no open positions',
    tradesCount: trades.length, wins, totalPnl, capitalDeployed,
    activityToday, capitalDeployedToday, capitalRecoveredToday,
    openPositions, openPositionValue,
    capitalStatus,
    trades, missedSignals, rolling30,
    strategyHealth,
    fineTuning,
  }
}

// ──────── LIVE SNAPSHOT — Activity Today + Open Positions + Capital Status ────────

interface LiveSnapshot {
  activityToday: ActivityRow[]
  capitalDeployedToday: number
  capitalRecoveredToday: number
  openPositions: OpenPositionRow[]
  openPositionValue: number
  capitalStatus: DailyReport['capitalStatus']
}

async function buildLiveSnapshot(date: string): Promise<LiveSnapshot> {
  const empty: LiveSnapshot = {
    activityToday: [], capitalDeployedToday: 0, capitalRecoveredToday: 0,
    openPositions: [], openPositionValue: 0,
    capitalStatus: null,
  }
  try {
    const state = await getState()
    const firstAcc = Object.keys(state.kiteTokens)[0]
    if (!firstAcc) return empty
    const creds = await resolveAccountCreds(firstAcc)
    if (!creds.ok) return empty

    const [orders, holdings, positionsKite, marginsRes, s1Positions, s2Positions] = await Promise.all([
      getOrders(creds).catch(() => []),
      getHoldings(creds).catch(() => []),
      getPositions(creds).catch(() => ({ net: [], day: [] })),
      // Margins via Kite API for available cash
      (async () => {
        try {
          const { kiteRequest } = await import('./kite')
          const r = await kiteRequest<{ data?: { equity?: { available?: { live_balance?: number; cash?: number } } } }>('/user/margins', creds)
          return r.data?.data?.equity?.available
        } catch { return null }
      })(),
      listStrategy1Positions(),
      listStrategy2Positions(),
    ])

    // Activity Today — for today's date we prefer LIVE Kite /orders (catches
    // pending/rejected too). For PAST dates Kite's /orders has rotated out, so
    // we fall back to journaled `order` records — these are written on every
    // successful BUY/SELL across manual + auto paths, so they're a complete
    // ledger as long as the deploy has been running since the date in question.
    const isToday = date === istDateString()
    let activityToday: ActivityRow[]
    if (isToday) {
      activityToday = orders
        .filter(o => o.status === 'COMPLETE')
        .map(o => ({
          time: parseOrderTime(o.order_timestamp),
          account: firstAcc,
          symbol: o.tradingsymbol.toUpperCase(),
          side: (o.transaction_type === 'BUY' ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
          qty: o.filled_quantity || o.quantity,
          price: o.average_price,
          status: o.status,
          tag: o.tag,
        }))
    } else {
      const dayRecords = await readJournalDay(date)
      activityToday = dayRecords
        .filter(r => r.type === 'order')
        .map(r => {
          const o = r as Extract<typeof r, { type: 'order' }>
          // Render the ISO ts as IST HH:MM:SS
          const t = new Date(o.ts).toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' })
          return {
            time: t,
            account: o.account,
            symbol: o.symbol,
            side: o.side,
            qty: o.qty,
            price: o.price,
            status: 'COMPLETE',
            tag: o.tag,
          }
        })
    }
    activityToday.sort((a, b) => a.time.localeCompare(b.time))

    const capitalDeployedToday = activityToday.filter(a => a.side === 'BUY').reduce((s, a) => s + a.qty * a.price, 0)
    const capitalRecoveredToday = activityToday.filter(a => a.side === 'SELL').reduce((s, a) => s + a.qty * a.price, 0)

    // Open Positions — merge Kite holdings + Kite intraday positions, annotate
    // with strategy source from s1Positions / s2Positions / order tags.
    const s1Set = new Set(s1Positions.map(p => p.symbol.toUpperCase()))
    const s2Set = new Set(s2Positions.map(p => p.symbol.toUpperCase()))
    const tagsByToday = new Map<string, Set<string>>()
    for (const o of activityToday) {
      const set = tagsByToday.get(o.symbol) || new Set<string>()
      if (o.tag) set.add(o.tag)
      tagsByToday.set(o.symbol, set)
    }
    const tagsBySymbol = (symbol: string): Set<string> => tagsByToday.get(symbol) || new Set()

    const classifySource = (symbol: string): OpenPositionRow['strategySource'] => {
      const inS1 = s1Set.has(symbol)
      const inS2 = s2Set.has(symbol)
      if (inS1 && inS2) return 'mixed'
      if (inS1) return 's1'
      if (inS2) return 's2'
      // Look at today's tags
      const tags = tagsBySymbol(symbol)
      if (Array.from(tags).some(t => t.startsWith('dt-s1'))) return 's1'
      if (Array.from(tags).some(t => t.startsWith('dt-s2'))) return 's2'
      return 'pre'   // started the day already held (no DineshTrade tag)
    }

    const allOpenSymbols = new Map<string, { qty: number; avgPrice: number; ltp: number }>()
    for (const h of holdings) {
      const sym = h.tradingsymbol.toUpperCase()
      // Sum settled + T+1-in-settlement qty so same-day buys appear in the report.
      const heldQty = (h.quantity || 0) + ((h as any).t1_quantity || 0)
      if (heldQty > 0) allOpenSymbols.set(sym, { qty: heldQty, avgPrice: h.average_price, ltp: h.last_price })
    }
    for (const p of [...positionsKite.net, ...positionsKite.day]) {
      const sym = p.tradingsymbol.toUpperCase()
      if (p.quantity > 0 && !allOpenSymbols.has(sym)) {
        allOpenSymbols.set(sym, { qty: p.quantity, avgPrice: p.average_price, ltp: p.last_price })
      }
    }

    const openPositions: OpenPositionRow[] = []
    for (const [symbol, info] of Array.from(allOpenSymbols.entries())) {
      const source = classifySource(symbol)
      const pnl = info.qty * (info.ltp - info.avgPrice)
      const pnlPct = info.avgPrice > 0 ? ((info.ltp - info.avgPrice) / info.avgPrice) * 100 : 0
      // Pyramid status: count entries in buyHistory if available
      const buyHistKey = `${firstAcc.toUpperCase()}:${symbol}`
      const buyHist = state.buyHistory[buyHistKey] || []
      const pyramidStatus = buyHist.length > 0 ? `${buyHist.length}/${getCapital().maxBuysPerSymbol} BUYs` : undefined
      // S2 handoff countdown
      let s2HandoffIn: number | undefined
      if (source === 's2') {
        const s2 = s2Positions.find(p => p.symbol.toUpperCase() === symbol)
        if (s2) {
          const ageDays = (Date.now() - new Date(s2.firstBuyAt).getTime()) / (1000 * 60 * 60 * 24)
          const handoffAt = 15
          s2HandoffIn = Math.max(0, handoffAt - Math.floor(ageDays))
        }
      }
      openPositions.push({
        account: firstAcc, symbol,
        qty: info.qty, avgPrice: info.avgPrice, ltp: info.ltp,
        pnl, pnlPct, strategySource: source,
        pyramidStatus, s2HandoffIn,
      })
    }
    openPositions.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
    const openPositionValue = openPositions.reduce((s, p) => s + p.qty * p.ltp, 0)

    // Capital status
    let capitalStatus: DailyReport['capitalStatus'] = null
    if (marginsRes) {
      const available = Number(marginsRes.live_balance ?? marginsRes.cash ?? 0)
      const cap = getCapital()
      const maxDeployable = (available * cap.maxDeployPct) / 100
      const deployedNow = openPositionValue
      const remainingDeployable = Math.max(0, maxDeployable - deployedNow)
      capitalStatus = {
        available,
        maxDeployable,
        deployedNow,
        remainingDeployable,
        pctDeployed: maxDeployable > 0 ? (deployedNow / maxDeployable) * 100 : 0,
      }
    }

    return { activityToday, capitalDeployedToday, capitalRecoveredToday, openPositions, openPositionValue, capitalStatus }
  } catch (err) {
    console.warn('[retrospective] live snapshot failed:', String(err).slice(0, 200))
    return empty
  }
}

function parseOrderTime(ts?: string): string {
  if (!ts) return '—'
  const m = ts.match(/(\d{2}):(\d{2}):/)
  return m ? `${m[1]}:${m[2]}` : ts.slice(0, 5)
}

// ──────── PER-STRATEGY HEALTH ────────

function buildStrategyHealth(rollingAll: any[], today: string): StrategyHealthRow[] {
  const scans = rollingAll.filter((r): r is StrategyScanRecord => r.type === 'strategy_scan')
  const strategies = getStrategies()
  const out: StrategyHealthRow[] = []
  const now = new Date(today + 'T23:59:59Z').getTime()

  for (const s of strategies) {
    const mine = scans.filter(r => r.strategyId === s.id)
    const signals = mine.filter(r => r.recs > 0)
    const executions = mine.filter(r => r.executed > 0)
    const lastSignalAt = signals.length > 0
      ? signals.map(r => r.ts).sort().slice(-1)[0]
      : null
    const daysSinceLastSignal = lastSignalAt
      ? Math.floor((now - new Date(lastSignalAt).getTime()) / (1000 * 60 * 60 * 24))
      : null
    let warning: string | undefined
    if (!s.active) {
      warning = 'Inactive — no scans firing. Toggle in Settings to enable.'
    } else if (mine.length === 0) {
      warning = 'No scans in last 30 days. Strategy might not be registered with cron — check pm2 logs.'
    } else if (daysSinceLastSignal !== null && daysSinceLastSignal >= 15) {
      warning = `No signals for ${daysSinceLastSignal} days. Review params — entry criteria may be too tight.`
    } else if (lastSignalAt === null) {
      warning = 'Scans running but no signals produced. Market conditions or entry criteria.'
    }
    out.push({
      id: s.id, name: s.name, active: s.active,
      scans30d: mine.length,
      signals30d: signals.length,
      executions30d: executions.reduce((sum, r) => sum + r.executed, 0),
      lastSignalAt, daysSinceLastSignal,
      warning,
    })
  }
  return out
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
