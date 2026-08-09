// app/api/dalgo/register/route.ts
//
// POST /api/dalgo/register — customer / broking-company self-registration
// (Phase 3 — Registration and Onboarding, spec §4.1/§4.2).
//
// Public route (no auth) — added to middleware.ts PUBLIC_EXACT in Task 3.9.
// Does NOT send our own "application submitted" notification email — that's
// wired in Task 3.8. Supabase's own confirmation/OTP email is triggered by
// the signUp() call below.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createEphemeralAnonClient } from '@/lib/dalgoAuth'
import { sendRegistrationConfirmation } from '@/lib/email'

type RegistrationType = 'customer' | 'broking_company'

interface RegisterBody {
  type: RegistrationType
  email: string
  password: string
  fullName: string
  dob: string
  address: string
  city: string
  state: string
  pincode: string
  mobile: string
  aadharNumber: string
  aadharFrontPath: string
  aadharBackPath: string
  // broking_company only
  companyName?: string
  gstNumber?: string
  companyRegistrationNumber?: string
  companyAddress?: string
  companyCity?: string
  companyState?: string
  companyPincode?: string
  companyEmail?: string
  companyMobile?: string
}

const CUSTOMER_REQUIRED: Array<keyof RegisterBody> = [
  'email', 'password', 'fullName', 'dob', 'address', 'city', 'state', 'pincode',
  'mobile', 'aadharNumber', 'aadharFrontPath', 'aadharBackPath',
]

const BROKING_COMPANY_REQUIRED: Array<keyof RegisterBody> = [
  ...CUSTOMER_REQUIRED,
  'companyName', 'gstNumber', 'companyRegistrationNumber', 'companyAddress',
  'companyCity', 'companyState', 'companyPincode', 'companyEmail', 'companyMobile',
]

function validate(body: Partial<RegisterBody>): Record<string, string> {
  const fields: Record<string, string> = {}

  if (body.type !== 'customer' && body.type !== 'broking_company') {
    fields.type = "must be 'customer' or 'broking_company'"
    return fields   // no point checking the rest without a valid type
  }

  const required = body.type === 'broking_company' ? BROKING_COMPANY_REQUIRED : CUSTOMER_REQUIRED
  for (const key of required) {
    const value = body[key]
    if (typeof value !== 'string' || value.trim() === '') {
      fields[key] = 'required'
    }
  }

  // Format checks from spec §4.1, beyond plain presence.
  if (typeof body.password === 'string' && body.password.length > 0 && body.password.length < 8) {
    fields.password = 'must be at least 8 characters'
  }
  if (typeof body.pincode === 'string' && body.pincode.length > 0 && !/^\d{6}$/.test(body.pincode)) {
    fields.pincode = 'must be 6 digits'
  }
  if (typeof body.aadharNumber === 'string' && body.aadharNumber.length > 0 && !/^\d{12}$/.test(body.aadharNumber)) {
    fields.aadharNumber = 'must be 12 digits'
  }
  if (body.type === 'broking_company' && typeof body.companyPincode === 'string' && body.companyPincode.length > 0 && !/^\d{6}$/.test(body.companyPincode)) {
    fields.companyPincode = 'must be 6 digits'
  }

  return fields
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Partial<RegisterBody> | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const fieldErrors = validate(body)
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ error: 'Validation failed', fields: fieldErrors }, { status: 400 })
  }

  const {
    type, email, password, fullName, dob, address, city, state, pincode, mobile,
    aadharNumber, aadharFrontPath, aadharBackPath,
    companyName, gstNumber, companyRegistrationNumber, companyAddress,
    companyCity, companyState, companyPincode, companyEmail, companyMobile,
  } = body as RegisterBody

  const admin = getSupabaseAdmin()

  // ---- Step 1: create the Supabase Auth user -------------------------------
  // signUp() (not admin.createUser()) so Supabase's built-in confirmation/OTP
  // email actually gets sent — see Task 3.3 discussion. Fresh ephemeral anon
  // client per the comment on createEphemeralAnonClient().
  const anon = createEphemeralAnonClient()
  const { data: signUpData, error: signUpError } = await anon.auth.signUp({ email, password })

  if (signUpError) {
    if (/registered|already exists/i.test(signUpError.message)) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
    }
    console.error('[register] signUp failed:', signUpError.message)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }

  const user = signUpData.user
  if (!user) {
    console.error('[register] signUp returned no user with no error')
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }

  // Supabase's anti-enumeration behaviour: signing up with an email that
  // already exists but hasn't been confirmed yet returns a fake "success"
  // (no error) carrying the EXISTING user's id, with an empty `identities`
  // array as the only tell. Treat that as a duplicate too.
  const isNewAuthUser = (user.identities?.length ?? 0) > 0
  if (!isNewAuthUser) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  // ---- Step 2: insert profiles row -----------------------------------------
  const { error: profileError } = await admin.from('profiles').insert({
    id: user.id,
    role: type,
    full_name: fullName,
    email,
    mobile,
    status: 'pending',
  })

  if (profileError) {
    // unique_violation — defensive fallback in case the identities check
    // above ever misses a genuine duplicate (e.g. a prior partial
    // registration already created this profile row for this auth user).
    if (profileError.code === '23505') {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
    }
    console.error('[register] profiles insert failed:', profileError.message)
    await admin.auth.admin.deleteUser(user.id).catch(err =>
      console.error('[register] cleanup deleteUser failed after profiles insert error:', err)
    )
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }

  // ---- Step 3: insert registrations row ------------------------------------
  const { error: registrationError } = await admin.from('registrations').insert({
    profile_id: user.id,
    registration_type: type,
    full_name: fullName,
    dob,
    address,
    city,
    state,
    pincode,
    mobile,
    aadhar_number: aadharNumber,
    aadhar_front_url: aadharFrontPath,
    aadhar_back_url: aadharBackPath,
    ...(type === 'broking_company' ? {
      company_name: companyName,
      gst_number: gstNumber,
      company_registration_number: companyRegistrationNumber,
      company_address: companyAddress,
      company_city: companyCity,
      company_state: companyState,
      company_pincode: companyPincode,
      company_email: companyEmail,
      company_mobile: companyMobile,
    } : {}),
  })

  if (registrationError) {
    console.error('[register] registrations insert failed:', registrationError.message)
    // Best-effort rollback so a half-registered account doesn't permanently
    // block this email from ever retrying.
    const { error: cleanupError } = await admin.from('profiles').delete().eq('id', user.id)
    if (cleanupError) {
      console.error('[register] cleanup profiles delete failed:', cleanupError.message)
    }
    await admin.auth.admin.deleteUser(user.id).catch(err =>
      console.error('[register] cleanup deleteUser failed after registrations insert error:', err)
    )
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }

  // Fire-and-forget — never await, never let an email failure affect the
  // 201 response. sendRegistrationConfirmation() itself already never
  // throws (see lib/email.ts deliver()), but .catch() here is a second,
  // cheap line of defense against a truly unexpected rejection.
  sendRegistrationConfirmation(email, fullName).catch(err =>
    console.error('[register] sendRegistrationConfirmation failed:', err)
  )

  return NextResponse.json(
    { message: 'Registration submitted. Check your email to verify.' },
    { status: 201 },
  )
}
