// GET /api/dalgo/customer/engine/orders
// Returns today's Kite orders for the logged-in customer's broker account.

import { NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { loadBrokerAccountCreds, getOrders } from '@/lib/kite'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const targetParam = new URL(req.url).searchParams.get('targetCustomerId')
    const isPrivileged = profile.role === 'superadmin' || profile.role === 'account_manager'
    const customerId = isPrivileged && targetParam ? targetParam : profile.id
    const creds = await loadBrokerAccountCreds(customerId)
    if (!creds) {
      return NextResponse.json({ orders: [], error: 'Kite not connected' })
    }

    const orders = await getOrders(creds).catch(() => [])
    return NextResponse.json({ orders })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[engine/orders] error:', err)
    return NextResponse.json({ orders: [], error: 'Failed to fetch orders' })
  }
}
