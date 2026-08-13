import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { sendIdentityApproved } from '@/lib/email'

// Reads the session cookie via requireRole()/getSession() (lib/dalgoAuth.ts,
// next/headers cookies()) on every request — force-dynamic makes that
// explicit instead of relying on Next's implicit dynamic-usage detection,
// which only fires (and only gets a chance to fall back gracefully) for
// static-path GET routes probed during the build's static-generation pass;
// this route is either a non-GET method or otherwise not guaranteed to hit
// that same path, so making it explicit removes the ambiguity outright.
export const dynamic = 'force-dynamic'

// POST /api/dalgo/admin/registrations/[id]/approve — Task 6.3, spec §4.5
// Step 1 approval. SuperAdmin can approve any registration; an Account
// Manager can only approve one assigned to them (spec §3.1 access matrix:
// "Approve KYC Step 1 — Account Manager: Assigned").
// Body: { subdomain: string } — AM-assigned subdomain stored on profiles.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let subdomain: string
  try {
    const body = await req.json().catch(() => ({}))
    subdomain = typeof body.subdomain === 'string' ? body.subdomain.trim().toLowerCase() : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!subdomain || !/^[a-z0-9-]{2,30}$/.test(subdomain)) {
    return NextResponse.json(
      { error: 'Subdomain is required and must be 2–30 lowercase letters, numbers, or hyphens.' },
      { status: 400 }
    )
  }

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

    // Check subdomain uniqueness before updating
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('subdomain', subdomain)
      .neq('id', registration.profile_id)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: `Subdomain "${subdomain}" is already taken.` }, { status: 409 })
    }

    const [{ error: regUpdateError }, { error: profileUpdateError }] = await Promise.all([
      admin
        .from('registrations')
        .update({ step1_approved_at: now, step1_approved_by: actor.id, rejection_reason: null, updated_at: now })
        .eq('id', params.id),
      admin
        .from('profiles')
        .update({ status: 'identity_verified', subdomain, updated_at: now })
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
      after: { step1_approved_at: now, step1_approved_by: actor.id, profile_status: 'identity_verified', subdomain },
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
