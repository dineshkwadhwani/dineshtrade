// DAlgo authentication — Supabase Auth + RLS profiles + SSO token issuance.
//
// Deliberately a SEPARATE file from lib/auth.ts: that file is the V1
// time-based-password auth still wired into middleware.ts, app/login/page.tsx,
// app/api/auth/route.ts, and ~30 other files. This module does not touch or
// replace any of that — it's net-new, additive DAlgo plumbing per the refactor
// spec §5.2/§5.6. Cutting the V1 app over to this is a separate, explicit task.
//
// SERVER-ONLY. Every exported function guards against being called in a
// browser context.
//
// Provisional contract: getSession()/getProfile() read the Supabase access
// token from a cookie named SESSION_COOKIE below. Nothing in this file sets
// that cookie yet — login() returns the tokens and leaves cookie-setting to
// whichever API route calls it (a later task, e.g. rewriting
// app/api/auth/route.ts). Flagging this now so it isn't a surprise later.

import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { supabaseAnon, getSupabaseAdmin } from './supabase'

// TODO: once `supabase gen types typescript` is run, replace the manual
// Profile/row types below with generated Database types.

export const SESSION_COOKIE = 'dalgo_access_token'
const SSO_TOKEN_TTL_SECONDS = 60
const SSO_SECRET_BYTES = 32

export type ProfileRole = 'superadmin' | 'account_manager' | 'broking_company' | 'customer'
export type ProfileStatus =
  | 'pending'
  | 'under_review'
  | 'identity_verified'
  | 'active'
  | 'suspended'
  | 'rejected'

export interface Profile {
  id: string
  role: ProfileRole
  status: ProfileStatus
  full_name: string
  email: string
}

export interface DalgoSession {
  userId: string
  email: string | null
  accessToken: string
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  expiresAt: number
  profile: Profile
}

// Thrown by every function below on any auth failure. `statusCode` is a hint
// for callers — API routes map it to a response status, Server
// Components/pages catch it and call next/navigation's redirect() themselves.
// This module intentionally never redirects on its own: redirect() only makes
// sense in a rendering context, and an API route usually wants JSON + a
// status code instead, not an HTTP redirect.
export class AuthError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
  }
}

function assertServer(): void {
  if (typeof window !== 'undefined') {
    throw new Error('[lib/dalgoAuth] must never run in a browser context.')
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export function createEphemeralAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      '[lib/dalgoAuth] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }
  // A FRESH client, never the shared `supabaseAnon` singleton from
  // lib/supabase.ts. signInWithPassword()/signUp() mutate a client's internal
  // auth state — reusing a module-level singleton for either would risk one
  // request's session bleeding into a concurrent request on the same
  // long-lived Node process. persistSession/autoRefreshToken are off because
  // nothing should keep this throwaway client's state alive afterward.
  // Exported for reuse by app/api/dalgo/register/route.ts's signUp() call.
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Authenticates via Supabase Auth, then checks the profiles row. Throws
// AuthError(401) for wrong credentials, AuthError(403) for a missing profile
// or a non-'active' status. Returns the session tokens (caller decides how to
// persist them — cookie, header, etc.) plus the full profile row.
export async function login(email: string, password: string): Promise<LoginResult> {
  assertServer()

  const client = createEphemeralAnonClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })

  if (error || !data.session || !data.user) {
    // Deliberately generic message — do not distinguish "wrong password" from
    // "no such account" here; that distinction is a user-enumeration leak.
    throw new AuthError('Invalid email or password.', 401)
  }

  const admin = getSupabaseAdmin()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, role, status, full_name, email')
    .eq('id', data.user.id)
    .maybeSingle()

  if (profileError || !profile) {
    throw new AuthError('No profile exists for this account.', 403)
  }
  if (profile.status !== 'active') {
    throw new AuthError(`Account is not active (status: ${profile.status}).`, 403)
  }

  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at ?? 0,
    profile: profile as Profile,
  }
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

// Reads the access token from SESSION_COOKIE and validates it against
// Supabase. `supabaseAnon.auth.getUser(token)` is stateless when passed an
// explicit token — it does not read/write the shared client's internal
// session, so reusing the lib/supabase.ts singleton here is safe (unlike
// signInWithPassword() above).
export async function getSession(): Promise<DalgoSession | null> {
  assertServer()

  const token = cookies().get(SESSION_COOKIE)?.value
  if (!token) return null

  const { data, error } = await supabaseAnon.auth.getUser(token)
  if (error || !data.user) return null

  return { userId: data.user.id, email: data.user.email ?? null, accessToken: token }
}

// Returns the profiles row for the current session, or null if there is no
// valid session or no matching profile. Does not check `status` — callers
// that care (requireRole does) must check it explicitly.
export async function getProfile(): Promise<Profile | null> {
  assertServer()

  const session = await getSession()
  if (!session) return null

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('profiles')
    .select('id, role, status, full_name, email')
    .eq('id', session.userId)
    .maybeSingle()

  if (error || !data) return null
  return data as Profile
}

// Throws AuthError(401) if there's no session, AuthError(403) if the account
// isn't active, AuthError(403) if the role doesn't match. Returns the profile
// on success so callers don't need a second getProfile() call.
export async function requireRole(role: ProfileRole | ProfileRole[]): Promise<Profile> {
  assertServer()

  const profile = await getProfile()
  if (!profile) {
    throw new AuthError('No active session.', 401)
  }
  if (profile.status !== 'active') {
    throw new AuthError(`Account is not active (status: ${profile.status}).`, 403)
  }

  const allowed = Array.isArray(role) ? role : [role]
  if (!allowed.includes(profile.role)) {
    throw new AuthError(
      `Requires role ${allowed.join(' or ')} — current role is ${profile.role}.`,
      403
    )
  }
  return profile
}

// ---------------------------------------------------------------------------
// SSO tokens (main instance → customer instance)
// ---------------------------------------------------------------------------

let cachedSsoSecret: Buffer | null = null

// Same validation shape as lib/encryption.ts's ENCRYPTION_KEY check, per spec:
// missing or wrong-length SHARED_SSO_SECRET throws immediately and clearly.
function getSsoSecret(): Buffer {
  assertServer()
  if (cachedSsoSecret) return cachedSsoSecret

  const hex = process.env.SHARED_SSO_SECRET
  if (!hex) {
    throw new Error('[lib/dalgoAuth] Missing required env var: SHARED_SSO_SECRET')
  }
  const expectedHexLen = SSO_SECRET_BYTES * 2
  if (hex.length !== expectedHexLen || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      `[lib/dalgoAuth] SHARED_SSO_SECRET must be a ${expectedHexLen}-character hex string ` +
        `encoding exactly ${SSO_SECRET_BYTES} bytes — got ${hex.length} character(s).`
    )
  }
  cachedSsoSecret = Buffer.from(hex, 'hex')
  return cachedSsoSecret
}

interface SsoTokenPayload extends JWTPayload {
  customerId: string
}

// Signs a 60-second, one-time-use JWT for {customerId} and persists it to
// sso_tokens (via the admin client — inserting here is a system action, not
// something done under an end-user's own RLS-scoped session). Returns the
// signed JWT string.
//
// NOTE: the spec's literal signature is `generateSSOToken(customerId): string`
// — made async here because persisting to sso_tokens is unavoidably a DB
// round trip. A synchronous version that also writes to Supabase isn't
// possible.
export async function generateSSOToken(customerId: string): Promise<string> {
  assertServer()
  if (!customerId) {
    throw new AuthError('customerId is required to generate an SSO token.', 400)
  }

  const secret = getSsoSecret()
  const token = await new SignJWT({ customerId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SSO_TOKEN_TTL_SECONDS}s`)
    .sign(secret)

  const expiresAt = new Date(Date.now() + SSO_TOKEN_TTL_SECONDS * 1000).toISOString()

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('sso_tokens')
    .insert({ token, customer_id: customerId, expires_at: expiresAt })

  if (error) {
    throw new AuthError(`Failed to persist SSO token: ${error.message}`, 500)
  }

  return token
}

// Validates signature + expiry (via jose, which throws JWTExpired once `exp`
// has passed — covers "checks not expired" for free), then independently
// checks the sso_tokens row: exists, not already used, DB expires_at not
// passed, customer_id matches the JWT payload. Marks the token used with a
// conditional update (`.eq('used', false)`) so a concurrent replay of the
// same token can win the race at most once — the loser gets back zero
// updated rows and is treated as "already used" too.
//
// NOTE: same async deviation as generateSSOToken — the spec's literal
// signature is synchronous, which isn't possible given the required DB reads.
export async function validateSSOToken(token: string): Promise<{ customerId: string }> {
  assertServer()

  let payload: SsoTokenPayload
  try {
    const secret = getSsoSecret()
    const { payload: verified } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
    payload = verified as SsoTokenPayload
  } catch {
    throw new AuthError('SSO token is invalid or expired.', 401)
  }

  if (!payload.customerId || typeof payload.customerId !== 'string') {
    throw new AuthError('SSO token payload is malformed.', 401)
  }

  const admin = getSupabaseAdmin()
  const { data: row, error } = await admin
    .from('sso_tokens')
    .select('customer_id, used, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !row) {
    throw new AuthError('SSO token was not recognised.', 401)
  }
  if (row.used) {
    throw new AuthError('SSO token has already been used.', 401)
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new AuthError('SSO token has expired.', 401)
  }
  if (row.customer_id !== payload.customerId) {
    throw new AuthError('SSO token customer mismatch.', 401)
  }

  const { data: updated, error: updateError } = await admin
    .from('sso_tokens')
    .update({ used: true, used_at: new Date().toISOString() })
    .eq('token', token)
    .eq('used', false)
    .select('token')

  if (updateError || !updated || updated.length === 0) {
    throw new AuthError('SSO token has already been used.', 401)
  }

  return { customerId: payload.customerId }
}
