import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// PATCH /api/dalgo/customer/strategy/[id] — update strategy params/exits/settings.
// Only allowed when cron mode is manual.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })
    if (profile.status !== 'active') return NextResponse.json({ error: 'Account not active.' }, { status: 403 })

    const admin = getSupabaseAdmin()

    const body = await req.json().catch(() => ({}))
    // Admins can act on behalf of a customer by passing targetCustomerId
    const customerId = (['superadmin', 'account_manager'] as string[]).includes(profile.role) && body.targetCustomerId
      ? body.targetCustomerId as string
      : profile.id

    // Guard: only allow edits in manual mode
    const { data: state } = await admin.from('customer_state').select('cron_mode').eq('customer_id', customerId).maybeSingle()
    if (state?.cron_mode === 'auto') {
      return NextResponse.json({ error: 'Switch to Manual mode before editing strategies.' }, { status: 403 })
    }
    const allowedKeys = ['active', 'scan_interval_min', 'color', 'params', 'exits', 'gift_nifty_gate']
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const key of allowedKeys) {
      if (key in body) update[key] = body[key]
    }
    if (body.active === true) update.enabled_at = new Date().toISOString()

    const { error } = await admin.from('customer_strategies')
      .update(update)
      .eq('id', params.id)
      .eq('customer_id', customerId)
    if (error) return NextResponse.json({ error: 'Failed to update.' }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[customer/strategy/[id]] error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
