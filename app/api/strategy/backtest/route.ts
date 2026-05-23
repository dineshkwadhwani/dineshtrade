import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { runStrategyBacktest } from '@/lib/backtest'

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
    const result = await runStrategyBacktest({
      days: body.days,
      initialCapital: body.initialCapital,
      strategyId: body.strategyId,
    })
    return NextResponse.json({ result })
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 400 })
  }
}