import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/dalgoAuth'

// Reads the session cookie via requireRole()/getSession() (lib/dalgoAuth.ts,
// next/headers cookies()) on every request — force-dynamic makes that
// explicit instead of relying on Next's implicit dynamic-usage detection,
// which only fires (and only gets a chance to fall back gracefully) for
// static-path GET routes probed during the build's static-generation pass;
// this route is either a non-GET method or otherwise not guaranteed to hit
// that same path, so making it explicit removes the ambiguity outright.
export const dynamic = 'force-dynamic'

// POST /api/dalgo/auth/logout — Task 6.1.
// Clears the dalgo_access_token cookie and returns 200. Does not call
// Supabase's own signOut() — the cookie IS the credential this app checks
// (middleware.ts / lib/dalgoAuth.ts's getSession()); once it's cleared here,
// no further request from this browser can authenticate as this user.
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(0),
    path: '/',
  })
  return res
}

// GET — used by plain <a href> links (e.g. the Log out button on /setup)
// When logout is called from a customer subdomain, chain through the main domain
// logout endpoint so BOTH the subdomain cookie AND the dalgo.online cookie are cleared.
export async function GET(request: any) {
  const host = request.headers.get('host') || 'dalgo.online'
  const isSubdomain = host.endsWith('.dalgo.online') && host !== 'dalgo.online' && host !== 'www.dalgo.online'
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'

  // Subdomain logout: clear subdomain cookie, then chain to main domain logout
  // so dalgo.online's cookie is also cleared before the user reaches /login.
  const redirectTo = isSubdomain
    ? 'https://dalgo.online/api/dalgo/auth/logout'
    : (process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/login` : `${proto}://${host}/login`)
  
  const res = NextResponse.redirect(redirectTo)
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(0),
    path: '/',
  })
  return res
}
