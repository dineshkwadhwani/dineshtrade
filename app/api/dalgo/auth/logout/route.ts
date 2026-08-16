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
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const appHost = (() => { try { return new URL(appUrl).hostname } catch { return '' } })()
  const redirectTo = appHost.endsWith('.dalgo.online') ? 'https://dalgo.online' : appUrl
  const res = NextResponse.redirect(new URL('/', redirectTo))
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(0),
    path: '/',
  })
  return res
}
