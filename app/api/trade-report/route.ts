import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { buildLiveTradeReport } from '@/lib/tradeReport'

export async function POST(req: Request) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({})) as { fromDate?: string; toDate?: string }
    const fromDate = String(body.fromDate || '')
    const toDate = String(body.toDate || '')
    const result = await buildLiveTradeReport({ fromDate, toDate })
    return NextResponse.json({ result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Trade report failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}