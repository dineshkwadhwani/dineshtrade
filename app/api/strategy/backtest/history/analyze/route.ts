import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { analyseBacktestHistory, loadBacktestHistory } from '@/lib/backtestHistory'

export const dynamic = 'force-dynamic'

async function requireAuth(): Promise<boolean> {
  const session = cookies().get('dt_session')?.value
  if (!session) return false
  return verifySession(session)
}

export async function POST() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const runs = await loadBacktestHistory()
    if (runs.length < 3) {
      return NextResponse.json({ error: 'Run at least 3 backtests with different parameters before analysing for meaningful insights.' }, { status: 400 })
    }
    const analysis = await analyseBacktestHistory(runs)
    return NextResponse.json({ analysis })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backtest analysis failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
