import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { sendAccountManagerWelcome } from '@/lib/email'

// Reads the session cookie via requireRole()/getSession() (lib/dalgoAuth.ts,
// next/headers cookies()) on every request — force-dynamic makes that
// explicit instead of relying on Next's implicit dynamic-usage detection,
// which only fires (and only gets a chance to fall back gracefully) for
// static-path GET routes probed during the build's static-generation pass;
// this route is either a non-GET method or otherwise not guaranteed to hit
// that same path, so making it explicit removes the ambiguity outright.
export const dynamic = 'force-dynamic'

// POST /api/dalgo/admin/managers — Task 6.6.
// SuperAdmin only (spec §3.1: "Created by: SuperAdmin only. Active
// immediately. No approval needed.").
//
// The temp password is generated fresh per new AM, never hardcoded — a fixed
// literal here would mean every AM this route ever creates (and, worse,
// every AM still sitting on their original login) shares one publicly
// visible-in-source password. Only ever held in memory for this one request,
// long enough to pass to createUser() and the welcome email below.
function generateTempPassword(): string {
  return randomBytes(12).toString('base64').slice(0, 16)
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => ({}))
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!fullName || !email) {
      return NextResponse.json({ error: 'fullName and email are required.' }, { status: 400 })
    }

    const tempPassword = generateTempPassword()
    const admin = getSupabaseAdmin()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    })
    if (createError || !created.user) {
      if (/already.*registered|already exists/i.test(createError?.message ?? '')) {
        return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
      }
      console.error('[managers/create] createUser failed:', createError?.message)
      return NextResponse.json({ error: 'Failed to create account manager.' }, { status: 500 })
    }

    const { error: profileError } = await admin.from('profiles').insert({
      id: created.user.id,
      role: 'account_manager',
      full_name: fullName,
      email,
      status: 'active',
    })
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id).catch(err =>
        console.error('[managers/create] cleanup deleteUser failed:', err)
      )
      console.error('[managers/create] profiles insert failed:', profileError.message)
      return NextResponse.json({ error: 'Failed to create account manager.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'manager.create',
      targetType: 'profile',
      targetId: created.user.id,
      targetName: fullName,
      after: { role: 'account_manager', full_name: fullName, email },
    })

    sendAccountManagerWelcome(email, fullName, tempPassword).catch(err =>
      console.error('[managers/create] sendAccountManagerWelcome failed:', err)
    )

    return NextResponse.json({ ok: true, id: created.user.id }, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[managers/create] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
