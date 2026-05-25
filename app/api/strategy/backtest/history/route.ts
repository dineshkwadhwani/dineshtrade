import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { loadBacktestHistory, resetBacktestHistory } from '@/lib/backtestHistory'

export const dynamic = 'force-dynamic'

async function requireAuth(): Promise<boolean> {
  const session = cookies().get('dt_session')?.value
  if (!session) return false
  return verifySession(session)
}

export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runs = await loadBacktestHistory()
  return NextResponse.json({ runs }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await resetBacktestHistory()
  return NextResponse.json({ ok: true })
}
