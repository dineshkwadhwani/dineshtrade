import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/dalgo/register/resend-verification
// Public route — resends Supabase email confirmation for a pending user.
export async function POST(req: NextRequest) {
  let email: string
  try {
    const body = await req.json()
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // Only resend if the user exists and is not yet confirmed
  const { data: { users }, error } = await admin.auth.admin.listUsers()
  if (error) {
    return NextResponse.json({ error: 'Failed to look up account.' }, { status: 500 })
  }

  const user = users.find(u => u.email?.toLowerCase() === email)
  if (!user) {
    // Deliberately vague — don't reveal whether the email is registered
    return NextResponse.json({ ok: true })
  }

  if (user.email_confirmed_at) {
    return NextResponse.json({ error: 'This email is already verified. Please log in.' }, { status: 409 })
  }

  const siteUrl = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://dalgo.online').replace(/\/$/, '')

  // generateLink with type 'signup' re-issues the confirmation email
  const { error: resendError } = await admin.auth.admin.generateLink({
    type: 'signup' as const,
    email,
    password: '',
    options: { redirectTo: `${siteUrl}/pending` },
  } as Parameters<typeof admin.auth.admin.generateLink>[0])

  if (resendError) {
    console.error('[resend-verification] generateLink failed:', resendError.message)
    return NextResponse.json({ error: 'Failed to resend verification email. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
