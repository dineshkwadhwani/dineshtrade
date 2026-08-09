import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { sendCustomerReassigned } from '@/lib/email'

// Reads the session cookie via requireRole()/getSession() (lib/dalgoAuth.ts,
// next/headers cookies()) on every request — force-dynamic makes that
// explicit instead of relying on Next's implicit dynamic-usage detection,
// which only fires (and only gets a chance to fall back gracefully) for
// static-path GET routes probed during the build's static-generation pass;
// this route is either a non-GET method or otherwise not guaranteed to hit
// that same path, so making it explicit removes the ambiguity outright.
export const dynamic = 'force-dynamic'

// POST /api/dalgo/admin/customers/[id]/reassign — Task 6.5.
// SuperAdmin only (spec §3.5: "SuperAdmin can move customers between Account
// Managers" — an AM cannot reassign their own customers away).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => ({}))
    const newAmId = typeof body.newAmId === 'string' ? body.newAmId : ''
    if (!newAmId) {
      return NextResponse.json({ error: 'newAmId is required.' }, { status: 400 })
    }

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

    const { data: newAm, error: amError } = await admin
      .from('profiles')
      .select('id, email, role')
      .eq('id', newAmId)
      .maybeSingle()
    if (amError || !newAm || newAm.role !== 'account_manager') {
      return NextResponse.json({ error: 'Target account manager not found.' }, { status: 400 })
    }

    let oldAmEmail: string | undefined
    if (customer.assigned_account_manager_id) {
      const { data: oldAm } = await admin
        .from('profiles')
        .select('email')
        .eq('id', customer.assigned_account_manager_id)
        .maybeSingle()
      oldAmEmail = oldAm?.email
    }

    const before = { assigned_account_manager_id: customer.assigned_account_manager_id }
    const { error: updateError } = await admin
      .from('profiles')
      .update({ assigned_account_manager_id: newAmId, updated_at: new Date().toISOString() })
      .eq('id', params.id)
    if (updateError) {
      return NextResponse.json({ error: 'Failed to reassign customer.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'customer.reassign',
      targetType: 'customer',
      targetId: params.id,
      targetName: customer.full_name,
      before,
      after: { assigned_account_manager_id: newAmId },
    })

    sendCustomerReassigned(newAm.email, customer.full_name, oldAmEmail).catch(err =>
      console.error('[customers/reassign] sendCustomerReassigned failed:', err)
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[customers/reassign] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
