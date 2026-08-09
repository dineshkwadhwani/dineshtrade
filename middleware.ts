// DAlgo role-based route protection. Replaces the V1 time-based-password
// middleware entirely.
//
// EDGE RUNTIME CONSTRAINTS (why this file is written the way it is):
//   - next/headers' cookies() does NOT work here — only in Server Components
//     and Route Handlers. Cookies are read directly off `request.cookies`.
//   - lib/supabase.ts is NOT imported here, even though this only needs its
//     plain anon client: that file also exports getSupabaseAdmin(), and
//     importing anything from the file risks the Edge bundler pulling in
//     the whole module graph. A minimal client is built inline instead,
//     directly from @supabase/supabase-js.
//   - SHARED_SSO_SECRET + jose is NOT used to verify dalgo_access_token:
//     that secret only signs the separate main→customer SSO redirect token
//     (see lib/dalgoAuth.ts generateSSOToken/validateSSOToken). The session
//     cookie is a Supabase Auth JWT, signed with Supabase's own project
//     secret — verifying it means asking Supabase's Auth API, not checking
//     it against a secret we hold ourselves.
//   - SESSION_COOKIE's value ('dalgo_access_token') is duplicated from
//     lib/dalgoAuth.ts's exported constant rather than imported, for the
//     same reason as the getSupabaseAdmin point above — that file imports
//     next/headers, which this file must not pull into the Edge bundle.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { ProfileRole } from '@/lib/dalgoAuth'

const SESSION_COOKIE = 'dalgo_access_token'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// ---------------------------------------------------------------------------
// Route classification
// ---------------------------------------------------------------------------

const PUBLIC_EXACT = new Set([
  '/',
  '/login',
  '/register',
  '/pending',
  '/privacy',
  '/terms',
  '/risk',
  '/cookies',
  '/refund',
  '/grievance',
  '/about',
  '/contact',
  '/api/dalgo/auth', // critical — the login endpoint itself must be public
  '/api/dalgo/register', // customer/broking-company self-registration — no session exists yet
  '/api/dalgo/upload-url', // Aadhar upload URL generation — called from the registration form pre-signup
  '/api/auth', // V1 auth route stays public too
  '/favicon.ico',
])
const PUBLIC_PREFIXES = ['/_next', '/public']

const SUPERADMIN_PREFIXES = ['/admin']
const ACCOUNT_MANAGER_PREFIXES = ['/manager']

const CUSTOMER_EXACT = new Set([
  '/dashboard',
  '/holdings',
  '/positions',
  '/orders',
  '/engine',
  '/watchlist',
  '/manage-lists',
  '/pivotal-lists',
  '/strategies',
  '/trade-report',
  '/settings',
  '/health',
  // Bridge entries: still-live V1 pages with no DAlgo route-map equivalent
  // yet (/orders above is meant to replace /trades). Remove once /orders
  // and its skipped-signals view actually exist.
  '/trades',
  '/skipped-orders',
])

const ANY_AUTHENTICATED_EXACT = new Set(['/sso'])

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

function matchesPrefixRule(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

// null = matches none of the rules below — deny by default.
function requiredAccess(pathname: string): ProfileRole | 'any' | null {
  if (matchesPrefixRule(pathname, SUPERADMIN_PREFIXES)) return 'superadmin'
  if (matchesPrefixRule(pathname, ACCOUNT_MANAGER_PREFIXES)) return 'account_manager'
  if (CUSTOMER_EXACT.has(pathname)) return 'customer'
  if (ANY_AUTHENTICATED_EXACT.has(pathname)) return 'any'
  if (pathname.startsWith('/api/')) return 'any' // per-route role checks happen inside each API route, not here
  return null
}

// ---------------------------------------------------------------------------
// middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Step 1 — public route → pass through, no cookie check at all.
  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  const access = requiredAccess(pathname)

  // Step 2 — no session cookie → redirect to /login.
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[middleware] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY')
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Step 3 — verify the cookie with Supabase's own Auth API (fetch-based,
  // Edge-safe). Fresh client per request, carrying this user's own JWT as
  // the Authorization header so the profiles read below is correctly
  // scoped under RLS (auth.uid() = this user, per the profiles_read policy).
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData.user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Path isn't in any explicit allowlist — deny even with a valid session.
  if (access === null) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // /sso and /api/* — any authenticated role is enough, no specific role
  // check needed here.
  if (access === 'any') {
    return NextResponse.next()
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Step 4/5 — role matches → pass through; otherwise → /login.
  if (profile.role !== access) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
