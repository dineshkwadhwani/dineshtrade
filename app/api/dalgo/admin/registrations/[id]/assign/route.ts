import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { sendRegistrationAssigned } from '@/lib/email'

// Reads the session cookie via requireRole()/getSession() (lib/dalgoAuth.ts,
// next/headers cookies()) on every request — force-dynamic makes that
// explicit instead of relying on Next's implicit dynamic-usage detection,
// which only fires (and only gets a chance to fall back gracefully) for
// static-path GET routes probed during the build's static-generation pass;
// this route is either a non-GET method or otherwise not guaranteed to hit
// that same path, so making it explicit removes the ambiguity outright.
export const dynamic = 'force-dynamic'

// POST /api/dalgo/admin/registrations/[id]/assign — Task 6.3.
// SuperAdmin only — assigning registrations to Account Managers is not an AM
// self-service action (spec §3.1/§3.5: only SuperAdmin assigns/reassigns).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => ({}))
    const assignedTo = typeof body.assignedTo === 'string' ? body.assignedTo : ''
    if (!assignedTo) {
      return NextResponse.json({ error: 'assignedTo is required.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const { data: registration, error: regError } = await admin
      .from('registrations')
      .select('id, full_name, profile_id, assigned_to')
      .eq('id', params.id)
      .maybeSingle()
    if (regError || !registration) {
      return NextResponse.json({ error: 'Registration not found.' }, { status: 404 })
    }

    const { data: am, error: amError } = await admin
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', assignedTo)
      .maybeSingle()
    if (amError || !am || am.role !== 'account_manager') {
      return NextResponse.json({ error: 'Target account manager not found.' }, { status: 400 })
    }

    const { data: customerProfile } = await admin
      .from('profiles')
      .select('email')
      .eq('id', registration.profile_id)
      .maybeSingle()

    const before = { assigned_to: registration.assigned_to }
    const now = new Date().toISOString()
    const { error: updateError } = await admin
      .from('registrations')
      .update({ assigned_to: assignedTo, updated_at: now })
      .eq('id', params.id)
    if (updateError) {
      return NextResponse.json({ error: 'Failed to assign registration.' }, { status: 500 })
    }

    // Keep profile in sync so AM's "My Customers" list works
    await admin
      .from('profiles')
      .update({ assigned_account_manager_id: assignedTo, updated_at: now })
      .eq('id', registration.profile_id)

    await writeAuditLog({
      actor,
      action: 'registration.assign',
      targetType: 'registration',
      targetId: params.id,
      targetName: registration.full_name,
      before,
      after: { assigned_to: assignedTo },
    })

    sendRegistrationAssigned(am.email, registration.full_name, customerProfile?.email ?? '').catch(err =>
      console.error('[registrations/assign] sendRegistrationAssigned failed:', err)
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[registrations/assign] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
