import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import type { StrategyBacktestResult } from './backtest'
import { callAI } from './ai'
import { getCapital, type Strategy, type StrategyType } from './strategyConfig'

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

interface DiskShape {
  schema: number
  updatedAt: string
  runs: BacktestHistoryEntry[]
}

const SCHEMA_VERSION = 1
export const BACKTEST_ANALYSIS_SYSTEM_PROMPT = 'You are a trading strategy analyst. Analyse these backtest results and provide: 1) Overall winner — the single best run by risk-adjusted return (net profit % divided by drawdown %). Show the calculation. 2) Quality Score ranking — rank all runs by net profit % divided by drawdown %, highest to lowest. 3) Parameter sensitivity — for each parameter that varied across runs, show how changing it affected profit and drawdown. Identify which parameters had the most impact. 4) Sweet spot detection — for numeric parameters that have 3 or more different values across runs, identify the optimal value and flag where diminishing returns begin. 5) Consistency check — flag any run where top 3 trades contributed more than 30% of total profit (concentrated = unreliable). 6) Capital efficiency ranking — net profit divided by average deployed capital. 7) Final recommendation — one specific parameter set that balances profit, drawdown, consistency and capital efficiency. Show exactly which values to use and why. Format your response with clear section headers and keep each section concise — maximum 3 sentences per insight.'

function historyPath(): string {
  const stateFilePath = process.env.STATE_FILE_PATH || ''
  if (stateFilePath) return path.join(path.dirname(stateFilePath), 'backtest-history.json')
  return path.join(os.homedir(), 'dineshtrade', 'data', 'backtest-history.json')
}

function emptyDisk(): DiskShape {
  return { schema: SCHEMA_VERSION, updatedAt: '', runs: [] }
}

async function loadDisk(): Promise<DiskShape> {
  try {
    const raw = await fs.readFile(historyPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.runs)) {
      return {
        schema: typeof parsed.schema === 'number' ? parsed.schema : SCHEMA_VERSION,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
        runs: parsed.runs as BacktestHistoryEntry[],
      }
    }
  } catch {
    return emptyDisk()
  }
  return emptyDisk()
}

async function saveDisk(disk: DiskShape): Promise<void> {
  const filePath = historyPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const payload: DiskShape = {
    schema: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    runs: disk.runs,
  }
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, filePath)
}

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
      squareOffEOD: typeof (singleStrategy.params as any)?.squareOffEOD === 'boolean' ? (singleStrategy.params as any).squareOffEOD : false,
      exitSameDayOnPositive: typeof (singleStrategy.params as any)?.exitSameDayOnPositive === 'boolean' ? (singleStrategy.params as any).exitSameDayOnPositive : false,
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
        squareOffEOD: typeof (strategy.params as any)?.squareOffEOD === 'boolean' ? (strategy.params as any).squareOffEOD : false,
        exitSameDayOnPositive: typeof (strategy.params as any)?.exitSameDayOnPositive === 'boolean' ? (strategy.params as any).exitSameDayOnPositive : false,
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
    capitalEfficiency: avgDeployedCapital > 0 ? round2((netProfitRupees / avgDeployedCapital) * 100) : 0,
    avgDeployedCapital,
    tradePnls,
    strategySnapshot: singleStrategy,
    strategySnapshots: multiStrategies,
  }
}

export async function loadBacktestHistory(): Promise<BacktestHistoryEntry[]> {
  const disk = await loadDisk()
  return [...disk.runs].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export async function appendBacktestHistory(entry: BacktestHistoryEntry): Promise<BacktestHistoryEntry[]> {
  const disk = await loadDisk()
  disk.runs.push(entry)
  await saveDisk(disk)
  return loadBacktestHistory()
}

export async function resetBacktestHistory(): Promise<void> {
  await saveDisk(emptyDisk())
}

export async function analyseBacktestHistory(runs: BacktestHistoryEntry[]): Promise<string> {
  if (runs.length < 3) throw new Error('Run at least 3 backtests with different parameters before analysing for meaningful insights.')

  const payloadRuns = runs.map(run => ({
    runId: run.runId,
    timestamp: run.timestamp,
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
    netProfitRupees: run.netProfitRupees,
    netProfitPct: run.netProfitPct,
    realizedProfitRupees: run.realizedProfitRupees,
    realizedProfitPct: run.realizedProfitPct,
    unrealizedMTM: run.unrealizedMTM,
    winRate: run.winRate,
    capitalEfficiency: run.capitalEfficiency,
    avgDeployedCapital: run.avgDeployedCapital,
    tradePnls: run.tradePnls,
  }))

  const ai = await callAI({
    prompt: `${BACKTEST_ANALYSIS_SYSTEM_PROMPT}\n\nAnalyse these stored backtest runs. Data is JSON.\n\n${JSON.stringify(payloadRuns, null, 2)}`,
    maxTokens: 3000,
  })
  if (!ai.ok) {
    throw new Error(`Backtest analysis failed (${ai.provider}${ai.status ? ` HTTP ${ai.status}` : ''}): ${(ai.error || '').slice(0, 300)}`)
  }
  const text = ai.text
  if (!text.trim()) throw new Error('Configured AI provider returned an empty response')
  return text.trim()
}
