import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { sendIdentityApproved } from '@/lib/email'

// POST /api/dalgo/admin/registrations/[id]/approve — Task 6.3, spec §4.5
// Step 1 approval. SuperAdmin can approve any registration; an Account
// Manager can only approve one assigned to them (spec §3.1 access matrix:
// "Approve KYC Step 1 — Account Manager: Assigned").
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole(['superadmin', 'account_manager'])
    const admin = getSupabaseAdmin()

    const { data: registration, error: regError } = await admin
      .from('registrations')
      .select('id, full_name, profile_id, assigned_to, step1_approved_at, rejection_reason')
      .eq('id', params.id)
      .maybeSingle()
    if (regError || !registration) {
      return NextResponse.json({ error: 'Registration not found.' }, { status: 404 })
    }
    if (actor.role === 'account_manager' && registration.assigned_to !== actor.id) {
      return NextResponse.json({ error: 'This registration is not assigned to you.' }, { status: 403 })
    }

    const { data: customerProfile } = await admin
      .from('profiles')
      .select('email, full_name, status')
      .eq('id', registration.profile_id)
      .maybeSingle()
    if (!customerProfile) {
      return NextResponse.json({ error: 'Customer profile not found.' }, { status: 404 })
    }

    const now = new Date().toISOString()
    const before = { step1_approved_at: registration.step1_approved_at, profile_status: customerProfile.status }

    const [{ error: regUpdateError }, { error: profileUpdateError }] = await Promise.all([
      admin
        .from('registrations')
        .update({ step1_approved_at: now, step1_approved_by: actor.id, rejection_reason: null, updated_at: now })
        .eq('id', params.id),
      admin
        .from('profiles')
        .update({ status: 'identity_verified', updated_at: now })
        .eq('id', registration.profile_id),
    ])
    if (regUpdateError || profileUpdateError) {
      return NextResponse.json({ error: 'Failed to approve registration.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'registration.approve_identity',
      targetType: 'registration',
      targetId: params.id,
      targetName: registration.full_name,
      before,
      after: { step1_approved_at: now, step1_approved_by: actor.id, profile_status: 'identity_verified' },
    })

    sendIdentityApproved(customerProfile.email, customerProfile.full_name).catch(err =>
      console.error('[registrations/approve] sendIdentityApproved failed:', err)
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[registrations/approve] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
