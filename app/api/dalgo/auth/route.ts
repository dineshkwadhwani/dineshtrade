import { NextRequest, NextResponse } from 'next/server'
import { login, AuthError, SESSION_COOKIE, generateSSOToken, type ProfileRole } from '@/lib/dalgoAuth'
import { createSession } from '@/lib/auth'

const REDIRECT_BY_ROLE: Record<ProfileRole, string> = {
  superadmin: '/admin',
  account_manager: '/manager',
  broking_company: '/manager',
  customer: '/sso',
}

async function resolveRedirect(role: ProfileRole, status: string, customerId: string, subdomain?: string | null): Promise<string> {
  if (role === 'customer' && status === 'identity_verified') return '/setup'
  if (role === 'customer' && status === 'broker_setup_complete') return '/setup?connected=true'
  if (role === 'customer' && status === 'active') {
    if (subdomain && process.env.NODE_ENV === 'production') {
      // Production: generate SSO token and cross-domain redirect to customer EC2
      const token = await generateSSOToken(customerId)
      return `https://${subdomain}.dalgo.online/sso?token=${token}`
    }
    // Dev or no subdomain: go straight to dashboard on this instance
    return '/dashboard'
  }
  return REDIRECT_BY_ROLE[role]
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  try {
    const result = await login(email, password)
    const redirectTo = await resolveRedirect(result.profile.role, result.profile.status, result.profile.id, result.profile.subdomain)

    // Session expires at midnight IST — same pattern as the existing
    // /api/auth route's dt_session cookie (see app/api/auth/route.ts).
    const now = new Date()
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const midnight = new Date(ist)
    midnight.setDate(midnight.getDate() + 1)
    midnight.setHours(0, 0, 0, 0)

    const res = NextResponse.json({ profile: result.profile, role: result.profile.role, redirectTo })
    // When redirecting to a subdomain SSO, set cookie but mark it to expire immediately
    // after the SSO completes — the subdomain session becomes the real session.
    const isSsoRedirect = redirectTo.includes('.dalgo.online/sso')
    res.cookies.set(SESSION_COOKIE, result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: isSsoRedirect ? new Date(Date.now() + 30_000) : midnight, // 30s TTL for SSO bridge, full day for direct sessions
      path: '/',
    })
    // Also set V1 dt_session for active customers so /dashboard works
    if (result.profile.role === 'customer' && result.profile.status === 'active') {
      const v1Token = await createSession()
      res.cookies.set('dt_session', v1Token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: midnight,
        path: '/',
      })
    }
    return res
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode })
    }
    console.error('[api/dalgo/auth] unexpected error:', err)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
