import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { runStrategyBacktest } from '@/lib/backtest'
import { buildBacktestHistoryEntry, appendBacktestHistory } from '@/lib/backtestHistory'
import { getActiveStrategies, getStrategyById, type Strategy } from '@/lib/strategyConfig'

export const dynamic = 'force-dynamic'

async function requireAuth(): Promise<boolean> {
  const session = cookies().get('dt_session')?.value
  if (!session) return false
  return verifySession(session)
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  try {
    const runAllActive = body.runAllActive === true
    const strategyId = typeof body.strategyId === 'string' ? body.strategyId : undefined
    const strategySnapshot = body.strategySnapshot && typeof body.strategySnapshot === 'object'
      ? body.strategySnapshot as Strategy
      : undefined
    const strategySnapshots = Array.isArray(body.strategySnapshots)
      ? body.strategySnapshots as Strategy[]
      : undefined
    const result = await runStrategyBacktest({
      days: body.days,
      initialCapital: body.initialCapital,
      strategyId,
      runAllActive,
      strategySnapshot,
      strategySnapshots,
    })

    const historyEntry = buildBacktestHistoryEntry({
      result,
      strategySnapshot: runAllActive ? null : (strategySnapshot || (strategyId ? getStrategyById(strategyId) : null)),
      strategySnapshots: runAllActive ? (strategySnapshots || getActiveStrategies()) : undefined,
    })
    await appendBacktestHistory(historyEntry)

    return NextResponse.json({ result, historyEntry })
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 400 })
  }
}