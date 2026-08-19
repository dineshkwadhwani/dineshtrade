import { NextResponse } from 'next/server'
import { getProfile, generateSSOToken, SESSION_COOKIE } from '@/lib/dalgoAuth'

export const dynamic = 'force-dynamic'

// GET /api/dalgo/auth/sso-redirect
// Called by LoginClient when an already-authenticated active customer visits the
// login page. Generates a fresh SSO token and returns the subdomain redirect URL,
// or returns /dashboard if there is no subdomain configured.
export async function GET() {
  const profile = await getProfile()
  if (!profile) return NextResponse.redirect('/login')

  if (
    profile.role === 'customer' &&
    profile.status === 'active' &&
    profile.subdomain &&
    process.env.NODE_ENV === 'production'
  ) {
    const token = await generateSSOToken(profile.id)
    const res = NextResponse.redirect(`https://${profile.subdomain}.dalgo.online/sso?token=${token}`)
    // Expire the dalgo.online session so it can't auto-login on the next /login visit.
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', expires: new Date(0), path: '/' })
    return res
  }

  // Fallback for dev, superadmin, account manager, or customers without subdomain
  const fallback =
    profile.role === 'superadmin' ? '/admin' :
    profile.role === 'account_manager' || profile.role === 'broking_company' ? '/manager' :
    '/dashboard'
  return NextResponse.redirect(fallback)
}
