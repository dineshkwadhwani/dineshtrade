import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// PATCH /api/dalgo/customer/strategy — toggle active state for a customer strategy.
// Requires the customer to have explicitly agreed to the disclaimer (agreed=true in body).
export async function PATCH(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })
    if (profile.status !== 'active') return NextResponse.json({ error: 'Account not active.' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const strategyId = typeof body.strategyId === 'string' ? body.strategyId : ''
    const active = typeof body.active === 'boolean' ? body.active : undefined
    const agreed = body.agreed === true

    if (!strategyId) return NextResponse.json({ error: 'strategyId is required.' }, { status: 400 })
    if (active === undefined) return NextResponse.json({ error: 'active (boolean) is required.' }, { status: 400 })
    if (active && !agreed) {
      return NextResponse.json({ error: 'DISCLAIMER_REQUIRED' }, { status: 403 })
    }

    const admin = getSupabaseAdmin()
    const { data: strategy, error: fetchErr } = await admin
      .from('customer_strategies')
      .select('id, name')
      .eq('id', strategyId)
      .eq('customer_id', profile.id)
      .maybeSingle()

    if (fetchErr || !strategy) return NextResponse.json({ error: 'Strategy not found.' }, { status: 404 })

    const { error } = await admin
      .from('customer_strategies')
      .update({ active, enabled_at: active ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', strategyId)
      .eq('customer_id', profile.id)

    if (error) return NextResponse.json({ error: 'Failed to update strategy.' }, { status: 500 })

    return NextResponse.json({ ok: true, active })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[customer/strategy] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
