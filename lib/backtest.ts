import { getState } from './state'
import { getWatchlist } from './watchlistStore'
import { computeEMA, consecutiveDownDays, deviationPct } from './ema'
import { getHistoricalCandles, resolveAccountCreds, type HistoricalCandle, type KiteCreds } from './kite'
import { getInstrumentTokens } from './instruments'
import { getCapital, getStrategyById, type Strategy } from './strategyConfig'

export interface BacktestOptions {
  days?: number
  initialCapital?: number
  strategyId?: string
}

export interface BacktestTrade {
  symbol: string
  signalDate: string
  entryDate: string
  entryPrice: number
  qty: number
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
  realizedPnl: number
  realizedPct: number
  holdDays: number
  status: 'closed' | 'open'
  markPrice: number
  markValue: number
  unrealizedPnl: number
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

export interface BacktestSummary {
  strategyId: string
  strategyName: string
  days: number
  tradingDays: number
  startingCapital: number
  endingCapital: number
  realizedPnl: number
  unrealizedPnl: number
  totalPnl: number
  totalReturnPct: number
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
}

export interface StrategyBacktestResult {
  summary: BacktestSummary
  trades: BacktestTrade[]
  equityCurve: BacktestEquityPoint[]
}

interface PendingEntry {
  date: string
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
}

interface SymbolSeries {
  symbol: string
  candles: HistoricalCandle[]
  emaSeries: number[]
  candleByDate: Map<string, HistoricalCandle>
  indexByDate: Map<string, number>
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

export async function runStrategy1Backtest(options: BacktestOptions = {}): Promise<StrategyBacktestResult> {
  const strategyId = options.strategyId || 'accumulator'
  const strategy = getStrategyById(strategyId)
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
  const tranche2AboveEMAPct = typeof params.tranche2AboveEMAPct === 'number' ? params.tranche2AboveEMAPct : 3
  const capital = getCapital()

  const symbols = await uniqueUniverseFromWatchlist(strategy)
  const tokens = await getInstrumentTokens(creds, symbols)

  let skippedNoToken = 0
  let skippedNoHistorical = 0
  let skippedCapitalLimited = 0
  let skippedPositionLimited = 0

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
        continue
      }
      if (symbolOpenCount >= capital.maxBuysPerSymbol) {
        skippedPositionLimited++
        continue
      }

      const budget = Math.min(capital.perTrade, cash)
      const qty = Math.floor(budget / candle.open)
      if (qty < 1) {
        skippedCapitalLimited++
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
        target1: Number(pending.emaAtSignal.toFixed(2)),
        target2: Number((pending.emaAtSignal * (1 + tranche2AboveEMAPct / 100)).toFixed(2)),
        realizedPnl: 0,
        realizedPct: 0,
        holdDays: 0,
        status: 'open',
        markPrice: candle.close,
        markValue: Number((qty * candle.close).toFixed(2)),
        unrealizedPnl: Number((qty * (candle.close - candle.open)).toFixed(2)),
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
        trade.exitPrice = Number((((trade.exitValue || 0) + exitValue) / trade.qty).toFixed(2))
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
        trade.unrealizedPnl = Number((trade.realizedPnl + trade.markValue - trade.remainingCost).toFixed(2))
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
      if (dev > -entryBelowPct) continue
      if (dev < -capitulationFloorPct) continue
      if (downDays < minDownDays) continue

      const openForSymbol = allTrades
        .filter(trade => trade.symbol === item.symbol && trade.status === 'open')
        .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      if (openForSymbol.length > 0) {
        const lastBuy = openForSymbol[openForSymbol.length - 1]
        const threshold = lastBuy.entryPrice * (1 - capital.minDropBetweenBuysPct / 100)
        if (candle.close > threshold) continue
      }

      const nextDate = item.candles[idx + 1]?.date.slice(0, 10)
      if (!nextDate || !backtestDateSet.has(nextDate)) continue

      pushPending({
        date: nextDate,
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
      trade.unrealizedPnl = Number((trade.realizedPnl + trade.markValue - trade.remainingCost).toFixed(2))
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
    trade.unrealizedPnl = Number((trade.realizedPnl + trade.markValue - trade.remainingCost).toFixed(2))
    trade.realizedPct = trade.entryValue > 0
      ? Number(((((trade.realizedPnl + trade.unrealizedPnl) / trade.entryValue) * 100)).toFixed(2))
      : 0
  }

  const realizedPnl = Number(allTrades.filter(trade => trade.status === 'closed').reduce((sum, trade) => sum + trade.realizedPnl, 0).toFixed(2))
  const unrealizedPnl = Number(allTrades.filter(trade => trade.status === 'open').reduce((sum, trade) => sum + trade.unrealizedPnl, 0).toFixed(2))
  const endingCapital = equityCurve[equityCurve.length - 1]?.equity ?? startingCapital
  const closedTrades = allTrades.filter(trade => trade.status === 'closed')
  const wins = closedTrades.filter(trade => trade.realizedPnl > 0).length
  const losses = closedTrades.filter(trade => trade.realizedPnl < 0).length
  const holdDays = closedTrades.map(trade => trade.holdDays)
  const maxDrawdownPct = equityCurve.reduce((max, point) => Math.max(max, point.drawdownPct), 0)

  return {
    summary: {
      strategyId: strategy.id,
      strategyName: strategy.name,
      days,
      tradingDays: backtestDates.length,
      startingCapital,
      endingCapital,
      realizedPnl,
      unrealizedPnl,
      totalPnl: Number((realizedPnl + unrealizedPnl).toFixed(2)),
      totalReturnPct: startingCapital > 0 ? Number((((endingCapital - startingCapital) / startingCapital) * 100).toFixed(2)) : 0,
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
    },
    trades: allTrades.map(trade => ({
      symbol: trade.symbol,
      signalDate: trade.signalDate,
      entryDate: trade.entryDate,
      entryPrice: trade.entryPrice,
      qty: trade.qty,
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
      realizedPnl: trade.realizedPnl,
      realizedPct: trade.realizedPct,
      holdDays: trade.holdDays,
      status: trade.status,
      markPrice: trade.markPrice,
      markValue: trade.markValue,
      unrealizedPnl: trade.unrealizedPnl,
      t1Date: trade.t1Date,
      t2Date: trade.t2Date,
    })),
    equityCurve,
  }
}