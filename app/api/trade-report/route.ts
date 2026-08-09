import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { buildLiveTradeReport } from '@/lib/tradeReport'

// Reads the session cookie via cookies() (next/headers) on every request —
// force-dynamic makes that explicit instead of relying on Next's implicit
// dynamic-usage detection, which reportedly failed the production build on
// EC2 for a sibling route (app/api/dalgo/admin/reports/export) with the same
// underlying pattern.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({})) as { fromDate?: string; toDate?: string; account?: string; strategyId?: string; symbol?: string }
    const fromDate = String(body.fromDate || '')
    const toDate = String(body.toDate || '')
    const account = typeof body.account === 'string' ? body.account : ''
    const strategyId = typeof body.strategyId === 'string' ? body.strategyId : ''
    const symbol = typeof body.symbol === 'string' ? body.symbol : ''
    const result = await buildLiveTradeReport({ fromDate, toDate, account, strategyId, symbol })
    return NextResponse.json({ result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Trade report failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}