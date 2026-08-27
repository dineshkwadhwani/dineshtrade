import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALLOWED_CAPITAL_FIELDS = ['per_trade','max_buys_per_day','max_sells_per_day','max_positions','max_buys_per_symbol','min_drop_between_buys_pct','max_deploy_pct','delivery_dp_charge','circuit_breaker_pct','intraday_circuit_trip_pct','intraday_circuit_resume_pct','panic_drop_pct','panic_window_min','send_skipped_emails','skipped_email_to']

export async function PATCH(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })
    if (profile.status !== 'active') return NextResponse.json({ error: 'Account not active.' }, { status: 403 })

    const admin = getSupabaseAdmin()
    const { data: state } = await admin.from('customer_state').select('cron_mode').eq('customer_id', profile.id).maybeSingle()
    if (state?.cron_mode === 'auto') return NextResponse.json({ error: 'Switch to Manual mode before editing capital config.' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    // Admins can act on behalf of a customer via body.targetCustomerId
    const customerId = (['superadmin', 'account_manager'] as string[]).includes(profile.role) && body.targetCustomerId
      ? body.targetCustomerId as string
      : profile.id
    const update: Record<string, unknown> = { customer_id: customerId, updated_at: new Date().toISOString() }
    for (const key of ALLOWED_CAPITAL_FIELDS) {
      if (!(key in body)) continue
      // numeric fields remain numeric; boolean/text left as-is
      if (['per_trade','max_buys_per_day','max_sells_per_day','max_positions','max_buys_per_symbol','min_drop_between_buys_pct','max_deploy_pct','delivery_dp_charge','circuit_breaker_pct','intraday_circuit_trip_pct','intraday_circuit_resume_pct','panic_drop_pct','panic_window_min'].includes(key)) {
        update[key] = Number(body[key])
      } else if (key === 'send_skipped_emails') {
        // accept boolean or string — store as-is so reads can interpret either
        update[key] = body[key]
      } else if (key === 'skipped_email_to') {
        update[key] = String(body[key] ?? '')
      } else {
        update[key] = body[key]
      }
    }

    const { error } = await admin.from('customer_capital_config').upsert(update, { onConflict: 'customer_id' })
    if (error) return NextResponse.json({ error: 'Failed to save.' }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[customer/capital] error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
