import { getHistoricalCandles, getHoldings, getPositions, kiteRequest, getQuotes, resolveAccountCreds, type HistoricalCandle, type KiteCreds } from './kite'
import { getInstrumentTokens } from './instruments'
import { listJournalDates, readJournalRange, type OrderRecord } from './journal'
import { getStrategies, getStrategyById } from './strategyConfig'
import { getState } from './state'
import { applyBacktestCharges, type BacktestEquityPoint, type BacktestTrade, type StrategyBacktestResult } from './backtest'

export interface LiveTradeReportOptions {
  fromDate: string
  toDate: string
  account?: string
  strategyId?: string
}

interface SellEvent {
  date: string
  ts: string
  qty: number
  price: number
}

interface InternalTrade extends BacktestTrade {
  account: string
  sellEvents: SellEvent[]
  activeInRange: boolean
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

function assertYmd(value: string, label: string): void {
  if (!YMD.test(value)) throw new Error(`${label} must be YYYY-MM-DD`)
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10)
}

function dayDiff(fromYmd: string, toYmd: string): number {
  const start = new Date(`${fromYmd}T00:00:00Z`)
  const end = new Date(`${toYmd}T00:00:00Z`)
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)))
}

function clampMoney(value: number): number {
  return Number(value.toFixed(2))
}

function rangeIncludes(fromDate: string, toDate: string, date: string | undefined): boolean {
  return !!date && date >= fromDate && date <= toDate
}

function displayStrategyName(strategyId: string | undefined, account: string, multiAccount: boolean, manual: boolean): string {
  const strategy = strategyId ? getStrategyById(strategyId) : null
  const fallback = manual
    ? 'Manual'
    : strategyId === 'accumulator'
      ? 'Accumulator'
      : strategyId === 'catalyst'
        ? 'Catalyst'
        : (strategyId || 'Auto')
  const base = strategy?.name || fallback
  return multiAccount ? `${account} · ${base}` : base
}

async function firstConnectedCreds(): Promise<KiteCreds | null> {
  const state = await getState()
  for (const account of Object.keys(state.kiteTokens)) {
    const resolved = await resolveAccountCreds(account)
    if (resolved.ok) return { apiKey: resolved.apiKey, accessToken: resolved.accessToken }
  }
  return null
}

interface MarginsResponse {
  equity?: { available?: { live_balance?: number; cash?: number } }
}

async function loadLiveCapitalBase(accounts: string[]): Promise<number | null> {
  const uniqueAccounts = Array.from(new Set(accounts.map(account => account.trim().toUpperCase()).filter(Boolean)))
  if (uniqueAccounts.length === 0) return null

  const totals = await Promise.all(uniqueAccounts.map(async account => {
    const resolved = await resolveAccountCreds(account)
    if (!resolved.ok) return null
    const creds = { apiKey: resolved.apiKey, accessToken: resolved.accessToken }
    const [marginsResult, positionsResult, holdingsResult] = await Promise.all([
      kiteRequest<{ data?: MarginsResponse }>('/user/margins', creds).catch(() => null),
      getPositions(creds).catch(() => ({ net: [], day: [] })),
      getHoldings(creds).catch(() => [] as Awaited<ReturnType<typeof getHoldings>>),
    ])

    const available = Number(marginsResult?.data?.data?.equity?.available?.live_balance ?? marginsResult?.data?.data?.equity?.available?.cash ?? 0)
    const bySymbol = new Map<string, number>()
    for (const position of positionsResult.net) {
      if (position.quantity > 0) bySymbol.set(position.tradingsymbol.toUpperCase(), position.quantity * (position.last_price || 0))
    }
    for (const holding of holdingsResult) {
      const symbol = holding.tradingsymbol.toUpperCase()
      const heldQty = (holding.quantity || 0) + ((holding as any).t1_quantity || 0)
      if (!bySymbol.has(symbol) && heldQty > 0) bySymbol.set(symbol, heldQty * (holding.last_price || 0))
    }
    const deployed = Array.from(bySymbol.values()).reduce((sum, value) => sum + value, 0)
    return clampMoney(available + deployed)
  }))

  const usable = totals.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  if (usable.length === 0) return null
  return clampMoney(usable.reduce((sum, value) => sum + value, 0))
}

function minusDays(dateYmd: string, days: number): string {
  const d = new Date(`${dateYmd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

async function loadDailyCloses(symbols: string[], fromDate: string, toDate: string): Promise<Map<string, HistoricalCandle[]>> {
  const out = new Map<string, HistoricalCandle[]>()
  if (symbols.length === 0) return out
  const creds = await firstConnectedCreds()
  if (!creds) return out
  const tokens = await getInstrumentTokens(creds, symbols)
  const from = minusDays(fromDate, 7)
  await Promise.all(symbols.map(async symbol => {
    const token = tokens[symbol]
    if (!token) return
    try {
      const candles = await getHistoricalCandles(creds, token, from, toDate, 'day')
      out.set(symbol, candles)
    } catch {
      out.set(symbol, [])
    }
  }))
  return out
}

async function loadTodayMarks(symbols: string[], toDate: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const today = new Date().toISOString().slice(0, 10)
  if (toDate !== today || symbols.length === 0) return out
  const creds = await firstConnectedCreds()
  if (!creds) return out
  try {
    const quotes = await getQuotes(creds, symbols)
    for (const [key, value] of Object.entries(quotes)) {
      out.set(key.replace(/^NSE:/, '').toUpperCase(), Number((value as any).last_price) || 0)
    }
  } catch {
    return out
  }
  return out
}

function closeOnOrBefore(candles: HistoricalCandle[] | undefined, date: string, fallback: number): number {
  if (!candles || candles.length === 0) return fallback
  let value = fallback
  for (const candle of candles) {
    const candleDate = dateOnly(candle.date)
    if (candleDate > date) break
    value = candle.close
  }
  return value
}

function inferT1Date(tag: string | undefined, trade: InternalTrade, soldQty: number, previousRemaining: number, orderDate: string): string | undefined {
  if (tag?.endsWith('-t1')) return orderDate
  if (!trade.t1Date && soldQty < previousRemaining) return orderDate
  return trade.t1Date
}

function inferT2Date(tag: string | undefined, trade: InternalTrade, remainingQty: number, previousRemaining: number, orderDate: string): string | undefined {
  if (tag?.endsWith('-t2')) return orderDate
  if (remainingQty === 0 && previousRemaining < trade.qty) return orderDate
  return trade.t2Date
}

function hasActivityInRange(trade: InternalTrade, fromDate: string, toDate: string): boolean {
  return rangeIncludes(fromDate, toDate, trade.entryDate)
    || rangeIncludes(fromDate, toDate, trade.t1Date)
    || rangeIncludes(fromDate, toDate, trade.t2Date)
    || rangeIncludes(fromDate, toDate, trade.exitDate)
}

export async function buildLiveTradeReport(options: LiveTradeReportOptions): Promise<StrategyBacktestResult> {
  const fromDate = options.fromDate
  const toDate = options.toDate
  const accountFilter = (options.account || '').trim().toUpperCase()
  const strategyFilter = (options.strategyId || '').trim()
  assertYmd(fromDate, 'From date')
  assertYmd(toDate, 'To date')
  if (fromDate > toDate) throw new Error('From date must be on or before To date')

  const knownDates = (await listJournalDates()).filter(date => date <= toDate).sort()
  const earliest = knownDates[0] || fromDate
  const records = await readJournalRange(earliest, toDate)
  const orders = records
    .filter((record): record is OrderRecord => record.type === 'order')
    .sort((a, b) => a.ts.localeCompare(b.ts))

  const multiAccount = new Set(orders.map(order => order.account)).size > 1
  const strategyIndex = new Map(getStrategies().map(strategy => [strategy.id, strategy]))

  const openTrades: InternalTrade[] = []
  const allTrades: InternalTrade[] = []

  for (const order of orders) {
    if (order.side === 'BUY') {
      const strategy = order.strategyId ? strategyIndex.get(order.strategyId) || null : null
      const priorBuys = allTrades.filter(trade => trade.account === order.account && trade.symbol === order.symbol && trade.strategyId === order.strategyId).length
      const trade: InternalTrade = {
        account: order.account,
        strategyId: order.strategyId,
        strategyName: displayStrategyName(order.strategyId, order.account, multiAccount, order.source === 'manual'),
        symbol: order.symbol,
        signalDate: order.date,
        entryDate: order.date,
        entryPrice: order.price,
        qty: order.qty,
        remainingQty: order.qty,
        buyNumber: priorBuys + 1,
        entryValue: clampMoney(order.qty * order.price),
        emaAtSignal: 0,
        deviationPct: 0,
        downDays: 0,
        confidence: 'normal',
        target1: strategy ? clampMoney(order.price * (1 + strategy.exits.t1Pct / 100)) : order.price,
        target2: strategy ? clampMoney(order.price * (1 + strategy.exits.t2Pct / 100)) : order.price,
        exitValue: 0,
        realizedPnl: 0,
        realizedPct: 0,
        holdDays: 0,
        status: 'open',
        markPrice: order.price,
        markValue: clampMoney(order.qty * order.price),
        unrealizedPnl: 0,
        setup: order.source === 'manual' ? `Manual order · ${order.account}` : `Live order journal · ${order.account}`,
        sellEvents: [],
        activeInRange: rangeIncludes(fromDate, toDate, order.date),
      }
      openTrades.push(trade)
      allTrades.push(trade)
      continue
    }

    let remainingQty = order.qty
    let candidates = openTrades
      .filter(trade => trade.account === order.account && trade.symbol === order.symbol && trade.remainingQty > 0)
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
    if (order.strategyId) {
      const exact = candidates.filter(trade => trade.strategyId === order.strategyId)
      if (exact.length > 0) candidates = exact
    } else if (order.source === 'manual') {
      const manualOnly = candidates.filter(trade => !trade.strategyId)
      if (manualOnly.length > 0) candidates = manualOnly
    }

    for (const trade of candidates) {
      if (remainingQty <= 0) break
      const previousRemaining = trade.remainingQty
      const matchedQty = Math.min(previousRemaining, remainingQty)
      if (matchedQty <= 0) continue
      const fillValue = matchedQty * order.price
      trade.sellEvents.push({ date: order.date, ts: order.ts, qty: matchedQty, price: order.price })
      trade.exitValue = clampMoney((trade.exitValue || 0) + fillValue)
      trade.realizedPnl = clampMoney(trade.realizedPnl + (matchedQty * (order.price - trade.entryPrice)))
      trade.remainingQty -= matchedQty
      trade.t1Date = inferT1Date(order.tag, trade, matchedQty, previousRemaining, order.date)
      trade.t2Date = inferT2Date(order.tag, trade, trade.remainingQty, previousRemaining, order.date)
      trade.exitDate = order.date
      trade.activeInRange = trade.activeInRange || rangeIncludes(fromDate, toDate, order.date)
      remainingQty -= matchedQty
      if (trade.remainingQty === 0) {
        trade.status = 'closed'
        trade.holdDays = dayDiff(trade.entryDate, order.date)
      }
    }
  }

  const includedTrades = allTrades.filter(trade => {
    trade.activeInRange = trade.activeInRange || hasActivityInRange(trade, fromDate, toDate)
    if (!trade.activeInRange) return false
    if (accountFilter && trade.account !== accountFilter) return false
    if (strategyFilter === 'manual') return !trade.strategyId
    if (strategyFilter && strategyFilter !== 'manual') return trade.strategyId === strategyFilter
    return true
  })

  const symbols = Array.from(new Set(includedTrades.map(trade => trade.symbol)))
  const closeSeries = await loadDailyCloses(symbols, fromDate, toDate)
  const todayMarks = await loadTodayMarks(symbols, toDate)
  const liveCapitalBase = await loadLiveCapitalBase(
    accountFilter ? [accountFilter] : Array.from(new Set(includedTrades.map(trade => trade.account)))
  )

  for (const trade of includedTrades) {
    const soldQty = trade.sellEvents.reduce((sum, event) => sum + event.qty, 0)
    trade.exitPrice = soldQty > 0 ? clampMoney((trade.exitValue || 0) / soldQty) : undefined
    const markPrice = trade.remainingQty > 0
      ? (todayMarks.get(trade.symbol) || closeOnOrBefore(closeSeries.get(trade.symbol), toDate, trade.entryPrice))
      : (trade.exitPrice || trade.entryPrice)
    trade.markPrice = markPrice
    trade.markValue = clampMoney(trade.remainingQty * markPrice)
    trade.unrealizedPnl = clampMoney(trade.remainingQty * (markPrice - trade.entryPrice))
    trade.realizedPct = trade.entryValue > 0 ? Number(((trade.realizedPnl / trade.entryValue) * 100).toFixed(2)) : 0
    trade.holdDays = dayDiff(trade.entryDate, trade.exitDate || toDate)
  }

  const tradingDates = Array.from(new Set(
    Array.from(closeSeries.values()).flatMap(candles => candles.map(candle => dateOnly(candle.date)).filter(date => date >= fromDate && date <= toDate))
  )).sort()

  const effectiveDates = tradingDates.length > 0
    ? tradingDates
    : Array.from(new Set(includedTrades.flatMap(trade => [trade.entryDate, trade.t1Date, trade.t2Date, trade.exitDate].filter(Boolean) as string[])
      .filter(date => date >= fromDate && date <= toDate))).sort()

  const equityCurve: BacktestEquityPoint[] = effectiveDates.map(date => {
    let cash = 0
    let marketValue = 0
    let openCount = 0
    for (const trade of includedTrades) {
      if (trade.entryDate > date) continue
      const realizedValue = trade.sellEvents
        .filter(event => event.date <= date)
        .reduce((sum, event) => sum + (event.qty * event.price), 0)
      const soldQty = trade.sellEvents.filter(event => event.date <= date).reduce((sum, event) => sum + event.qty, 0)
      const remainingQty = Math.max(0, trade.qty - soldQty)
      const closePrice = remainingQty > 0
        ? closeOnOrBefore(closeSeries.get(trade.symbol), date, trade.entryPrice)
        : 0
      cash += realizedValue
      marketValue += remainingQty * closePrice
      if (remainingQty > 0) openCount += 1
    }
    return {
      date,
      cash: clampMoney(cash),
      marketValue: clampMoney(marketValue),
      equity: clampMoney(cash + marketValue),
      drawdownPct: 0,
      openTrades: openCount,
    }
  })

  let peak = 0
  let maxDrawdownPct = 0
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity)
    point.drawdownPct = peak > 0 ? Number((((peak - point.equity) / peak) * 100).toFixed(2)) : 0
    maxDrawdownPct = Math.max(maxDrawdownPct, point.drawdownPct)
  }

  const tradeNotionalCapital = clampMoney(includedTrades.reduce((sum, trade) => sum + trade.entryValue, 0))
  const startingCapital = liveCapitalBase ?? tradeNotionalCapital
  const realizedPnl = clampMoney(includedTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0))
  const unrealizedPnl = clampMoney(includedTrades.reduce((sum, trade) => sum + trade.unrealizedPnl, 0))
  const totalPnl = clampMoney(realizedPnl + unrealizedPnl)
  const endingCapital = clampMoney(startingCapital + totalPnl)
  const chargeSummary = applyBacktestCharges(includedTrades, toDate)
  const closedTrades = includedTrades.filter(trade => trade.remainingQty === 0)
  const wins = closedTrades.filter(trade => (trade.netRealizedPnl ?? trade.realizedPnl) > 0).length
  const losses = closedTrades.filter(trade => (trade.netRealizedPnl ?? trade.realizedPnl) < 0).length
  const avgHold = closedTrades.length > 0
    ? closedTrades.reduce((sum, trade) => sum + trade.holdDays, 0) / closedTrades.length
    : null
  const avgUtilizationPct = startingCapital > 0 && equityCurve.length > 0
    ? Number(((equityCurve.reduce((sum, point) => sum + point.marketValue, 0) / equityCurve.length / startingCapital) * 100).toFixed(2))
    : null
  const chargesAsPctOfGross = realizedPnl > 0
    ? Number((((chargeSummary.netRealizedPnl !== undefined
      ? realizedPnl - chargeSummary.netRealizedPnl
      : (chargeSummary.incurredCharges ?? chargeSummary.totalCharges ?? 0)) / realizedPnl) * 100).toFixed(2))
    : null
  const dipDays = new Set(includedTrades.filter(trade => trade.strategyId === 'accumulator').map(trade => trade.entryDate)).size
  const momentumDays = new Set(includedTrades.filter(trade => trade.strategyId === 'catalyst').map(trade => trade.entryDate)).size

  includedTrades.sort((a, b) => {
    if (a.entryDate !== b.entryDate) return b.entryDate.localeCompare(a.entryDate)
    return b.symbol.localeCompare(a.symbol)
  })

  return {
    summary: {
      strategyId: 'real-trades',
      strategyName: `Real Trades · ${fromDate} to ${toDate}`,
      days: dayDiff(fromDate, toDate) + 1,
      tradingDays: equityCurve.length,
      dipDays,
      momentumDays,
      startingCapital,
      endingCapital,
      totalCharges: chargeSummary.totalCharges,
      incurredCharges: chargeSummary.incurredCharges,
      realizedPnl,
      netRealizedPnl: chargeSummary.netRealizedPnl,
      unrealizedPnl,
      netUnrealizedPnl: chargeSummary.netUnrealizedPnl,
      totalPnl,
      netTotalPnl: chargeSummary.netTotalPnl,
      totalReturnPct: startingCapital > 0 ? Number(((totalPnl / startingCapital) * 100).toFixed(2)) : 0,
      netTotalReturnPct: startingCapital > 0 ? Number(((chargeSummary.netTotalPnl / startingCapital) * 100).toFixed(2)) : 0,
      netEndingCapital: clampMoney(startingCapital + chargeSummary.netTotalPnl),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      tradesClosed: closedTrades.length,
      tradesOpen: includedTrades.length - closedTrades.length,
      wins,
      losses,
      winRate: closedTrades.length > 0 ? Number(((wins / closedTrades.length) * 100).toFixed(2)) : null,
      avgHoldDays: avgHold === null ? null : Number(avgHold.toFixed(1)),
      avgUtilizationPct,
      chargesAsPctOfGross,
      skippedNoToken: 0,
      skippedNoHistorical: 0,
      skippedCapitalLimited: 0,
      skippedPositionLimited: 0,
      gateBreakdown: [],
    },
    trades: includedTrades,
    equityCurve,
  }
}