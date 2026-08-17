import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin, withCustomer } from '@/lib/supabase'
import { buildLiveTradeReport } from '@/lib/tradeReport'
import { rehydrateForCustomer } from '@/lib/strategyConfigStore'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const fromDate = String(body.fromDate || '')
  const toDate = String(body.toDate || '')
  const account = typeof body.account === 'string' ? body.account : ''
  const strategyId = typeof body.strategyId === 'string' ? body.strategyId : ''
  const symbol = typeof body.symbol === 'string' ? body.symbol : ''

  // Determine which customer's data to load
  let targetCustomerId: string

  if (profile.role === 'customer') {
    targetCustomerId = profile.id
  } else {
    // Admin roles must specify a customerId
    const requestedId = typeof body.customerId === 'string' ? body.customerId.trim() : ''
    if (!requestedId) return NextResponse.json({ error: 'customerId is required for admin roles' }, { status: 400 })

    // Verify the requesting user actually has access to this customer
    const admin = getSupabaseAdmin()
    const { data: customer } = await admin
      .from('profiles')
      .select('id, assigned_account_manager_id, broking_company_id')
      .eq('id', requestedId)
      .eq('role', 'customer')
      .maybeSingle()

    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    if (profile.role === 'account_manager' && customer.assigned_account_manager_id !== profile.id) {
      return NextResponse.json({ error: 'Access denied to this customer' }, { status: 403 })
    }
    if (profile.role === 'broking_company' && customer.broking_company_id !== profile.id) {
      return NextResponse.json({ error: 'Access denied to this customer' }, { status: 403 })
    }
    // superadmin: no restriction

    targetCustomerId = requestedId
  }

  try {
    const result = await withCustomer(targetCustomerId, async () => {
      await rehydrateForCustomer()
      return buildLiveTradeReport({ fromDate, toDate, account, strategyId, symbol })
    })
    return NextResponse.json({ result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Trade report failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
