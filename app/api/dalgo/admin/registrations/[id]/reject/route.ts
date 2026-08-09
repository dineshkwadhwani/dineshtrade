import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { sendIdentityRejected } from '@/lib/email'

// POST /api/dalgo/admin/registrations/[id]/reject — Task 6.3, spec §4.5.
// Requires a rejection reason. Same SuperAdmin/assigned-AM scoping as approve.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole(['superadmin', 'account_manager'])
    const body = await req.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      return NextResponse.json({ error: 'A rejection reason is required.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const { data: registration, error: regError } = await admin
      .from('registrations')
      .select('id, full_name, profile_id, assigned_to, rejection_reason')
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
    const before = { rejection_reason: registration.rejection_reason, profile_status: customerProfile.status }

    const [{ error: regUpdateError }, { error: profileUpdateError }] = await Promise.all([
      admin.from('registrations').update({ rejection_reason: reason, updated_at: now }).eq('id', params.id),
      admin.from('profiles').update({ status: 'rejected', updated_at: now }).eq('id', registration.profile_id),
    ])
    if (regUpdateError || profileUpdateError) {
      return NextResponse.json({ error: 'Failed to reject registration.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'registration.reject_identity',
      targetType: 'registration',
      targetId: params.id,
      targetName: registration.full_name,
      before,
      after: { rejection_reason: reason, profile_status: 'rejected' },
    })

    sendIdentityRejected(customerProfile.email, customerProfile.full_name, reason).catch(err =>
      console.error('[registrations/reject] sendIdentityRejected failed:', err)
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[registrations/reject] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
