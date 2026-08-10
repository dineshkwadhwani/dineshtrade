import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/dalgo/customer/strategy/[id]/reset — restore from platform template
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })

    const admin = getSupabaseAdmin()
    // Admins can act on behalf of a customer via body.targetCustomerId
    const body = await _req.json().catch(() => ({}))
    const customerId = (['superadmin', 'account_manager'] as string[]).includes(profile.role) && body.targetCustomerId
      ? body.targetCustomerId as string
      : profile.id
    const { data: customerStrat } = await admin
      .from('customer_strategies')
      .select('id, platform_strategy_id')
      .eq('id', params.id)
      .eq('customer_id', customerId)
      .maybeSingle()
    if (!customerStrat) return NextResponse.json({ error: 'Strategy not found.' }, { status: 404 })

    const platformId = customerStrat.platform_strategy_id
    if (!platformId) return NextResponse.json({ error: 'No platform template linked.' }, { status: 400 })

    const { data: template } = await admin
      .from('platform_strategies')
      .select('params, exits, gift_nifty_gate, scan_interval_min, color, watchlist_keys')
      .eq('id', platformId)
      .maybeSingle()
    if (!template) return NextResponse.json({ error: 'Platform template not found.' }, { status: 404 })

    const { error } = await admin.from('customer_strategies').update({
      params: template.params,
      exits: template.exits,
      gift_nifty_gate: template.gift_nifty_gate ?? null,
      scan_interval_min: template.scan_interval_min,
      color: template.color,
      watchlist_keys: template.watchlist_keys,
      updated_at: new Date().toISOString(),
    }).eq('id', params.id).eq('customer_id', customerId)

    if (error) return NextResponse.json({ error: 'Reset failed.' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[strategy/reset] error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
