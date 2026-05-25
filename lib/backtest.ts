import { getState } from './state'
import { getWatchlist } from './watchlistStore'
import { computeEMA, consecutiveDownDays, deviationPct } from './ema'
import { getHistoricalCandles, resolveAccountCreds, type HistoricalCandle, type KiteCreds } from './kite'
import { getInstrumentTokens } from './instruments'
import { getActiveStrategies, getCapital, getStrategyById, type Strategy } from './strategyConfig'

export interface BacktestOptions {
  days?: number
  initialCapital?: number
  strategyId?: string
  runAllActive?: boolean
  strategySnapshot?: Strategy | null
  strategySnapshots?: Strategy[] | null
}

export interface BacktestTrade {
  strategyId?: string
  strategyName?: string
  symbol: string
  signalDate: string
  entryDate: string
  entryPrice: number
  qty: number
  remainingQty: number
  buyNumber: number
  entryValue: number
  emaAtSignal: number
  deviationPct: number
  downDays: number
  confidence: 'normal' | 'high'
  target1: number
  target2: number
  exitDate?: string
  exitPrice?: number
  exitValue?: number
  charges?: number
  incurredCharges?: number
  chargeModel?: 'intraday' | 'delivery'
  realizedPnl: number
  netRealizedPnl?: number
  realizedPct: number
  holdDays: number
  status: 'closed' | 'open'
  markPrice: number
  markValue: number
  unrealizedPnl: number
  netUnrealizedPnl?: number
  netTotalPnl?: number
  setup?: string
  t1Date?: string
  t2Date?: string
}

export interface BacktestEquityPoint {
  date: string
  cash: number
  marketValue: number
  equity: number
  drawdownPct: number
  openTrades: number
}

export interface BacktestGateCount {
  gate: string
  label: string
  count: number
}

export interface BacktestSummary {
  strategyId: string
  strategyName: string
  days: number
  tradingDays: number
  dipDays: number
  momentumDays: number
  startingCapital: number
  endingCapital: number
  totalCharges?: number
  incurredCharges?: number
  realizedPnl: number
  netRealizedPnl?: number
  unrealizedPnl: number
  netUnrealizedPnl?: number
  totalPnl: number
  netTotalPnl?: number
  totalReturnPct: number
  netTotalReturnPct?: number
  netEndingCapital?: number
  maxDrawdownPct: number
  tradesClosed: number
  tradesOpen: number
  wins: number
  losses: number
  winRate: number | null
  avgHoldDays: number | null
  skippedNoToken: number
  skippedNoHistorical: number
  skippedCapitalLimited: number
  skippedPositionLimited: number
  gateBreakdown: BacktestGateCount[]
}

export interface StrategyBacktestResult {
  summary: BacktestSummary
  trades: BacktestTrade[]
  equityCurve: BacktestEquityPoint[]
}

interface PendingEntry {
  date: string
  strategyId: string
  strategyName: string
  symbol: string
  signalDate: string
  emaAtSignal: number
  deviationPct: number
  downDays: number
  confidence: 'normal' | 'high'
}

interface OpenTrade extends BacktestTrade {
  remainingQty: number
  remainingCost: number
  t1Done: boolean
  t2Done: boolean
  strategyPhase?: 'momentum' | 'accumulator'
  handoffDate?: string
}

interface SymbolSeries {
  symbol: string
  candles: HistoricalCandle[]
  emaSeries: number[]
  candleByDate: Map<string, HistoricalCandle>
  indexByDate: Map<string, number>
}

interface MomentumSeries extends SymbolSeries {
  intradayByDate: Map<string, HistoricalCandle[]>
  intradayByTimestamp: Map<string, HistoricalCandle>
  intradayMetaByTimestamp: Map<string, { date: string; indexInDay: number; cumulativeVolume: number }>
  dailyAggByDate: Map<string, { ema20: number; avgVolume10d: number; prevClose: number }>
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function ymdIST(daysOffset = 0): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  ist.setDate(ist.getDate() + daysOffset)
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

async function firstConnectedCreds(): Promise<KiteCreds | null> {
  const state = await getState()
  for (const account of Object.keys(state.kiteTokens)) {
    const resolved = await resolveAccountCreds(account)
    if (resolved.ok) return { apiKey: resolved.apiKey, accessToken: resolved.accessToken }
  }
  return null
}

function uniqueUniverseFromWatchlist(strategy: Strategy): Promise<string[]> {
  return getWatchlist().then(wl => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const key of strategy.watchlist || ['listA']) {
      for (const entry of wl.lists[key] || []) {
        const symbol = String(entry.nse || '').toUpperCase()
        if (!symbol || seen.has(symbol)) continue
        seen.add(symbol)
        out.push(symbol)
      }
    }
    return out
  })
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

type GateCounter = Record<string, { label: string; count: number }>

function bumpGate(counter: GateCounter, gate: string, label: string): void {
  if (!counter[gate]) counter[gate] = { label, count: 0 }
  counter[gate].count += 1
}

function toGateBreakdown(counter: GateCounter): BacktestGateCount[] {
  return Object.keys(counter)
    .map(gate => ({ gate, label: counter[gate].label, count: counter[gate].count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function dateOnly(s: string): string {
  return s.slice(0, 10)
}

function timeOnly(s: string): string {
  const match = s.match(/T(\d{2}:\d{2})/)
  if (match) return match[1]
  return s.slice(11, 16)
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10))
  return h * 60 + m
}

function dayDiff(fromYmd: string, toYmd: string): number {
  const start = new Date(`${fromYmd}T00:00:00Z`)
  const end = new Date(`${toYmd}T00:00:00Z`)
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)))
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}

function estimateBacktestCharges(mode: 'intraday' | 'delivery', buyValue: number, sellValue: number, deliverySellDays: number): number {
  const turnover = buyValue + sellValue
  const brokerage = mode === 'intraday'
    ? Math.min(20, buyValue * 0.0003) + (sellValue > 0 ? Math.min(20, sellValue * 0.0003) : 0)
    : 0
  const stt = mode === 'intraday'
    ? sellValue * 0.00025
    : (buyValue * 0.001) + (sellValue * 0.001)
  const exchange = turnover * 0.0000297
  const sebi = turnover * 0.000001
  const gst = (brokerage + exchange + sebi) * 0.18
  const stamp = buyValue * (mode === 'intraday' ? 0.00003 : 0.00015)
  const dp = mode === 'delivery' && sellValue > 0 ? deliverySellDays * 15.93 : 0
  return round2(brokerage + stt + exchange + sebi + gst + stamp + dp)
}

export function applyBacktestCharges(trades: BacktestTrade[], effectiveExitDate: string): {
  totalCharges: number
  incurredCharges: number
  netRealizedPnl: number
  netUnrealizedPnl: number
  netTotalPnl: number
} {
  let totalCharges = 0
  let incurredCharges = 0
  let netRealizedPnl = 0
  let netTotalPnl = 0

  for (const trade of trades) {
    const realizedSellValue = trade.exitValue || 0
    const projectedSellValue = realizedSellValue + (trade.remainingQty > 0 ? trade.markValue : 0)
    const closeDate = trade.status === 'closed' ? (trade.exitDate || effectiveExitDate) : effectiveExitDate
    const chargeModel: 'intraday' | 'delivery' = dateOnly(trade.entryDate) === dateOnly(closeDate) ? 'intraday' : 'delivery'

    const realizedSellDays = new Set<string>()
    if (trade.t1Date) realizedSellDays.add(dateOnly(trade.t1Date))
    if (trade.t2Date) realizedSellDays.add(dateOnly(trade.t2Date))
    if (trade.exitDate) realizedSellDays.add(dateOnly(trade.exitDate))

    const projectedSellDays = new Set(realizedSellDays)
    if (trade.remainingQty > 0) projectedSellDays.add(dateOnly(effectiveExitDate))

    const realizedTradeCharges = realizedSellValue > 0
      ? estimateBacktestCharges(chargeModel, trade.entryValue, realizedSellValue, realizedSellDays.size)
      : 0
    const estimatedTradeCharges = estimateBacktestCharges(chargeModel, trade.entryValue, projectedSellValue, projectedSellDays.size)
    const tradeNetRealized = realizedSellValue > 0 ? round2(trade.realizedPnl - realizedTradeCharges) : 0
    const tradeNetTotal = round2(trade.realizedPnl + trade.unrealizedPnl - estimatedTradeCharges)

    trade.chargeModel = chargeModel
    trade.incurredCharges = realizedTradeCharges
    trade.charges = estimatedTradeCharges
    trade.netRealizedPnl = tradeNetRealized
    trade.netTotalPnl = tradeNetTotal
    trade.netUnrealizedPnl = round2(tradeNetTotal - tradeNetRealized)

    totalCharges += estimatedTradeCharges
    incurredCharges += realizedTradeCharges
    netRealizedPnl += tradeNetRealized
    netTotalPnl += tradeNetTotal
  }

  return {
    totalCharges: round2(totalCharges),
    incurredCharges: round2(incurredCharges),
    netRealizedPnl: round2(netRealizedPnl),
    netUnrealizedPnl: round2(netTotalPnl - netRealizedPnl),
    netTotalPnl: round2(netTotalPnl),
  }
}

function groupIntradayCandles(candles: HistoricalCandle[]): {
  byDate: Map<string, HistoricalCandle[]>
  byTimestamp: Map<string, HistoricalCandle>
  metaByTimestamp: Map<string, { date: string; indexInDay: number; cumulativeVolume: number }>
} {
  const byDate = new Map<string, HistoricalCandle[]>()
  const byTimestamp = new Map<string, HistoricalCandle>()
  const metaByTimestamp = new Map<string, { date: string; indexInDay: number; cumulativeVolume: number }>()
  for (const candle of candles) {
    const date = dateOnly(candle.date)
    const arr = byDate.get(date) || []
    arr.push(candle)
    byDate.set(date, arr)
    byTimestamp.set(candle.date, candle)
  }
  Array.from(byDate.entries()).forEach(([date, arr]: [string, HistoricalCandle[]]) => {
    arr.sort((a: HistoricalCandle, b: HistoricalCandle) => a.date.localeCompare(b.date))
    let cumulativeVolume = 0
    arr.forEach((candle: HistoricalCandle, indexInDay: number) => {
      cumulativeVolume += candle.volume || 0
      metaByTimestamp.set(candle.date, { date, indexInDay, cumulativeVolume })
    })
  })
  return { byDate, byTimestamp, metaByTimestamp }
}

function uniqueSortedTimes(series: MomentumSeries[], date: string): string[] {
  return Array.from(new Set(series.flatMap(item => (item.intradayByDate.get(date) || []).map(c => c.date)))).sort()
}

export async function runStrategyBacktest(options: BacktestOptions = {}): Promise<StrategyBacktestResult> {
  if (options.runAllActive) return runAllActiveBacktest(options)
  const strategyId = options.strategyId || 'accumulator'
  const strategy = resolveBacktestStrategy(options, strategyId)
  if (!strategy) throw new Error(`Unknown strategy: ${strategyId}`)
  if (strategy.type === 'momentum') return runMomentumBacktest(options)
  return runStrategy1Backtest(options)
}

function resolveBacktestStrategy(options: BacktestOptions, strategyId: string): Strategy | null {
  const snapshot = options.strategySnapshot
  if (snapshot && snapshot.id === strategyId) return snapshot
  return getStrategyById(strategyId)
}

async function runAllActiveBacktest(options: BacktestOptions = {}): Promise<StrategyBacktestResult> {
  const activeStrategies = Array.isArray(options.strategySnapshots) && options.strategySnapshots.length > 0
    ? options.strategySnapshots.filter(strategy => strategy.active)
    : getActiveStrategies()
  if (activeStrategies.length === 0) throw new Error('No active strategies configured')
  const strategyById = new Map(activeStrategies.map(strategy => [strategy.id, strategy]))
  const resolveActiveStrategy = (strategyId: string): Strategy | null => strategyById.get(strategyId) || getStrategyById(strategyId)

  const creds = await firstConnectedCreds()
  if (!creds) throw new Error('No Kite account connected — historical candles require a connected Kite account')

  const days = clampInt(options.days, 60, 10, 180)
  const startingCapital = typeof options.initialCapital === 'number' && options.initialCapital > 0
    ? Number(options.initialCapital.toFixed(2))
    : 50000
  const capitalCfg = getCapital()
  const dipStrategies = activeStrategies.filter(strategy => strategy.type === 'dip')
  const momentumStrategies = activeStrategies.filter(strategy => strategy.type === 'momentum')
  const dipEmaPeriods = Array.from(new Set(dipStrategies.map(strategy => clampInt((strategy.params || {}).emaPeriod, 20, 2, 200))))
  const maxDipEmaPeriod = dipEmaPeriods.reduce((max, period) => Math.max(max, period), 20)
  const maxVolumeAvgDays = momentumStrategies.reduce((max, strategy) => Math.max(max, clampInt((strategy.params || {}).volumeAvgDays, 10, 1, 60)), 10)

  const strategySymbolsEntries = await Promise.all(activeStrategies.map(async strategy => [strategy.id, await uniqueUniverseFromWatchlist(strategy)] as const))
  const strategySymbols = new Map<string, string[]>(strategySymbolsEntries)
  const allSymbols = Array.from(new Set(strategySymbolsEntries.flatMap(([, symbols]) => symbols)))
  const momentumSymbols = new Set(momentumStrategies.flatMap(strategy => strategySymbols.get(strategy.id) || []))
  const tokens = await getInstrumentTokens(creds, allSymbols)

  let skippedNoToken = 0
  let skippedNoHistorical = 0
  let skippedCapitalLimited = 0
  let skippedPositionLimited = 0
  const gateCounts: GateCounter = {}
  const dipDaySet = new Set<string>()
  const momentumDaySet = new Set<string>()

  const calendarLookbackDays = Math.max(180, days * 3)
  const fromDaily = ymdIST(-calendarLookbackDays)
  const toDaily = ymdIST(-1)
  const toIntraday = `${toDaily} 15:30:00`

  const fetched = await mapWithLimit(allSymbols, 2, async (symbol): Promise<(MomentumSeries & { closes: number[]; emaByPeriod: Map<number, number[]>; latestIntradayByDate: Map<string, HistoricalCandle> }) | null> => {
    const token = tokens[symbol]
    if (!token) {
      skippedNoToken++
      bumpGate(gateCounts, 'noToken', 'Missing instrument token for symbol')
      return null
    }
    try {
      const dailyCandles = await getHistoricalCandles(creds, token, fromDaily, toDaily, 'day')
      const minDailyRequired = Math.max(maxDipEmaPeriod + days + 2, 25, maxVolumeAvgDays + 2)
      if (dailyCandles.length < minDailyRequired) {
        skippedNoHistorical++
        bumpGate(gateCounts, 'noHistorical', 'Insufficient historical candle coverage')
        return null
      }

      let intradayCandles: HistoricalCandle[] = []
      if (momentumSymbols.has(symbol)) {
        const intradayStartIdx = Math.max(0, dailyCandles.length - days - 5)
        const fromIntraday = `${dateOnly(dailyCandles[intradayStartIdx].date)} 09:15:00`
        intradayCandles = await getHistoricalCandles(creds, token, fromIntraday, toIntraday, '5minute')
        if (intradayCandles.length === 0) {
          skippedNoHistorical++
          bumpGate(gateCounts, 'noHistorical', 'Insufficient historical candle coverage')
          return null
        }
      }

      const closes = dailyCandles.map(candle => candle.close)
      const emaByPeriod = new Map<number, number[]>()
      Array.from(new Set([...dipEmaPeriods, 20])).forEach(period => {
        emaByPeriod.set(period, computeEMA(closes, period))
      })
      const candleByDate = new Map(dailyCandles.map(candle => [dateOnly(candle.date), candle]))
      const indexByDate = new Map(dailyCandles.map((candle, idx) => [dateOnly(candle.date), idx]))
      const { byDate, byTimestamp, metaByTimestamp } = groupIntradayCandles(intradayCandles)
      const latestIntradayByDate = new Map<string, HistoricalCandle>()
      Array.from(byDate.entries()).forEach(([date, candles]) => {
        const latest = candles[candles.length - 1]
        if (latest) latestIntradayByDate.set(date, latest)
      })
      return {
        symbol,
        candles: dailyCandles,
        closes,
        emaSeries: emaByPeriod.get(20) || computeEMA(closes, 20),
        emaByPeriod,
        candleByDate,
        indexByDate,
        intradayByDate: byDate,
        intradayByTimestamp: byTimestamp,
        intradayMetaByTimestamp: metaByTimestamp,
        latestIntradayByDate,
        dailyAggByDate: new Map(),
      }
    } catch (err) {
      console.warn(`[backtest all-active] historical fetch failed ${symbol}:`, String(err).slice(0, 120))
      skippedNoHistorical++
      bumpGate(gateCounts, 'noHistorical', 'Insufficient historical candle coverage')
      return null
    }
  })
  const seriesList = fetched.filter((item): item is MomentumSeries & { closes: number[]; emaByPeriod: Map<number, number[]>; latestIntradayByDate: Map<string, HistoricalCandle> } => !!item)
  if (seriesList.length === 0) throw new Error('No symbols had sufficient historical data for the shared backtest window')
  const seriesBySymbol = new Map(seriesList.map(item => [item.symbol, item]))

  const allDates = Array.from(new Set(seriesList.flatMap(item => item.candles.map(candle => dateOnly(candle.date))))).sort()
  const backtestDates = allDates.slice(-days)
  const backtestDateSet = new Set(backtestDates)
  const dateIndex = new Map(allDates.map((date, idx) => [date, idx]))

  let cash = startingCapital
  let peakEquity = startingCapital
  const pendingByDate = new Map<string, PendingEntry[]>()
  const openTrades: OpenTrade[] = []
  const allTrades: OpenTrade[] = []
  const equityCurve: BacktestEquityPoint[] = []

  function pushPending(entry: PendingEntry) {
    const arr = pendingByDate.get(entry.date) || []
    arr.push(entry)
    pendingByDate.set(entry.date, arr)
  }

  for (const date of backtestDates) {
    const enteredToday = new Set<string>()
    const todaysPending = (pendingByDate.get(date) || []).sort((a, b) => a.deviationPct - b.deviationPct || a.strategyName.localeCompare(b.strategyName) || a.symbol.localeCompare(b.symbol))
    pendingByDate.delete(date)

    for (const pending of todaysPending) {
      const symbolSeries = seriesBySymbol.get(pending.symbol)
      const candle = symbolSeries?.candleByDate.get(date)
      if (!symbolSeries || !candle) continue

      const symbolOpenCount = openTrades.filter(trade => trade.symbol === pending.symbol).length
      if (openTrades.length >= capitalCfg.maxPositions) {
        skippedPositionLimited++
        bumpGate(gateCounts, 'maxPositions', 'Blocked by max open positions')
        continue
      }
      if (symbolOpenCount >= capitalCfg.maxBuysPerSymbol) {
        skippedPositionLimited++
        bumpGate(gateCounts, 'maxBuysPerSymbol', 'Blocked by max buys per symbol')
        continue
      }

      const ownerStrategy = resolveActiveStrategy(pending.strategyId)
      if (!ownerStrategy) continue
      const budget = Math.min(capitalCfg.perTrade, cash)
      const qty = Math.floor(budget / candle.open)
      if (qty < 1) {
        skippedCapitalLimited++
        bumpGate(gateCounts, 'capitalTooLow', 'Insufficient capital for next entry')
        continue
      }

      const entryValue = Number((qty * candle.open).toFixed(2))
      cash = Number((cash - entryValue).toFixed(2))
      const t1Pct = ownerStrategy.exits?.t1Pct ?? 5
      const t2Pct = ownerStrategy.exits?.t2Pct ?? 8
      const trade: OpenTrade = {
        strategyId: ownerStrategy.id,
        strategyName: ownerStrategy.name,
        symbol: pending.symbol,
        signalDate: pending.signalDate,
        entryDate: date,
        entryPrice: candle.open,
        qty,
        buyNumber: symbolOpenCount + 1,
        entryValue,
        emaAtSignal: pending.emaAtSignal,
        deviationPct: pending.deviationPct,
        downDays: pending.downDays,
        confidence: pending.confidence,
        target1: Number((candle.open * (1 + t1Pct / 100)).toFixed(2)),
        target2: Number((candle.open * (1 + t2Pct / 100)).toFixed(2)),
        realizedPnl: 0,
        realizedPct: 0,
        holdDays: 0,
        status: 'open',
        markPrice: candle.close,
        markValue: Number((qty * candle.close).toFixed(2)),
        unrealizedPnl: Number((qty * (candle.close - candle.open)).toFixed(2)),
        setup: `${ownerStrategy.name} · ${Math.abs(pending.deviationPct).toFixed(2)}% below EMA · ${pending.downDays} down days · T1 ${t1Pct}% / T2 ${t2Pct}%`,
        remainingQty: qty,
        remainingCost: entryValue,
        t1Done: false,
        t2Done: false,
      }
      openTrades.push(trade)
      allTrades.push(trade)
    }

    for (const trade of openTrades) {
      if (trade.strategyPhase === 'accumulator') continue
      if (!trade.strategyId) continue
      const ownerStrategy = resolveActiveStrategy(trade.strategyId)
      if (!ownerStrategy || ownerStrategy.type !== 'momentum') continue
      const handoffDays = clampInt((ownerStrategy.params || {}).deliveryHandoffDays, 15, 0, 365)
      if (handoffDays <= 0) continue
      const ageDays = dayDiff(dateOnly(trade.entryDate), date)
      if (ageDays < handoffDays) continue
      const accumulator = resolveActiveStrategy('accumulator')
      const fallbackT1Pct = accumulator?.exits?.t1Pct ?? 5
      const fallbackT2Pct = accumulator?.exits?.t2Pct ?? 8
      trade.strategyPhase = 'accumulator'
      trade.handoffDate = date
      trade.target1 = Number((trade.entryPrice * (1 + fallbackT1Pct / 100)).toFixed(2))
      trade.target2 = Number((trade.entryPrice * (1 + fallbackT2Pct / 100)).toFixed(2))
      trade.setup = `${trade.setup || ownerStrategy.name} · handed off to accumulator on ${date}`
    }

    const todaysTimes = Array.from(new Set(Array.from(momentumSymbols).flatMap(symbol => (seriesBySymbol.get(symbol)?.intradayByDate.get(date) || []).map(candle => candle.date)))).sort()
    for (const ts of todaysTimes) {
      for (const trade of [...openTrades]) {
        if (trade.strategyPhase === 'accumulator') continue
        if (!trade.strategyId) continue
        const ownerStrategy = resolveActiveStrategy(trade.strategyId)
        if (!ownerStrategy || ownerStrategy.type !== 'momentum') continue
        const symbolSeries = seriesBySymbol.get(trade.symbol)
        const candle = symbolSeries?.intradayByTimestamp.get(ts)
        if (!symbolSeries || !candle || trade.remainingQty < 1) continue

        const exitPrice = candle.close
        if (!trade.t1Done && exitPrice >= trade.target2) {
          const sellQty = trade.remainingQty
          const exitValue = Number((sellQty * trade.target2).toFixed(2))
          const costBasis = trade.remainingCost
          trade.remainingQty = 0
          trade.remainingCost = 0
          trade.realizedPnl = Number((trade.realizedPnl + (exitValue - costBasis)).toFixed(2))
          cash = Number((cash + exitValue).toFixed(2))
          trade.t2Done = true
          trade.t2Date = ts
          trade.exitDate = ts
          trade.exitValue = exitValue
          trade.exitPrice = Number((exitValue / trade.qty).toFixed(2))
        } else if (!trade.t1Done && exitPrice >= trade.target1) {
          const sellQty = Math.max(1, Math.floor(trade.remainingQty / 2))
          const exitValue = Number((sellQty * trade.target1).toFixed(2))
          const costBasis = Number((trade.entryPrice * sellQty).toFixed(2))
          trade.remainingQty -= sellQty
          trade.remainingCost = Number((trade.remainingCost - costBasis).toFixed(2))
          trade.realizedPnl = Number((trade.realizedPnl + (exitValue - costBasis)).toFixed(2))
          trade.exitValue = Number(((trade.exitValue || 0) + exitValue).toFixed(2))
          cash = Number((cash + exitValue).toFixed(2))
          trade.t1Done = true
          trade.t1Date = ts
        } else if (trade.t1Done && exitPrice >= trade.target2) {
          const sellQty = trade.remainingQty
          const exitValue = Number((sellQty * trade.target2).toFixed(2))
          const costBasis = trade.remainingCost
          trade.remainingQty = 0
          trade.remainingCost = 0
          trade.realizedPnl = Number((trade.realizedPnl + (exitValue - costBasis)).toFixed(2))
          cash = Number((cash + exitValue).toFixed(2))
          trade.t2Done = true
          trade.t2Date = ts
          trade.exitDate = ts
          trade.exitValue = Number(((trade.exitValue || 0) + exitValue).toFixed(2))
          trade.exitPrice = Number((trade.exitValue / trade.qty).toFixed(2))
        }

        if (trade.remainingQty === 0) {
          trade.status = 'closed'
          trade.markPrice = trade.exitPrice || trade.target2
          trade.markValue = trade.exitValue || Number((trade.qty * trade.markPrice).toFixed(2))
          trade.unrealizedPnl = 0
          trade.realizedPct = trade.entryValue > 0 ? Number(((trade.realizedPnl / trade.entryValue) * 100).toFixed(2)) : 0
          trade.holdDays = Math.max(0, (dateIndex.get(date) || 0) - (dateIndex.get(dateOnly(trade.entryDate)) || 0))
          enteredToday.add(trade.symbol)
        } else {
          trade.markPrice = candle.close
          trade.markValue = Number((trade.remainingQty * candle.close).toFixed(2))
          trade.unrealizedPnl = Number((trade.markValue - trade.remainingCost).toFixed(2))
        }
      }

      for (let i = openTrades.length - 1; i >= 0; i--) {
        if (openTrades[i].status === 'closed') openTrades.splice(i, 1)
      }

      for (const strategy of momentumStrategies) {
        const params = (strategy.params || {}) as Record<string, unknown>
        const minDayGainPct = typeof params.minDayGainPct === 'number' ? params.minDayGainPct : 0.5
        const maxDayGainPct = typeof params.maxDayGainPct === 'number' ? params.maxDayGainPct : 1.5
        const consecutiveCandles = clampInt(params.consecutiveCandles, 3, 1, 10)
        const emaProximityPct = typeof params.emaProximityPct === 'number' ? params.emaProximityPct : 3
        const volumeAvgDays = clampInt(params.volumeAvgDays, 10, 1, 60)
        const scanStartMin = hhmmToMinutes(typeof params.scanStartHHMM === 'string' ? params.scanStartHHMM : '09:30')
        const scanEndMin = hhmmToMinutes(typeof params.scanEndHHMM === 'string' ? params.scanEndHHMM : '14:30')
        const sessionStartMin = hhmmToMinutes('09:15')
        const sessionMinutes = 375

        for (const symbol of strategySymbols.get(strategy.id) || []) {
          if (enteredToday.has(symbol)) {
            bumpGate(gateCounts, 'enteredToday', 'Already entered this symbol today')
            continue
          }
          if (openTrades.some(trade => trade.symbol === symbol)) {
            bumpGate(gateCounts, 'alreadyOpen', 'Existing open position in symbol')
            continue
          }

          const item = seriesBySymbol.get(symbol)
          const candle = item?.intradayByTimestamp.get(ts)
          const meta = item?.intradayMetaByTimestamp.get(ts)
          const dailyIdx = item?.indexByDate.get(date)
          if (!item || !candle || !meta || dailyIdx === undefined || dailyIdx <= 0) continue
          if (!backtestDateSet.has(date)) continue

          const currentMin = hhmmToMinutes(timeOnly(ts))
          if (currentMin < scanStartMin || currentMin > scanEndMin) {
            bumpGate(gateCounts, 'scanWindow', 'Outside configured scan window')
            continue
          }
          if (openTrades.length >= capitalCfg.maxPositions) {
            skippedPositionLimited++
            bumpGate(gateCounts, 'maxPositions', 'Blocked by max open positions')
            continue
          }

          const dayBars = item.intradayByDate.get(date) || []
          if (meta.indexInDay < consecutiveCandles - 1) {
            bumpGate(gateCounts, 'needMoreCandles', 'Not enough candles yet for pattern')
            continue
          }
          const prevClose = item.candles[dailyIdx - 1]?.close
          const ema20 = item.emaByPeriod.get(20)?.[dailyIdx - 1]
          if (!prevClose || !ema20 || dailyIdx < volumeAvgDays) continue

          const dayGainPct = ((candle.close - prevClose) / prevClose) * 100
          if (dayGainPct < minDayGainPct) {
            bumpGate(gateCounts, 'minDayGainPct', 'Below minimum day-gain threshold')
            continue
          }
          if (dayGainPct > maxDayGainPct) {
            bumpGate(gateCounts, 'maxDayGainPct', 'Above maximum day-gain threshold')
            continue
          }
          const emaDev = deviationPct(candle.close, ema20)
          if (Math.abs(emaDev) > emaProximityPct) {
            bumpGate(gateCounts, 'emaProximity', 'Too far from EMA proximity band')
            continue
          }

          const elapsedMin = Math.max(1, currentMin - sessionStartMin)
          const avgVolume = item.candles.slice(dailyIdx - volumeAvgDays, dailyIdx).reduce((sum, candleRow) => sum + candleRow.volume, 0) / volumeAvgDays
          const proratedAvgVol = avgVolume * (elapsedMin / sessionMinutes)
          if (meta.cumulativeVolume < proratedAvgVol) {
            bumpGate(gateCounts, 'volumeAvg', 'Volume below prorated average')
            continue
          }

          const lastN = dayBars.slice(meta.indexInDay - consecutiveCandles + 1, meta.indexInDay + 1)
          let rising = true
          for (let i = 1; i < lastN.length; i++) {
            if (lastN[i].close <= lastN[i - 1].close) { rising = false; break }
          }
          if (!rising) {
            bumpGate(gateCounts, 'risingCandles', 'Consecutive rising-candle pattern not met')
            continue
          }

          const budget = Math.min(capitalCfg.perTrade, cash)
          const qty = Math.floor(budget / candle.close)
          if (qty < 1) {
            skippedCapitalLimited++
            bumpGate(gateCounts, 'capitalTooLow', 'Insufficient capital for next entry')
            continue
          }

          momentumDaySet.add(date)

          const entryValue = Number((qty * candle.close).toFixed(2))
          cash = Number((cash - entryValue).toFixed(2))
          const trade: OpenTrade = {
            strategyId: strategy.id,
            strategyName: strategy.name,
            symbol,
            signalDate: ts,
            entryDate: ts,
            entryPrice: candle.close,
            qty,
            buyNumber: 1,
            entryValue,
            emaAtSignal: Number(ema20.toFixed(2)),
            deviationPct: Number(emaDev.toFixed(2)),
            downDays: consecutiveCandles,
            confidence: 'normal',
            target1: Number((candle.close * ((strategy.exits?.t1Pct ?? 1.5) / 100 + 1)).toFixed(2)),
            target2: Number((candle.close * ((strategy.exits?.t2Pct ?? 2) / 100 + 1)).toFixed(2)),
            realizedPnl: 0,
            realizedPct: 0,
            holdDays: 0,
            status: 'open',
            markPrice: candle.close,
            markValue: entryValue,
            unrealizedPnl: 0,
            setup: `${strategy.name} · +${dayGainPct.toFixed(2)}% day gain · ${consecutiveCandles} rising candles · vol ${Math.round(meta.cumulativeVolume).toLocaleString('en-IN')}`,
            remainingQty: qty,
            remainingCost: entryValue,
            t1Done: false,
            t2Done: false,
            strategyPhase: 'momentum',
          }
          openTrades.push(trade)
          allTrades.push(trade)
          enteredToday.add(symbol)
        }
      }
    }

    for (const trade of [...openTrades]) {
      if (trade.strategyPhase === 'momentum') continue
      const candle = seriesBySymbol.get(trade.symbol)?.candleByDate.get(date)
      if (!candle || trade.remainingQty < 1) continue

      if (!trade.t1Done && candle.high >= trade.target1) {
        const sellQty = Math.ceil(trade.qty / 2)
        const exitValue = Number((sellQty * trade.target1).toFixed(2))
        const costBasis = Number((trade.entryPrice * sellQty).toFixed(2))
        trade.remainingQty -= sellQty
        trade.remainingCost = Number((trade.remainingCost - costBasis).toFixed(2))
        trade.realizedPnl = Number((trade.realizedPnl + (exitValue - costBasis)).toFixed(2))
        trade.exitValue = Number(((trade.exitValue || 0) + exitValue).toFixed(2))
        cash = Number((cash + exitValue).toFixed(2))
        trade.t1Done = true
        trade.t1Date = date
      }

      if (trade.remainingQty > 0 && candle.high >= trade.target2) {
        const sellQty = trade.remainingQty
        const exitValue = Number((sellQty * trade.target2).toFixed(2))
        const costBasis = trade.remainingCost
        trade.remainingQty = 0
        trade.remainingCost = 0
        trade.realizedPnl = Number((trade.realizedPnl + (exitValue - costBasis)).toFixed(2))
        cash = Number((cash + exitValue).toFixed(2))
        trade.t2Done = true
        trade.t2Date = date
        trade.exitDate = date
        trade.exitValue = Number(((trade.exitValue || 0) + exitValue).toFixed(2))
        trade.exitPrice = Number((trade.exitValue / trade.qty).toFixed(2))
      }

      if (trade.remainingQty === 0) {
        trade.status = 'closed'
        trade.markPrice = trade.exitPrice || trade.target2
        trade.markValue = trade.exitValue || Number((trade.qty * trade.markPrice).toFixed(2))
        trade.unrealizedPnl = 0
        trade.exitValue = trade.exitValue || trade.markValue
        trade.exitPrice = trade.exitPrice || Number((trade.exitValue / trade.qty).toFixed(2))
        trade.realizedPct = trade.entryValue > 0 ? Number(((trade.realizedPnl / trade.entryValue) * 100).toFixed(2)) : 0
        trade.holdDays = Math.max(0, (dateIndex.get(date) || 0) - (dateIndex.get(trade.entryDate) || 0))
      } else {
        trade.markPrice = candle.close
        trade.markValue = Number((trade.remainingQty * candle.close).toFixed(2))
        trade.unrealizedPnl = Number((trade.markValue - trade.remainingCost).toFixed(2))
      }
    }

    for (let i = openTrades.length - 1; i >= 0; i--) {
      if (openTrades[i].status === 'closed') openTrades.splice(i, 1)
    }

    for (const strategy of dipStrategies) {
      const params = (strategy.params || {}) as Record<string, unknown>
      const emaPeriod = clampInt(params.emaPeriod, 20, 2, 200)
      const entryBelowPct = typeof params.entryBelowPct === 'number' ? params.entryBelowPct : 5
      const strongBuyBelowPct = typeof params.strongBuyBelowPct === 'number' ? params.strongBuyBelowPct : 8
      const minDownDays = clampInt(params.minDownDays, 3, 1, 20)
      const capitulationFloorPct = typeof params.capitulationFloorPct === 'number' ? params.capitulationFloorPct : 12

      for (const symbol of strategySymbols.get(strategy.id) || []) {
        const item = seriesBySymbol.get(symbol)
        const idx = item?.indexByDate.get(date)
        const emaSeries = item?.emaByPeriod.get(emaPeriod)
        if (!item || idx === undefined || idx <= 0 || idx >= item.candles.length - 1 || !emaSeries) continue
        if (!backtestDateSet.has(date)) continue

        const candle = item.candles[idx]
        const emaYesterday = emaSeries[idx - 1]
        if (!emaYesterday || Number.isNaN(emaYesterday)) continue

        const historicalCloses = item.candles.slice(0, idx).map(row => row.close)
        const downDays = consecutiveDownDays(historicalCloses)
        const dev = deviationPct(candle.close, emaYesterday)
        if (dev > -entryBelowPct) {
          bumpGate(gateCounts, 'entryBelowPct', 'Did not breach entry-below-EMA threshold')
          continue
        }
        if (dev < -capitulationFloorPct) {
          bumpGate(gateCounts, 'capitulationFloor', 'Rejected as too far below EMA')
          continue
        }
        if (downDays < minDownDays) {
          bumpGate(gateCounts, 'minDownDays', 'Not enough consecutive down days')
          continue
        }

        const openForSymbol = openTrades.filter(trade => trade.symbol === symbol).sort((a, b) => a.entryDate.localeCompare(b.entryDate))
        if (openForSymbol.length > 0) {
          const lastBuy = openForSymbol[openForSymbol.length - 1]
          const threshold = lastBuy.entryPrice * (1 - capitalCfg.minDropBetweenBuysPct / 100)
          if (candle.close > threshold) {
            bumpGate(gateCounts, 'minDropBetweenBuys', 'Pyramiding drop threshold not met')
            continue
          }
        }

        const nextDate = item.candles[idx + 1]?.date.slice(0, 10)
        if (!nextDate || !backtestDateSet.has(nextDate)) {
          bumpGate(gateCounts, 'nextSessionMissing', 'No next trading session in backtest window')
          continue
        }

        dipDaySet.add(date)

        pushPending({
          date: nextDate,
          strategyId: strategy.id,
          strategyName: strategy.name,
          symbol,
          signalDate: date,
          emaAtSignal: emaYesterday,
          deviationPct: dev,
          downDays,
          confidence: dev <= -strongBuyBelowPct ? 'high' : 'normal',
        })
      }
    }

    let marketValue = 0
    for (const trade of openTrades) {
      const item = seriesBySymbol.get(trade.symbol)
      const priceCandle = trade.strategyPhase === 'momentum'
        ? item?.latestIntradayByDate.get(date) || item?.candleByDate.get(date)
        : item?.candleByDate.get(date)
      if (!priceCandle) continue
      trade.markPrice = priceCandle.close
      trade.markValue = Number((trade.remainingQty * priceCandle.close).toFixed(2))
      trade.unrealizedPnl = Number((trade.markValue - trade.remainingCost).toFixed(2))
      marketValue += trade.markValue
    }
    marketValue = Number(marketValue.toFixed(2))
    const equity = Number((cash + marketValue).toFixed(2))
    peakEquity = Math.max(peakEquity, equity)
    const drawdownPct = peakEquity > 0 ? Number((((peakEquity - equity) / peakEquity) * 100).toFixed(2)) : 0
    equityCurve.push({ date, cash, marketValue, equity, drawdownPct, openTrades: openTrades.length })
  }

  const lastDate = backtestDates[backtestDates.length - 1]
  for (const trade of allTrades) {
    if (trade.status === 'closed') continue
    trade.holdDays = Math.max(0, (dateIndex.get(lastDate) || 0) - (dateIndex.get(dateOnly(trade.entryDate)) || 0))
    trade.markValue = Number((trade.remainingQty * trade.markPrice).toFixed(2))
    trade.unrealizedPnl = Number((trade.markValue - trade.remainingCost).toFixed(2))
    trade.realizedPct = trade.entryValue > 0
      ? Number(((((trade.realizedPnl + trade.unrealizedPnl) / trade.entryValue) * 100)).toFixed(2))
      : 0
  }

  const realizedPnl = Number(allTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0).toFixed(2))
  const unrealizedPnl = Number(allTrades.filter(trade => trade.status === 'open').reduce((sum, trade) => sum + trade.unrealizedPnl, 0).toFixed(2))
  const endingCapital = equityCurve[equityCurve.length - 1]?.equity ?? startingCapital
  const chargeSummary = applyBacktestCharges(allTrades, lastDate)
  const closedTrades = allTrades.filter(trade => trade.status === 'closed')
  const wins = closedTrades.filter(trade => (trade.netRealizedPnl ?? trade.realizedPnl) > 0).length
  const losses = closedTrades.filter(trade => (trade.netRealizedPnl ?? trade.realizedPnl) < 0).length
  const holdDays = closedTrades.map(trade => trade.holdDays)

  return {
    summary: {
      strategyId: 'all-active',
      strategyName: `All Active Strategies (${activeStrategies.length})`,
      days,
      tradingDays: backtestDates.length,
      dipDays: dipDaySet.size,
      momentumDays: momentumDaySet.size,
      startingCapital,
      endingCapital,
      totalCharges: chargeSummary.totalCharges,
      incurredCharges: chargeSummary.incurredCharges,
      realizedPnl,
      netRealizedPnl: chargeSummary.netRealizedPnl,
      unrealizedPnl,
      netUnrealizedPnl: chargeSummary.netUnrealizedPnl,
      totalPnl: Number((realizedPnl + unrealizedPnl).toFixed(2)),
      netTotalPnl: chargeSummary.netTotalPnl,
      totalReturnPct: startingCapital > 0 ? Number((((endingCapital - startingCapital) / startingCapital) * 100).toFixed(2)) : 0,
      netTotalReturnPct: startingCapital > 0 ? round2((chargeSummary.netTotalPnl / startingCapital) * 100) : 0,
      netEndingCapital: round2(startingCapital + chargeSummary.netTotalPnl),
      maxDrawdownPct: Number(equityCurve.reduce((max, point) => Math.max(max, point.drawdownPct), 0).toFixed(2)),
      tradesClosed: closedTrades.length,
      tradesOpen: allTrades.length - closedTrades.length,
      wins,
      losses,
      winRate: closedTrades.length > 0 ? Number(((wins / closedTrades.length) * 100).toFixed(2)) : null,
      avgHoldDays: avg(holdDays.map(Number)) !== null ? Number((avg(holdDays.map(Number)) || 0).toFixed(2)) : null,
      skippedNoToken,
      skippedNoHistorical,
      skippedCapitalLimited,
      skippedPositionLimited,
      gateBreakdown: toGateBreakdown(gateCounts),
    },
    trades: allTrades
      .map(trade => ({
        strategyId: trade.strategyId,
        strategyName: trade.strategyName,
        symbol: trade.symbol,
        signalDate: trade.signalDate,
        entryDate: trade.entryDate,
        entryPrice: trade.entryPrice,
        qty: trade.qty,
        remainingQty: trade.remainingQty,
        buyNumber: trade.buyNumber,
        entryValue: trade.entryValue,
        emaAtSignal: trade.emaAtSignal,
        deviationPct: Number(trade.deviationPct.toFixed(2)),
        downDays: trade.downDays,
        confidence: trade.confidence,
        target1: trade.target1,
        target2: trade.target2,
        exitDate: trade.exitDate,
        exitPrice: trade.exitPrice,
        exitValue: trade.exitValue,
        charges: trade.charges,
        incurredCharges: trade.incurredCharges,
        chargeModel: trade.chargeModel,
        realizedPnl: trade.realizedPnl,
        netRealizedPnl: trade.netRealizedPnl,
        realizedPct: trade.realizedPct,
        holdDays: trade.holdDays,
        status: trade.status,
        markPrice: trade.markPrice,
        markValue: trade.markValue,
        unrealizedPnl: trade.unrealizedPnl,
        netUnrealizedPnl: trade.netUnrealizedPnl,
        netTotalPnl: trade.netTotalPnl,
        setup: trade.setup,
        t1Date: trade.t1Date,
        t2Date: trade.t2Date,
      }))
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.strategyName || '').localeCompare(b.strategyName || '') || a.symbol.localeCompare(b.symbol)),
    equityCurve,
  }
}

export async function runStrategy1Backtest(options: BacktestOptions = {}): Promise<StrategyBacktestResult> {
  const strategyId = options.strategyId || 'accumulator'
  const strategy = resolveBacktestStrategy(options, strategyId)
  if (!strategy) throw new Error(`Unknown strategy: ${strategyId}`)
  if (strategy.type !== 'dip') throw new Error(`Backtest currently supports dip strategies only; got ${strategy.type}`)

  const creds = await firstConnectedCreds()
  if (!creds) throw new Error('No Kite account connected — historical candles require a connected Kite account')

  const days = clampInt(options.days, 60, 10, 180)
  const startingCapital = typeof options.initialCapital === 'number' && options.initialCapital > 0
    ? Number(options.initialCapital.toFixed(2))
    : 50000

  const params = (strategy.params || {}) as Record<string, unknown>
  const emaPeriod = clampInt(params.emaPeriod, 20, 2, 200)
  const entryBelowPct = typeof params.entryBelowPct === 'number' ? params.entryBelowPct : 5
  const strongBuyBelowPct = typeof params.strongBuyBelowPct === 'number' ? params.strongBuyBelowPct : 8
  const minDownDays = clampInt(params.minDownDays, 3, 1, 20)
  const capitulationFloorPct = typeof params.capitulationFloorPct === 'number' ? params.capitulationFloorPct : 12
  const t1Pct = strategy.exits?.t1Pct ?? 5
  const t2Pct = strategy.exits?.t2Pct ?? 8
  const capital = getCapital()

  const symbols = await uniqueUniverseFromWatchlist(strategy)
  const tokens = await getInstrumentTokens(creds, symbols)

  let skippedNoToken = 0
  let skippedNoHistorical = 0
  let skippedCapitalLimited = 0
  let skippedPositionLimited = 0
  const gateCounts: GateCounter = {}
  const dipDaySet = new Set<string>()

  const calendarLookbackDays = Math.max(180, days * 3)
  const from = ymdIST(-calendarLookbackDays)
  const to = ymdIST(-1)

  const fetched = await mapWithLimit(symbols, 3, async (symbol): Promise<SymbolSeries | null> => {
    const token = tokens[symbol]
    if (!token) { skippedNoToken++; return null }
    try {
      const candles = await getHistoricalCandles(creds, token, from, to, 'day')
      if (candles.length < emaPeriod + days + 2) {
        skippedNoHistorical++
        return null
      }
      const closes = candles.map(c => c.close)
      return {
        symbol,
        candles,
        emaSeries: computeEMA(closes, emaPeriod),
        candleByDate: new Map(candles.map(c => [c.date.slice(0, 10), c])),
        indexByDate: new Map(candles.map((c, idx) => [c.date.slice(0, 10), idx])),
      }
    } catch (err) {
      console.warn(`[backtest] historical fetch failed ${symbol}:`, String(err).slice(0, 120))
      skippedNoHistorical++
      return null
    }
  })
  const series = fetched.filter((item): item is SymbolSeries => !!item)
  if (series.length === 0) throw new Error('No symbols had sufficient historical data for the backtest window')

  const allDates = Array.from(new Set(series.flatMap(item => item.candles.map(c => c.date.slice(0, 10))))).sort()
  const backtestDates = allDates.slice(-days)
  const backtestDateSet = new Set(backtestDates)
  const dateIndex = new Map(allDates.map((date, idx) => [date, idx]))

  let cash = startingCapital
  let peakEquity = startingCapital
  const pendingByDate = new Map<string, PendingEntry[]>()
  const openTrades: OpenTrade[] = []
  const allTrades: OpenTrade[] = []
  const equityCurve: BacktestEquityPoint[] = []

  function pushPending(entry: PendingEntry) {
    const arr = pendingByDate.get(entry.date) || []
    arr.push(entry)
    pendingByDate.set(entry.date, arr)
  }

  for (const date of backtestDates) {
    const todaysPending = (pendingByDate.get(date) || []).sort((a, b) => a.deviationPct - b.deviationPct || a.symbol.localeCompare(b.symbol))
    pendingByDate.delete(date)

    for (const pending of todaysPending) {
      const symbolSeries = series.find(item => item.symbol === pending.symbol)
      const candle = symbolSeries?.candleByDate.get(date)
      if (!symbolSeries || !candle) continue

      const symbolOpenCount = openTrades.filter(trade => trade.symbol === pending.symbol).length
      if (openTrades.length >= capital.maxPositions) {
        skippedPositionLimited++
        bumpGate(gateCounts, 'maxPositions', 'Blocked by max open positions')
        continue
      }
      if (symbolOpenCount >= capital.maxBuysPerSymbol) {
        skippedPositionLimited++
        bumpGate(gateCounts, 'maxBuysPerSymbol', 'Blocked by max buys per symbol')
        continue
      }

      const budget = Math.min(capital.perTrade, cash)
      const qty = Math.floor(budget / candle.open)
      if (qty < 1) {
        skippedCapitalLimited++
        bumpGate(gateCounts, 'capitalTooLow', 'Insufficient capital for next entry')
        continue
      }

      const entryValue = Number((qty * candle.open).toFixed(2))
      cash = Number((cash - entryValue).toFixed(2))
      const trade: OpenTrade = {
        symbol: pending.symbol,
        signalDate: pending.signalDate,
        entryDate: date,
        entryPrice: candle.open,
        qty,
        buyNumber: symbolOpenCount + 1,
        entryValue,
        emaAtSignal: pending.emaAtSignal,
        deviationPct: pending.deviationPct,
        downDays: pending.downDays,
        confidence: pending.confidence,
        target1: Number((candle.open * (1 + t1Pct / 100)).toFixed(2)),
        target2: Number((candle.open * (1 + t2Pct / 100)).toFixed(2)),
        realizedPnl: 0,
        realizedPct: 0,
        holdDays: 0,
        status: 'open',
        markPrice: candle.close,
        markValue: Number((qty * candle.close).toFixed(2)),
        unrealizedPnl: Number((qty * (candle.close - candle.open)).toFixed(2)),
        setup: `${Math.abs(pending.deviationPct).toFixed(2)}% below EMA · ${pending.downDays} down days · T1 ${t1Pct}% / T2 ${t2Pct}%`,
        remainingQty: qty,
        remainingCost: entryValue,
        t1Done: false,
        t2Done: false,
      }
      openTrades.push(trade)
      allTrades.push(trade)
    }

    for (const trade of [...openTrades]) {
      const candle = series.find(item => item.symbol === trade.symbol)?.candleByDate.get(date)
      if (!candle || trade.remainingQty < 1) continue

      if (!trade.t1Done && candle.high >= trade.target1) {
        const sellQty = Math.ceil(trade.qty / 2)
        const exitValue = Number((sellQty * trade.target1).toFixed(2))
        const costBasis = Number((trade.entryPrice * sellQty).toFixed(2))
        trade.remainingQty -= sellQty
        trade.remainingCost = Number((trade.remainingCost - costBasis).toFixed(2))
        trade.realizedPnl = Number((trade.realizedPnl + (exitValue - costBasis)).toFixed(2))
        trade.exitValue = Number(((trade.exitValue || 0) + exitValue).toFixed(2))
        cash = Number((cash + exitValue).toFixed(2))
        trade.t1Done = true
        trade.t1Date = date
      }

      if (trade.remainingQty > 0 && candle.high >= trade.target2) {
        const sellQty = trade.remainingQty
        const exitValue = Number((sellQty * trade.target2).toFixed(2))
        const costBasis = trade.remainingCost
        trade.remainingQty = 0
        trade.remainingCost = 0
        trade.realizedPnl = Number((trade.realizedPnl + (exitValue - costBasis)).toFixed(2))
        cash = Number((cash + exitValue).toFixed(2))
        trade.t2Done = true
        trade.t2Date = date
        trade.exitDate = date
        trade.exitValue = Number(((trade.exitValue || 0) + exitValue).toFixed(2))
        trade.exitPrice = Number((trade.exitValue / trade.qty).toFixed(2))
      }

      if (trade.remainingQty === 0) {
        trade.status = 'closed'
        trade.markPrice = trade.exitPrice || trade.target2
        trade.markValue = trade.exitValue || Number((trade.qty * trade.markPrice).toFixed(2))
        trade.unrealizedPnl = 0
        trade.exitValue = trade.exitValue || trade.markValue
        trade.exitPrice = trade.exitPrice || Number((trade.exitValue / trade.qty).toFixed(2))
        trade.realizedPct = trade.entryValue > 0 ? Number(((trade.realizedPnl / trade.entryValue) * 100).toFixed(2)) : 0
        trade.holdDays = Math.max(0, (dateIndex.get(date) || 0) - (dateIndex.get(trade.entryDate) || 0))
      } else {
        trade.markPrice = candle.close
        trade.markValue = Number((trade.remainingQty * candle.close).toFixed(2))
        trade.unrealizedPnl = Number((trade.markValue - trade.remainingCost).toFixed(2))
      }
    }

    for (let i = openTrades.length - 1; i >= 0; i--) {
      if (openTrades[i].status === 'closed') openTrades.splice(i, 1)
    }

    for (const item of series) {
      const idx = item.indexByDate.get(date)
      if (idx === undefined || idx <= 0 || idx >= item.candles.length - 1) continue
      if (!backtestDateSet.has(date)) continue

      const candle = item.candles[idx]
      const emaYesterday = item.emaSeries[idx - 1]
      if (!emaYesterday || Number.isNaN(emaYesterday)) continue

      const historicalCloses = item.candles.slice(0, idx).map(row => row.close)
      const downDays = consecutiveDownDays(historicalCloses)
      const dev = deviationPct(candle.close, emaYesterday)
      if (dev > -entryBelowPct) {
        bumpGate(gateCounts, 'entryBelowPct', 'Did not breach entry-below-EMA threshold')
        continue
      }
      if (dev < -capitulationFloorPct) {
        bumpGate(gateCounts, 'capitulationFloor', 'Rejected as too far below EMA')
        continue
      }
      if (downDays < minDownDays) {
        bumpGate(gateCounts, 'minDownDays', 'Not enough consecutive down days')
        continue
      }

      const openForSymbol = allTrades
        .filter(trade => trade.symbol === item.symbol && trade.status === 'open')
        .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      if (openForSymbol.length > 0) {
        const lastBuy = openForSymbol[openForSymbol.length - 1]
        const threshold = lastBuy.entryPrice * (1 - capital.minDropBetweenBuysPct / 100)
        if (candle.close > threshold) {
          bumpGate(gateCounts, 'minDropBetweenBuys', 'Pyramiding drop threshold not met')
          continue
        }
      }

      const nextDate = item.candles[idx + 1]?.date.slice(0, 10)
      if (!nextDate || !backtestDateSet.has(nextDate)) {
        bumpGate(gateCounts, 'nextSessionMissing', 'No next trading session in backtest window')
        continue
      }

      dipDaySet.add(date)

      pushPending({
        date: nextDate,
        strategyId: strategy.id,
        strategyName: strategy.name,
        symbol: item.symbol,
        signalDate: date,
        emaAtSignal: emaYesterday,
        deviationPct: dev,
        downDays,
        confidence: dev <= -strongBuyBelowPct ? 'high' : 'normal',
      })
    }

    let marketValue = 0
    for (const trade of openTrades) {
      const candle = series.find(item => item.symbol === trade.symbol)?.candleByDate.get(date)
      if (!candle) continue
      trade.markPrice = candle.close
      trade.markValue = Number((trade.remainingQty * candle.close).toFixed(2))
      trade.unrealizedPnl = Number((trade.markValue - trade.remainingCost).toFixed(2))
      marketValue += trade.markValue
    }
    marketValue = Number(marketValue.toFixed(2))
    const equity = Number((cash + marketValue).toFixed(2))
    peakEquity = Math.max(peakEquity, equity)
    const drawdownPct = peakEquity > 0 ? Number((((peakEquity - equity) / peakEquity) * 100).toFixed(2)) : 0
    equityCurve.push({ date, cash, marketValue, equity, drawdownPct, openTrades: openTrades.length })
  }

  const lastDate = backtestDates[backtestDates.length - 1]
  for (const trade of allTrades) {
    if (trade.status === 'closed') continue
    trade.holdDays = Math.max(0, (dateIndex.get(lastDate) || 0) - (dateIndex.get(trade.entryDate) || 0))
    trade.markValue = Number((trade.remainingQty * trade.markPrice).toFixed(2))
    trade.unrealizedPnl = Number((trade.markValue - trade.remainingCost).toFixed(2))
    trade.realizedPct = trade.entryValue > 0
      ? Number(((((trade.realizedPnl + trade.unrealizedPnl) / trade.entryValue) * 100)).toFixed(2))
      : 0
  }

  const realizedPnl = Number(allTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0).toFixed(2))
  const unrealizedPnl = Number(allTrades.filter(trade => trade.status === 'open').reduce((sum, trade) => sum + trade.unrealizedPnl, 0).toFixed(2))
  const endingCapital = equityCurve[equityCurve.length - 1]?.equity ?? startingCapital
  const chargeSummary = applyBacktestCharges(allTrades, lastDate)
  const closedTrades = allTrades.filter(trade => trade.status === 'closed')
  const wins = closedTrades.filter(trade => (trade.netRealizedPnl ?? trade.realizedPnl) > 0).length
  const losses = closedTrades.filter(trade => (trade.netRealizedPnl ?? trade.realizedPnl) < 0).length
  const holdDays = closedTrades.map(trade => trade.holdDays)
  const maxDrawdownPct = equityCurve.reduce((max, point) => Math.max(max, point.drawdownPct), 0)

  return {
    summary: {
      strategyId: strategy.id,
      strategyName: strategy.name,
      days,
      tradingDays: backtestDates.length,
      dipDays: dipDaySet.size,
      momentumDays: 0,
      startingCapital,
      endingCapital,
      totalCharges: chargeSummary.totalCharges,
      incurredCharges: chargeSummary.incurredCharges,
      realizedPnl,
      netRealizedPnl: chargeSummary.netRealizedPnl,
      unrealizedPnl,
      netUnrealizedPnl: chargeSummary.netUnrealizedPnl,
      totalPnl: Number((realizedPnl + unrealizedPnl).toFixed(2)),
      netTotalPnl: chargeSummary.netTotalPnl,
      totalReturnPct: startingCapital > 0 ? Number((((endingCapital - startingCapital) / startingCapital) * 100).toFixed(2)) : 0,
      netTotalReturnPct: startingCapital > 0 ? round2((chargeSummary.netTotalPnl / startingCapital) * 100) : 0,
      netEndingCapital: round2(startingCapital + chargeSummary.netTotalPnl),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      tradesClosed: closedTrades.length,
      tradesOpen: allTrades.length - closedTrades.length,
      wins,
      losses,
      winRate: closedTrades.length > 0 ? Number(((wins / closedTrades.length) * 100).toFixed(2)) : null,
      avgHoldDays: avg(holdDays.map(Number)) !== null ? Number((avg(holdDays.map(Number)) || 0).toFixed(2)) : null,
      skippedNoToken,
      skippedNoHistorical,
      skippedCapitalLimited,
      skippedPositionLimited,
      gateBreakdown: toGateBreakdown(gateCounts),
    },
    trades: allTrades.map(trade => ({
      strategyId: strategy.id,
      strategyName: strategy.name,
      symbol: trade.symbol,
      signalDate: trade.signalDate,
      entryDate: trade.entryDate,
      entryPrice: trade.entryPrice,
      qty: trade.qty,
      remainingQty: trade.remainingQty,
      buyNumber: trade.buyNumber,
      entryValue: trade.entryValue,
      emaAtSignal: trade.emaAtSignal,
      deviationPct: Number(trade.deviationPct.toFixed(2)),
      downDays: trade.downDays,
      confidence: trade.confidence,
      target1: trade.target1,
      target2: trade.target2,
      exitDate: trade.exitDate,
      exitPrice: trade.exitPrice,
      exitValue: trade.exitValue,
      charges: trade.charges,
      incurredCharges: trade.incurredCharges,
      chargeModel: trade.chargeModel,
      realizedPnl: trade.realizedPnl,
      netRealizedPnl: trade.netRealizedPnl,
      realizedPct: trade.realizedPct,
      holdDays: trade.holdDays,
      status: trade.status,
      markPrice: trade.markPrice,
      markValue: trade.markValue,
      unrealizedPnl: trade.unrealizedPnl,
      netUnrealizedPnl: trade.netUnrealizedPnl,
      netTotalPnl: trade.netTotalPnl,
      t1Date: trade.t1Date,
      t2Date: trade.t2Date,
    })),
    equityCurve,
  }
}

async function runMomentumBacktest(options: BacktestOptions = {}): Promise<StrategyBacktestResult> {
  const strategyId = options.strategyId || 'catalyst'
  const strategy = resolveBacktestStrategy(options, strategyId)
  if (!strategy) throw new Error(`Unknown strategy: ${strategyId}`)
  if (strategy.type !== 'momentum') throw new Error(`Backtest currently supports momentum strategies only here; got ${strategy.type}`)

  const creds = await firstConnectedCreds()
  if (!creds) throw new Error('No Kite account connected — historical candles require a connected Kite account')

  const days = clampInt(options.days, 60, 10, 180)
  const startingCapital = typeof options.initialCapital === 'number' && options.initialCapital > 0
    ? Number(options.initialCapital.toFixed(2))
    : 50000

  const params = (strategy.params || {}) as Record<string, unknown>
  const minDayGainPct = typeof params.minDayGainPct === 'number' ? params.minDayGainPct : 0.5
  const maxDayGainPct = typeof params.maxDayGainPct === 'number' ? params.maxDayGainPct : 1.5
  const consecutiveCandles = clampInt(params.consecutiveCandles, 3, 1, 10)
  const emaProximityPct = typeof params.emaProximityPct === 'number' ? params.emaProximityPct : 3
  const volumeAvgDays = clampInt(params.volumeAvgDays, 10, 1, 60)
  const scanStartHHMM = typeof params.scanStartHHMM === 'string' ? params.scanStartHHMM : '09:30'
  const scanEndHHMM = typeof params.scanEndHHMM === 'string' ? params.scanEndHHMM : '14:30'
  const handoffDays = clampInt(params.deliveryHandoffDays, 15, 0, 365)
  const capitalCfg = getCapital()
  const accumulator = getStrategyById('accumulator')
  const fallbackT1Pct = accumulator?.exits?.t1Pct ?? 5
  const fallbackT2Pct = accumulator?.exits?.t2Pct ?? 8
  const momentumT1Pct = strategy.exits?.t1Pct ?? 1.5
  const momentumT2Pct = strategy.exits?.t2Pct ?? 2
  const sessionStartMin = hhmmToMinutes('09:15')
  const scanStartMin = hhmmToMinutes(scanStartHHMM)
  const scanEndMin = hhmmToMinutes(scanEndHHMM)
  const sessionMinutes = 375

  const symbols = await uniqueUniverseFromWatchlist(strategy)
  const tokens = await getInstrumentTokens(creds, symbols)

  let skippedNoToken = 0
  let skippedNoHistorical = 0
  let skippedCapitalLimited = 0
  let skippedPositionLimited = 0
  const gateCounts: GateCounter = {}
  const momentumDaySet = new Set<string>()

  const calendarLookbackDays = Math.max(180, days * 3)
  const fromDaily = ymdIST(-calendarLookbackDays)
  const toDaily = ymdIST(-1)
  const toIntraday = `${toDaily} 15:30:00`

  const fetched = await mapWithLimit(symbols, 2, async (symbol): Promise<MomentumSeries | null> => {
    const token = tokens[symbol]
    if (!token) { skippedNoToken++; return null }
    try {
      const dailyCandles = await getHistoricalCandles(creds, token, fromDaily, toDaily, 'day')
      if (dailyCandles.length < Math.max(25, volumeAvgDays + 2)) {
        skippedNoHistorical++
        return null
      }

      // Momentum replay only needs intraday candles for the actual replay
      // window, not the full daily lookback used to seed EMA/volume stats.
      const intradayStartIdx = Math.max(0, dailyCandles.length - days - 5)
      const fromIntraday = `${dateOnly(dailyCandles[intradayStartIdx].date)} 09:15:00`
      const intradayCandles = await getHistoricalCandles(creds, token, fromIntraday, toIntraday, '5minute')
      if (intradayCandles.length === 0) {
        skippedNoHistorical++
        return null
      }

      const closes = dailyCandles.map(c => c.close)
      const emaSeries = computeEMA(closes, 20)
      const candleByDate = new Map(dailyCandles.map(c => [dateOnly(c.date), c]))
      const indexByDate = new Map(dailyCandles.map((c, idx) => [dateOnly(c.date), idx]))
      const { byDate, byTimestamp, metaByTimestamp } = groupIntradayCandles(intradayCandles)
      const dailyAggByDate = new Map<string, { ema20: number; avgVolume10d: number; prevClose: number }>()
      for (let idx = volumeAvgDays; idx < dailyCandles.length; idx++) {
        const date = dateOnly(dailyCandles[idx].date)
        const ema20 = emaSeries[idx - 1]
        if (!ema20 || Number.isNaN(ema20)) continue
        const prevClose = dailyCandles[idx - 1]?.close
        if (!prevClose) continue
        const avgVolume10d = Number((dailyCandles.slice(idx - volumeAvgDays, idx).reduce((sum, candle) => sum + candle.volume, 0) / volumeAvgDays).toFixed(2))
        dailyAggByDate.set(date, { ema20, avgVolume10d, prevClose })
      }
      return {
        symbol,
        candles: dailyCandles,
        emaSeries,
        candleByDate,
        indexByDate,
        intradayByDate: byDate,
        intradayByTimestamp: byTimestamp,
        intradayMetaByTimestamp: metaByTimestamp,
        dailyAggByDate,
      }
    } catch (err) {
      console.warn(`[backtest momentum] historical fetch failed ${symbol}:`, String(err).slice(0, 120))
      skippedNoHistorical++
      return null
    }
  })
  const series = fetched.filter((item): item is MomentumSeries => !!item)
  if (series.length === 0) throw new Error('No symbols had sufficient historical data for the momentum backtest window')

  const allDates = Array.from(new Set(series.flatMap(item => item.candles.map(c => dateOnly(c.date))))).sort()
  const backtestDates = allDates.slice(-days)
  const backtestDateSet = new Set(backtestDates)
  const dateIndex = new Map(allDates.map((date, idx) => [date, idx]))

  let cash = startingCapital
  let peakEquity = startingCapital
  const openTrades: OpenTrade[] = []
  const allTrades: OpenTrade[] = []
  const equityCurve: BacktestEquityPoint[] = []

  for (const date of backtestDates) {
    const todaysTimes = uniqueSortedTimes(series, date)
    const enteredToday = new Set<string>()

    for (const trade of openTrades) {
      if (trade.strategyPhase === 'accumulator') continue
      if (handoffDays <= 0) continue
      const ageDays = dayDiff(dateOnly(trade.entryDate), date)
      if (ageDays < handoffDays) continue
      trade.strategyPhase = 'accumulator'
      trade.handoffDate = date
      trade.target1 = Number((trade.entryPrice * (1 + fallbackT1Pct / 100)).toFixed(2))
      trade.target2 = Number((trade.entryPrice * (1 + fallbackT2Pct / 100)).toFixed(2))
      trade.setup = `${trade.setup || 'Momentum'} · handed off to accumulator on ${date}`
    }

    for (const ts of todaysTimes) {
      // Exit checks first — mirrors live tick order where existing positions are monitored before new entries.
      for (const trade of [...openTrades]) {
        const symbolSeries = series.find(item => item.symbol === trade.symbol)
        const candle = symbolSeries?.intradayByTimestamp.get(ts)
        if (!symbolSeries || !candle || trade.remainingQty < 1) continue

        const exitPrice = candle.close
        if (!trade.t1Done && exitPrice >= trade.target2) {
          const sellQty = trade.remainingQty
          const exitValue = Number((sellQty * trade.target2).toFixed(2))
          const costBasis = trade.remainingCost
          trade.remainingQty = 0
          trade.remainingCost = 0
          trade.realizedPnl = Number((trade.realizedPnl + (exitValue - costBasis)).toFixed(2))
          cash = Number((cash + exitValue).toFixed(2))
          trade.t2Done = true
          trade.t2Date = ts
          trade.exitDate = ts
          trade.exitValue = exitValue
          trade.exitPrice = Number((exitValue / trade.qty).toFixed(2))
        } else if (!trade.t1Done && exitPrice >= trade.target1) {
          const sellQty = Math.max(1, Math.floor(trade.remainingQty / 2))
          const exitValue = Number((sellQty * trade.target1).toFixed(2))
          const costBasis = Number((trade.entryPrice * sellQty).toFixed(2))
          trade.remainingQty -= sellQty
          trade.remainingCost = Number((trade.remainingCost - costBasis).toFixed(2))
          trade.realizedPnl = Number((trade.realizedPnl + (exitValue - costBasis)).toFixed(2))
          trade.exitValue = Number(((trade.exitValue || 0) + exitValue).toFixed(2))
          cash = Number((cash + exitValue).toFixed(2))
          trade.t1Done = true
          trade.t1Date = ts
        } else if (trade.t1Done && exitPrice >= trade.target2) {
          const sellQty = trade.remainingQty
          const exitValue = Number((sellQty * trade.target2).toFixed(2))
          const costBasis = trade.remainingCost
          trade.remainingQty = 0
          trade.remainingCost = 0
          trade.realizedPnl = Number((trade.realizedPnl + (exitValue - costBasis)).toFixed(2))
          cash = Number((cash + exitValue).toFixed(2))
          trade.t2Done = true
          trade.t2Date = ts
          trade.exitDate = ts
          trade.exitValue = Number(((trade.exitValue || 0) + exitValue).toFixed(2))
          trade.exitPrice = Number((trade.exitValue / trade.qty).toFixed(2))
        }

        if (trade.remainingQty === 0) {
          trade.status = 'closed'
          trade.markPrice = trade.exitPrice || trade.target2
          trade.markValue = trade.exitValue || Number((trade.qty * trade.markPrice).toFixed(2))
          trade.unrealizedPnl = 0
          trade.realizedPct = trade.entryValue > 0 ? Number(((trade.realizedPnl / trade.entryValue) * 100).toFixed(2)) : 0
          trade.holdDays = Math.max(0, (dateIndex.get(date) || 0) - (dateIndex.get(dateOnly(trade.entryDate)) || 0))
          enteredToday.add(trade.symbol)
        } else {
          trade.markPrice = candle.close
          trade.markValue = Number((trade.remainingQty * candle.close).toFixed(2))
          trade.unrealizedPnl = Number((trade.markValue - trade.remainingCost).toFixed(2))
        }
      }

      for (let i = openTrades.length - 1; i >= 0; i--) {
        if (openTrades[i].status === 'closed') openTrades.splice(i, 1)
      }

      // Entry scan for this timestamp.
      for (const item of series) {
        if (enteredToday.has(item.symbol)) {
          bumpGate(gateCounts, 'enteredToday', 'Already entered this symbol today')
          continue
        }
        if (openTrades.some(trade => trade.symbol === item.symbol)) {
          bumpGate(gateCounts, 'alreadyOpen', 'Existing open position in symbol')
          continue
        }
        const candle = item.intradayByTimestamp.get(ts)
        const meta = item.intradayMetaByTimestamp.get(ts)
        const agg = item.dailyAggByDate.get(date)
        if (!candle || !meta || !agg) continue
        if (!backtestDateSet.has(date)) continue
        const currentMin = hhmmToMinutes(timeOnly(ts))
        if (currentMin < scanStartMin || currentMin > scanEndMin) {
          bumpGate(gateCounts, 'scanWindow', 'Outside configured scan window')
          continue
        }
        if (openTrades.length >= capitalCfg.maxPositions) {
          skippedPositionLimited++
          bumpGate(gateCounts, 'maxPositions', 'Blocked by max open positions')
          continue
        }

        const dayBars = item.intradayByDate.get(date) || []
        if (meta.indexInDay < consecutiveCandles - 1) {
          bumpGate(gateCounts, 'needMoreCandles', 'Not enough candles yet for pattern')
          continue
        }
        const dayGainPct = ((candle.close - agg.prevClose) / agg.prevClose) * 100
        if (dayGainPct < minDayGainPct) {
          bumpGate(gateCounts, 'minDayGainPct', 'Below minimum day-gain threshold')
          continue
        }
        if (dayGainPct > maxDayGainPct) {
          bumpGate(gateCounts, 'maxDayGainPct', 'Above maximum day-gain threshold')
          continue
        }
        const emaDev = deviationPct(candle.close, agg.ema20)
        if (Math.abs(emaDev) > emaProximityPct) {
          bumpGate(gateCounts, 'emaProximity', 'Too far from EMA proximity band')
          continue
        }

        const elapsedMin = Math.max(1, currentMin - sessionStartMin)
        const proratedAvgVol = agg.avgVolume10d * (elapsedMin / sessionMinutes)
        if (meta.cumulativeVolume < proratedAvgVol) {
          bumpGate(gateCounts, 'volumeAvg', 'Volume below prorated average')
          continue
        }

        const lastN = dayBars.slice(meta.indexInDay - consecutiveCandles + 1, meta.indexInDay + 1)
        let rising = true
        for (let i = 1; i < lastN.length; i++) {
          if (lastN[i].close <= lastN[i - 1].close) { rising = false; break }
        }
        if (!rising) {
          bumpGate(gateCounts, 'risingCandles', 'Consecutive rising-candle pattern not met')
          continue
        }

        const budget = Math.min(capitalCfg.perTrade, cash)
        const qty = Math.floor(budget / candle.close)
        if (qty < 1) {
          skippedCapitalLimited++
          bumpGate(gateCounts, 'capitalTooLow', 'Insufficient capital for next entry')
          continue
        }

        momentumDaySet.add(date)

        const entryValue = Number((qty * candle.close).toFixed(2))
        cash = Number((cash - entryValue).toFixed(2))
        const trade: OpenTrade = {
          symbol: item.symbol,
          signalDate: ts,
          entryDate: ts,
          entryPrice: candle.close,
          qty,
          buyNumber: 1,
          entryValue,
          emaAtSignal: Number(agg.ema20.toFixed(2)),
          deviationPct: Number(emaDev.toFixed(2)),
          downDays: consecutiveCandles,
          confidence: 'normal',
          target1: Number((candle.close * (1 + momentumT1Pct / 100)).toFixed(2)),
          target2: Number((candle.close * (1 + momentumT2Pct / 100)).toFixed(2)),
          realizedPnl: 0,
          realizedPct: 0,
          holdDays: 0,
          status: 'open',
          markPrice: candle.close,
          markValue: entryValue,
          unrealizedPnl: 0,
          setup: `+${dayGainPct.toFixed(2)}% day gain · ${consecutiveCandles} rising candles · vol ${Math.round(meta.cumulativeVolume).toLocaleString('en-IN')}`,
          remainingQty: qty,
          remainingCost: entryValue,
          t1Done: false,
          t2Done: false,
          strategyPhase: 'momentum',
        }
        openTrades.push(trade)
        allTrades.push(trade)
        enteredToday.add(item.symbol)
      }
    }

    let marketValue = 0
    for (const trade of openTrades) {
      const symbolSeries = series.find(item => item.symbol === trade.symbol)
      const latestCandle = (symbolSeries?.intradayByDate.get(date) || []).slice(-1)[0]
      if (!latestCandle) continue
      trade.markPrice = latestCandle.close
      trade.markValue = Number((trade.remainingQty * latestCandle.close).toFixed(2))
      trade.unrealizedPnl = Number((trade.markValue - trade.remainingCost).toFixed(2))
      marketValue += trade.markValue
    }
    marketValue = Number(marketValue.toFixed(2))
    const equity = Number((cash + marketValue).toFixed(2))
    peakEquity = Math.max(peakEquity, equity)
    const drawdownPct = peakEquity > 0 ? Number((((peakEquity - equity) / peakEquity) * 100).toFixed(2)) : 0
    equityCurve.push({ date, cash, marketValue, equity, drawdownPct, openTrades: openTrades.length })
  }

  const lastDate = backtestDates[backtestDates.length - 1]
  for (const trade of allTrades) {
    if (trade.status === 'closed') continue
    trade.holdDays = Math.max(0, (dateIndex.get(lastDate) || 0) - (dateIndex.get(dateOnly(trade.entryDate)) || 0))
    trade.markValue = Number((trade.remainingQty * trade.markPrice).toFixed(2))
    trade.unrealizedPnl = Number((trade.markValue - trade.remainingCost).toFixed(2))
    trade.realizedPct = trade.entryValue > 0
      ? Number(((((trade.realizedPnl + trade.unrealizedPnl) / trade.entryValue) * 100)).toFixed(2))
      : 0
  }

  const realizedPnl = Number(allTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0).toFixed(2))
  const unrealizedPnl = Number(allTrades.filter(trade => trade.status === 'open').reduce((sum, trade) => sum + trade.unrealizedPnl, 0).toFixed(2))
  const endingCapital = equityCurve[equityCurve.length - 1]?.equity ?? startingCapital
  const chargeSummary = applyBacktestCharges(allTrades, lastDate)
  const closedTrades = allTrades.filter(trade => trade.status === 'closed')
  const wins = closedTrades.filter(trade => (trade.netRealizedPnl ?? trade.realizedPnl) > 0).length
  const losses = closedTrades.filter(trade => (trade.netRealizedPnl ?? trade.realizedPnl) < 0).length
  const holdDays = closedTrades.map(trade => trade.holdDays)
  const maxDrawdownPct = equityCurve.reduce((max, point) => Math.max(max, point.drawdownPct), 0)

  return {
    summary: {
      strategyId: strategy.id,
      strategyName: strategy.name,
      days,
      tradingDays: backtestDates.length,
      dipDays: 0,
      momentumDays: momentumDaySet.size,
      startingCapital,
      endingCapital,
      totalCharges: chargeSummary.totalCharges,
      incurredCharges: chargeSummary.incurredCharges,
      realizedPnl,
      netRealizedPnl: chargeSummary.netRealizedPnl,
      unrealizedPnl,
      netUnrealizedPnl: chargeSummary.netUnrealizedPnl,
      totalPnl: Number((realizedPnl + unrealizedPnl).toFixed(2)),
      netTotalPnl: chargeSummary.netTotalPnl,
      totalReturnPct: startingCapital > 0 ? Number((((endingCapital - startingCapital) / startingCapital) * 100).toFixed(2)) : 0,
      netTotalReturnPct: startingCapital > 0 ? round2((chargeSummary.netTotalPnl / startingCapital) * 100) : 0,
      netEndingCapital: round2(startingCapital + chargeSummary.netTotalPnl),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      tradesClosed: closedTrades.length,
      tradesOpen: allTrades.length - closedTrades.length,
      wins,
      losses,
      winRate: closedTrades.length > 0 ? Number(((wins / closedTrades.length) * 100).toFixed(2)) : null,
      avgHoldDays: avg(holdDays.map(Number)) !== null ? Number((avg(holdDays.map(Number)) || 0).toFixed(2)) : null,
      skippedNoToken,
      skippedNoHistorical,
      skippedCapitalLimited,
      skippedPositionLimited,
      gateBreakdown: toGateBreakdown(gateCounts),
    },
    trades: allTrades.map(trade => ({
      strategyId: strategy.id,
      strategyName: strategy.name,
      symbol: trade.symbol,
      signalDate: trade.signalDate,
      entryDate: trade.entryDate,
      entryPrice: trade.entryPrice,
      qty: trade.qty,
      remainingQty: trade.remainingQty,
      buyNumber: trade.buyNumber,
      entryValue: trade.entryValue,
      emaAtSignal: trade.emaAtSignal,
      deviationPct: Number(trade.deviationPct.toFixed(2)),
      downDays: trade.downDays,
      confidence: trade.confidence,
      target1: trade.target1,
      target2: trade.target2,
      exitDate: trade.exitDate,
      exitPrice: trade.exitPrice,
      exitValue: trade.exitValue,
      charges: trade.charges,
      incurredCharges: trade.incurredCharges,
      chargeModel: trade.chargeModel,
      realizedPnl: trade.realizedPnl,
      netRealizedPnl: trade.netRealizedPnl,
      realizedPct: trade.realizedPct,
      holdDays: trade.holdDays,
      status: trade.status,
      markPrice: trade.markPrice,
      markValue: trade.markValue,
      unrealizedPnl: trade.unrealizedPnl,
      netUnrealizedPnl: trade.netUnrealizedPnl,
      netTotalPnl: trade.netTotalPnl,
      setup: trade.setup,
      t1Date: trade.t1Date,
      t2Date: trade.t2Date,
    })),
    equityCurve,
  }
}