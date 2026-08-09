import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

// Reads the session cookie via requireRole()/getSession() (lib/dalgoAuth.ts,
// next/headers cookies()) on every request — force-dynamic makes that
// explicit instead of relying on Next's implicit dynamic-usage detection,
// which only fires (and only gets a chance to fall back gracefully) for
// static-path GET routes probed during the build's static-generation pass;
// this route is either a non-GET method or otherwise not guaranteed to hit
// that same path, so making it explicit removes the ambiguity outright.
export const dynamic = 'force-dynamic'

// PUT /api/dalgo/admin/customers/[id]/capital — Task 6.5.
// SuperAdmin or the assigned Account Manager, and only while the customer's
// cron is in Manual mode (spec §3.3 "Strategy Edit Lock Rule" — nobody may
// edit Shared Capital while a customer's cron is Auto, not even SuperAdmin).
const NUMERIC_FIELDS = [
  'per_trade',
  'max_buys_per_day',
  'max_sells_per_day',
  'max_positions',
  'max_buys_per_symbol',
  'min_drop_between_buys_pct',
  'max_deploy_pct',
  'delivery_dp_charge',
  'circuit_breaker_pct',
  'intraday_circuit_trip_pct',
  'intraday_circuit_resume_pct',
  'panic_drop_pct',
  'panic_window_min',
] as const

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole(['superadmin', 'account_manager'])
    const admin = getSupabaseAdmin()

    const { data: customer, error: customerError } = await admin
      .from('profiles')
      .select('id, full_name, role, assigned_account_manager_id')
      .eq('id', params.id)
      .eq('role', 'customer')
      .maybeSingle()
    if (customerError || !customer) {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })
    }
    if (actor.role === 'account_manager' && customer.assigned_account_manager_id !== actor.id) {
      return NextResponse.json({ error: 'This customer is not assigned to you.' }, { status: 403 })
    }

    const { data: instance } = await admin
      .from('customer_instances')
      .select('cron_mode')
      .eq('customer_id', params.id)
      .maybeSingle()
    if (instance && instance.cron_mode !== 'manual') {
      return NextResponse.json(
        { error: 'Switch customer to Manual mode to edit capital config.' },
        { status: 403 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const updates: Record<string, number> = {}
    for (const field of NUMERIC_FIELDS) {
      if (body[field] !== undefined) {
        const n = Number(body[field])
        if (!Number.isFinite(n)) {
          return NextResponse.json({ error: `${field} must be a number.` }, { status: 400 })
        }
        updates[field] = n
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
    }

    const { data: before } = await admin
      .from('customer_capital_config')
      .select('*')
      .eq('customer_id', params.id)
      .maybeSingle()

    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await admin
      .from('customer_capital_config')
      .upsert({ customer_id: params.id, ...updates, updated_at: now, updated_by: actor.id }, { onConflict: 'customer_id' })
      .select('*')
      .maybeSingle()
    if (updateError) {
      return NextResponse.json({ error: 'Failed to update capital config.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'customer.capital_update',
      targetType: 'customer_capital_config',
      targetId: params.id,
      targetName: customer.full_name,
      before,
      after: updated,
    })

    return NextResponse.json({ ok: true, capitalConfig: updated })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[customers/capital] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
