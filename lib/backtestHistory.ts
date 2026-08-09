import type { StrategyBacktestResult } from './backtest'
import { callAI } from './ai'
import { getCapital, asMomentumParams, type Strategy, type StrategyType } from './strategyConfig'
import { getSupabaseAdmin, getCustomerId } from './supabase'

export type BacktestHistoryStrategyType = StrategyType | 'all'

export interface BacktestHistoryEntry {
  runId: string
  timestamp: string
  strategyName: string
  strategyType: BacktestHistoryStrategyType
  entryParams: Record<string, unknown>
  exitCriteria: Record<string, unknown>
  startingAmount: number
  maxBuysPerDay: number
  maxSellsPerDay: number
  backtestDays: number
  closedTrades: number
  openTrades: number
  avgHoldDays: number | null
  avgDrawdownPct: number
  netProfitRupees: number
  netProfitPct: number
  realizedProfitRupees: number
  realizedProfitPct: number
  unrealizedMTM: number
  winRate: number | null
  capitalEfficiency: number
  avgDeployedCapital: number
  tradePnls: number[]
  strategySnapshot?: Strategy | null
  strategySnapshots?: Strategy[]
}

export const BACKTEST_ANALYSIS_SYSTEM_PROMPT = [
  'You are a trading strategy coach writing for a non-technical retail investor.',
  'Use only realizedProfitRupees and realizedProfitPct to judge whether a run performed well.',
  'Treat unrealizedMTM and openTrades as pending exposure only. Never count them as profit or loss when deciding winners, rankings, or recommendations.',
  'Never mention internal ids or raw JSON keys unless absolutely necessary. Refer to each run using strategyName, timestampLabel, and backtestDays.',
  'Focus on practical insight: which strategy family is behaving better, which parameter changes seem to help or hurt realized profit, and what the user should test next.',
  'Write in plain English with short sections and bullets.',
  'Your response must contain exactly these sections: 1) Executive Summary, 2) Best Performing Strategy Right Now, 3) What Improved Results, 4) What Hurt Results, 5) Suggested Next Backtests.',
  'In Suggested Next Backtests, provide 3 specific experiments with exact parameter changes and the reason for each.',
].join(' ')

const SINGLE_BACKTEST_ANALYSIS_SYSTEM_PROMPT = [
  'You are a trading strategy coach writing for a non-technical retail investor.',
  'Analyse one completed backtest run and explain it in plain English.',
  'Judge performance primarily on net realized profit and net realized return, not open MTM.',
  'Use skipped orders and gate breakdown to explain why order count or deployed capital may be low.',
  'Comment on trade frequency, capital usage, open positions, order sizing, and which gates appear too restrictive or too loose.',
  'Give practical recommendations aimed at improving: net realized profit, number of good orders, capital deployment, and average order size, while respecting risk.',
  'Be specific about parameter experiments. Mention tradeoffs when suggesting higher capital usage or looser gates.',
  'Your response must contain exactly these sections: 1) Backtest Summary, 2) What Limited Performance, 3) What Looks Promising, 4) Recommendations, 5) Suggested Next Experiments.',
  'In Suggested Next Experiments, provide 4 concrete tests with exact parameter changes and why each test matters.',
].join(' ')

function round2(value: number): number {
  return Number(value.toFixed(2))
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function buildRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const suffix = Math.random().toString(36).slice(2, 8)
  return `bt-${stamp}-${suffix}`
}

function cloneStrategy(strategy: Strategy | null | undefined): Strategy | null {
  if (!strategy) return null
  return JSON.parse(JSON.stringify(strategy)) as Strategy
}

function cloneStrategies(strategies: Strategy[]): Strategy[] {
  return JSON.parse(JSON.stringify(strategies)) as Strategy[]
}

// ─── Supabase row mapping ───────────────────────────────────────────────────
// `backtest_runs` splits the entry into: strategy_name/strategy_type (their
// own columns), params (← entryParams), and results — a jsonb catch-all for
// everything else (exitCriteria + every numeric summary field + runId/
// timestamp, since the table has no dedicated columns for those). Lossless
// round trip; no schema extension needed for this store.

function entryToRow(customerId: string, entry: BacktestHistoryEntry): Record<string, unknown> {
  const { strategyName, strategyType, entryParams, runId, timestamp, exitCriteria, ...rest } = entry
  return {
    customer_id: customerId,
    strategy_name: strategyName,
    strategy_type: strategyType,
    params: entryParams,
    results: { runId, timestamp, exitCriteria, ...rest },
    run_at: timestamp,
  }
}

function rowToEntry(row: any): BacktestHistoryEntry {
  const r = row.results || {}
  return {
    runId: r.runId,
    timestamp: r.timestamp || row.run_at,
    strategyName: row.strategy_name,
    strategyType: row.strategy_type,
    entryParams: row.params || {},
    exitCriteria: r.exitCriteria || {},
    startingAmount: r.startingAmount,
    maxBuysPerDay: r.maxBuysPerDay,
    maxSellsPerDay: r.maxSellsPerDay,
    backtestDays: r.backtestDays,
    closedTrades: r.closedTrades,
    openTrades: r.openTrades,
    avgHoldDays: r.avgHoldDays ?? null,
    avgDrawdownPct: r.avgDrawdownPct,
    netProfitRupees: r.netProfitRupees,
    netProfitPct: r.netProfitPct,
    realizedProfitRupees: r.realizedProfitRupees,
    realizedProfitPct: r.realizedProfitPct,
    unrealizedMTM: r.unrealizedMTM,
    winRate: r.winRate ?? null,
    capitalEfficiency: r.capitalEfficiency,
    avgDeployedCapital: r.avgDeployedCapital,
    tradePnls: Array.isArray(r.tradePnls) ? r.tradePnls : [],
    strategySnapshot: r.strategySnapshot ?? null,
    strategySnapshots: r.strategySnapshots ?? undefined,
  }
}

export function buildBacktestHistoryEntry(input: {
  result: StrategyBacktestResult
  strategySnapshot?: Strategy | null
  strategySnapshots?: Strategy[]
}): BacktestHistoryEntry {
  const capital = getCapital()
  const { result } = input
  const summary = result.summary
  const singleStrategy = input.strategySnapshot ? cloneStrategy(input.strategySnapshot) : null
  const multiStrategies = input.strategySnapshots ? cloneStrategies(input.strategySnapshots) : undefined
  const avgDrawdownPct = round2(average(result.equityCurve.map(point => point.drawdownPct || 0)))
  const avgDeployedCapital = round2(average(result.equityCurve.map(point => point.marketValue || 0)))
  const netProfitRupees = round2(summary.netTotalPnl ?? summary.totalPnl)
  const startingAmount = round2(summary.startingCapital)
  const realizedProfitRupees = round2(summary.realizedPnl)
  const realizedProfitPct = startingAmount > 0 ? round2((realizedProfitRupees / startingAmount) * 100) : 0
  const tradePnls = result.trades
    .map(trade => round2(trade.netRealizedPnl ?? trade.realizedPnl))
    .filter(value => Number.isFinite(value) && value !== 0)
    .sort((a, b) => b - a)

  let strategyName = summary.strategyName
  let strategyType: BacktestHistoryStrategyType = 'all'
  let entryParams: Record<string, unknown>
  let exitCriteria: Record<string, unknown>

  if (singleStrategy) {
    strategyName = singleStrategy.name
    strategyType = singleStrategy.type
    entryParams = JSON.parse(JSON.stringify(singleStrategy.params || {})) as Record<string, unknown>
    exitCriteria = {
      t1Pct: singleStrategy.exits?.t1Pct ?? null,
      t2Pct: singleStrategy.exits?.t2Pct ?? null,
      squareOffEOD: singleStrategy.type === 'momentum' ? (asMomentumParams(singleStrategy).squareOffEOD ?? false) : false,
      exitSameDayOnPositive: singleStrategy.type === 'momentum' ? (asMomentumParams(singleStrategy).exitSameDayOnPositive ?? false) : false,
    }
  } else {
    strategyName = 'Run All Active'
    strategyType = 'all'
    entryParams = {
      strategies: (multiStrategies || []).map(strategy => ({
        id: strategy.id,
        name: strategy.name,
        type: strategy.type,
        params: strategy.params,
        watchlist: strategy.watchlist,
        giftNiftyGate: strategy.giftNiftyGate,
      })),
    }
    exitCriteria = {
      strategies: (multiStrategies || []).map(strategy => ({
        id: strategy.id,
        name: strategy.name,
        type: strategy.type,
        t1Pct: strategy.exits?.t1Pct ?? null,
        t2Pct: strategy.exits?.t2Pct ?? null,
        squareOffEOD: strategy.type === 'momentum' ? (asMomentumParams(strategy).squareOffEOD ?? false) : false,
        exitSameDayOnPositive: strategy.type === 'momentum' ? (asMomentumParams(strategy).exitSameDayOnPositive ?? false) : false,
      })),
    }
  }

  return {
    runId: buildRunId(),
    timestamp: new Date().toISOString(),
    strategyName,
    strategyType,
    entryParams,
    exitCriteria,
    startingAmount,
    maxBuysPerDay: capital.maxBuysPerDay,
    maxSellsPerDay: capital.maxSellsPerDay,
    backtestDays: summary.days,
    closedTrades: summary.tradesClosed,
    openTrades: summary.tradesOpen,
    avgHoldDays: summary.avgHoldDays,
    avgDrawdownPct,
    netProfitRupees,
    netProfitPct: round2(summary.netTotalReturnPct ?? summary.totalReturnPct),
    realizedProfitRupees,
    realizedProfitPct,
    unrealizedMTM: round2(summary.unrealizedPnl),
    winRate: summary.winRate,
    capitalEfficiency: avgDeployedCapital > 0 ? round2((realizedProfitRupees / avgDeployedCapital) * 100) : 0,
    avgDeployedCapital,
    tradePnls,
    strategySnapshot: singleStrategy,
    strategySnapshots: multiStrategies,
  }
}

export async function loadBacktestHistory(): Promise<BacktestHistoryEntry[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('backtest_runs')
    .select('*')
    .eq('customer_id', getCustomerId())
    .order('run_at', { ascending: false })
  if (error) throw new Error(`[backtestHistory] read failed: ${error.message}`)
  return (data || []).map(rowToEntry)
}

export async function appendBacktestHistory(entry: BacktestHistoryEntry): Promise<BacktestHistoryEntry[]> {
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('backtest_runs').insert(entryToRow(getCustomerId(), entry))
  if (error) throw new Error(`[backtestHistory] insert failed: ${error.message}`)
  return loadBacktestHistory()
}

export async function resetBacktestHistory(): Promise<void> {
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('backtest_runs').delete().eq('customer_id', getCustomerId())
  if (error) throw new Error(`[backtestHistory] reset failed: ${error.message}`)
}

export async function analyseBacktestHistory(runs: BacktestHistoryEntry[]): Promise<string> {
  if (runs.length < 3) throw new Error('Run at least 3 backtests with different parameters before analysing for meaningful insights.')

  const payloadRuns = runs.map(run => ({
    timestampLabel: new Date(run.timestamp).toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
    strategyName: run.strategyName,
    strategyType: run.strategyType,
    entryParams: run.entryParams,
    exitCriteria: run.exitCriteria,
    startingAmount: run.startingAmount,
    maxBuysPerDay: run.maxBuysPerDay,
    maxSellsPerDay: run.maxSellsPerDay,
    backtestDays: run.backtestDays,
    closedTrades: run.closedTrades,
    openTrades: run.openTrades,
    avgHoldDays: run.avgHoldDays,
    avgDrawdownPct: run.avgDrawdownPct,
    totalMtmRupees: run.netProfitRupees,
    totalMtmPct: run.netProfitPct,
    realizedProfitRupees: run.realizedProfitRupees,
    realizedProfitPct: run.realizedProfitPct,
    unrealizedMTM: run.unrealizedMTM,
    winRate: run.winRate,
    realizedCapitalEfficiency: run.capitalEfficiency,
    avgDeployedCapital: run.avgDeployedCapital,
    tradePnls: run.tradePnls,
  }))

  const ai = await callAI({
    prompt: `${BACKTEST_ANALYSIS_SYSTEM_PROMPT}\n\nAnalyse these stored backtest runs. The data is JSON. Remember: realized profit decides what is working; open MTM does not.\n\n${JSON.stringify(payloadRuns, null, 2)}`,
    maxTokens: 3000,
  })
  if (!ai.ok) {
    throw new Error(`Backtest analysis failed (${ai.provider}${ai.status ? ` HTTP ${ai.status}` : ''}): ${(ai.error || '').slice(0, 300)}`)
  }
  const text = ai.text
  if (!text.trim()) throw new Error('Configured AI provider returned an empty response')
  return text.trim()
}

export async function analyseSingleBacktestResult(result: StrategyBacktestResult): Promise<string> {
  const summary = result.summary
  const closedTrades = result.trades.filter(trade => trade.status === 'closed')
  const payload = {
    strategyName: summary.strategyName,
    strategyId: summary.strategyId,
    backtestDays: summary.days,
    tradingDays: summary.tradingDays,
    dipDays: summary.dipDays,
    momentumDays: summary.momentumDays,
    startingCapital: summary.startingCapital,
    endingCapital: summary.endingCapital,
    netEndingCapital: summary.netEndingCapital ?? summary.endingCapital,
    grossTotalPnl: summary.totalPnl,
    netTotalPnl: summary.netTotalPnl ?? summary.totalPnl,
    grossRealizedPnl: summary.realizedPnl,
    netRealizedPnl: summary.netRealizedPnl ?? summary.realizedPnl,
    grossUnrealizedPnl: summary.unrealizedPnl,
    netUnrealizedPnl: summary.netUnrealizedPnl ?? summary.unrealizedPnl,
    grossReturnPct: summary.totalReturnPct,
    netReturnPct: summary.netTotalReturnPct ?? summary.totalReturnPct,
    maxDrawdownPct: summary.maxDrawdownPct,
    tradesClosed: summary.tradesClosed,
    tradesOpen: summary.tradesOpen,
    wins: summary.wins,
    losses: summary.losses,
    winRate: summary.winRate,
    avgHoldDays: summary.avgHoldDays,
    estimatedCharges: summary.totalCharges ?? 0,
    totalSkippedOrders: summary.totalSkippedOrders,
    skippedNoToken: summary.skippedNoToken,
    skippedNoHistorical: summary.skippedNoHistorical,
    skippedCapitalLimited: summary.skippedCapitalLimited,
    skippedPositionLimited: summary.skippedPositionLimited,
    gateBreakdown: result.summary.gateBreakdown,
    topSkippedOrders: result.skippedOrders.slice(0, 40),
    closedTradePnls: closedTrades.map(trade => round2(trade.netRealizedPnl ?? trade.realizedPnl)).sort((a, b) => b - a).slice(0, 50),
    openTrades: result.trades
      .filter(trade => trade.status === 'open')
      .slice(0, 20)
      .map(trade => ({
        symbol: trade.symbol,
        strategyName: trade.strategyName,
        entryDate: trade.entryDate,
        entryPrice: trade.entryPrice,
        remainingQty: trade.remainingQty,
        markPrice: trade.markPrice,
        unrealizedPnl: trade.netUnrealizedPnl ?? trade.unrealizedPnl,
      })),
    avgMarketValue: round2(average(result.equityCurve.map(point => point.marketValue || 0))),
    avgCash: round2(average(result.equityCurve.map(point => point.cash || 0))),
    peakOpenTrades: result.equityCurve.reduce((max, point) => Math.max(max, point.openTrades), 0),
  }

  const ai = await callAI({
    prompt: `${SINGLE_BACKTEST_ANALYSIS_SYSTEM_PROMPT}\n\nAnalyse this single backtest run. Prioritise net realized outcomes. Use skipped orders and gate breakdown to explain what blocked capital deployment or trade count, and suggest parameter changes that could improve outcomes.\n\n${JSON.stringify(payload, null, 2)}`,
    maxTokens: 2500,
  })
  if (!ai.ok) {
    throw new Error(`Backtest recommendation failed (${ai.provider}${ai.status ? ` HTTP ${ai.status}` : ''}): ${(ai.error || '').slice(0, 300)}`)
  }
  const text = ai.text
  if (!text.trim()) throw new Error('Configured AI provider returned an empty response')
  return text.trim()
}
