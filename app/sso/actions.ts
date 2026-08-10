'use server'

// Server Action, not a Route Handler — deliberately. app/sso/page.tsx (a
// Server Component) can call validateSSOToken()/completeSsoLogin() directly
// during render, but Next.js throws ReadonlyRequestCookiesError on any
// cookies().set() call made outside a Server Action or Route Handler (see
// node_modules/next/dist/server/web/spec-extension/adapters/request-cookies.js).
// Since the token is one-time-use, validation has to happen exactly once, in
// the same call that's actually allowed to set the cookie — a Server Action
// invoked from SsoClient.tsx after the page has already painted its
// "Redirecting..." state satisfies both constraints in one call.

import { cookies } from 'next/headers'
import { validateSSOToken, completeSsoLogin, AuthError, SESSION_COOKIE } from '@/lib/dalgoAuth'
import { createSession } from '@/lib/auth'

export type SsoResult = { ok: true } | { ok: false; error: string }

export async function completeSso(token: string): Promise<SsoResult> {
  if (!token) return { ok: false, error: 'missing token' }

  try {
    const { customerId } = await validateSSOToken(token)
    const session = await completeSsoLogin(customerId)

    // Same cookie name/flags/lifetime as app/api/dalgo/auth/route.ts's
    // login cookie — this IS a login, just via SSO handoff instead of a
    // password form.
    const now = new Date()
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const midnight = new Date(ist)
    midnight.setDate(midnight.getDate() + 1)
    midnight.setHours(0, 0, 0, 0)

    cookies().set(SESSION_COOKIE, session.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: midnight,
      path: '/',
    })

    // Also set V1 dt_session so the customer can access the trading dashboard
    const v1Token = await createSession()
    cookies().set('dt_session', v1Token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: midnight,
      path: '/',
    })

    return { ok: true }
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: err.message }
    }
    console.error('[sso/actions] unexpected error:', err)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }
}
