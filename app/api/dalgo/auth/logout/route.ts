import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/dalgoAuth'

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
