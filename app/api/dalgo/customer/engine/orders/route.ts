// GET /api/dalgo/customer/engine/orders
// Returns today's Kite orders. Falls back to Supabase orders table when broker token is unavailable.

import { NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { loadBrokerAccountCreds, getOrders } from '@/lib/kite'

export const dynamic = 'force-dynamic'

function istDateKey(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function GET(req: Request) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const targetParam = new URL(req.url).searchParams.get('targetCustomerId')
    const isPrivileged = profile.role === 'superadmin' || profile.role === 'account_manager'
    const customerId = isPrivileged && targetParam ? targetParam : profile.id
    const creds = await loadBrokerAccountCreds(customerId)

    if (creds) {
      const orders = await getOrders(creds).catch(() => null)
      if (orders !== null) {
        return NextResponse.json({ orders, source: 'kite' })
      }
    }

    // Fallback: read today's orders from Supabase (DAlgo-placed orders only)
    const admin = getSupabaseAdmin()
    const today = istDateKey()
    const { data: rows } = await admin
      .from('orders')
      .select('symbol, side, qty, price, broker_order_id, tag, status, created_at')
      .eq('customer_id', customerId)
      .eq('trade_date', today)
      .order('created_at', { ascending: true })

    const orders = (rows ?? []).map(r => ({
      order_id: r.broker_order_id ?? `dalgo-${r.symbol}-${r.created_at}`,
      tradingsymbol: r.symbol,
      transaction_type: r.side,
      quantity: r.qty,
      filled_quantity: r.qty,
      average_price: r.price,
      status: r.status ?? 'COMPLETE',
      order_timestamp: r.created_at,
      tag: r.tag,
    }))

    return NextResponse.json({ orders, source: 'supabase', offline: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[engine/orders] error:', err)
    return NextResponse.json({ orders: [], error: 'Failed to fetch orders' })
  }
}
