// POST /api/orders/cancel — cancels a pending Kite order by order_id.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { resolveAccountCreds, cancelKiteOrder } from '@/lib/kite'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const t = cookies().get('dt_session')?.value
  if (!t || !(await verifySession(t))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const { account, orderId } = (body || {}) as { account?: string; orderId?: string }

  if (!account || !orderId) {
    return NextResponse.json({ error: 'account and orderId are required' }, { status: 400 })
  }

  const creds = await resolveAccountCreds(account)
  if (!creds.ok) {
    return NextResponse.json({ error: creds.error }, { status: 400 })
  }

  const result = await cancelKiteOrder(creds, orderId)
  if (!result.ok) {
    const msg = result.data?.message || result.data?.error_type || `Kite HTTP ${result.status}`
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  return NextResponse.json({ ok: true, orderId })
}
