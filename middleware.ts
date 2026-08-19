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
  '/api/dalgo/auth/logout', // GET logout clears cookie and redirects to /; must be reachable without a valid session
  '/api/dalgo/auth/sso-redirect', // session-based SSO redirect — reads existing session cookie, no new auth needed
  '/api/dalgo/register', // customer/broking-company self-registration — no session exists yet
  '/api/dalgo/register/resend-verification', // resend email confirmation link — no session yet
  '/api/dalgo/upload-url', // Aadhar upload URL generation — called from the registration form pre-signup
  '/api/dalgo/contact', // public /contact page form submission — no session exists yet (Phase 7, Task 7.10)
  '/api/dalgo/setup/broker', // broker credential setup — session-gated inside the route, not via middleware (identity_verified customers have a session but not active status)
  '/api/dalgo/setup/kite-login', // initiates Kite OAuth — reads session cookie inside the route
  '/api/dalgo/setup/kite-callback', // Kite OAuth callback — validates via cookie set by kite-login
  '/api/zerodha/callback', // Kite OAuth callback — self-authenticates via dalgo_kite_pending or dt_session cookie; no DAlgo JWT needed
  '/api/auth', // V1 auth route stays public too
  '/favicon.ico',
  '/auth/reset-password', // password reset — user arrives with no session, only a Supabase recovery token in the URL hash
  // /sso is the SSO-handoff landing page (Phase 8, Task 8's fix) — a
  // customer arrives here straight from the main instance's login with a
  // one-time token in the URL and, by definition, NO session cookie on this
  // domain yet (establishing one is /sso's entire job). It was previously
  // listed under ANY_AUTHENTICATED_EXACT below, which required a session
  // cookie to already exist — that unconditionally bounced every real
  // ?token=xxx request to plain /login (Step 2 below runs before role
  // checks), so /sso could never actually be reached. Public here exactly
  // like /api/dalgo/auth above; the page's own one-time-JWT validation
  // (lib/dalgoAuth.ts validateSSOToken()) is the real gate, not middleware.
  '/sso',
])
const PUBLIC_PREFIXES = ['/_next', '/public']

// Static assets in /public are served at the root — allow all common extensions
function isStaticAsset(pathname: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|otf|mp4|pdf)$/i.test(pathname)
}

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
  '/setup',
  // Bridge entries: still-live V1 pages with no DAlgo route-map equivalent
  // yet (/orders above is meant to replace /trades). Remove once /orders
  // and its skipped-signals view actually exist.
  '/trades',
  '/skipped-orders',
])

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  if (PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))) return true
  return isStaticAsset(pathname)
}

function matchesPrefixRule(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

// null = matches none of the rules below — deny by default.
function requiredAccess(pathname: string): ProfileRole | 'any' | null {
  if (matchesPrefixRule(pathname, SUPERADMIN_PREFIXES)) return 'superadmin'
  if (matchesPrefixRule(pathname, ACCOUNT_MANAGER_PREFIXES)) return 'account_manager'
  if (CUSTOMER_EXACT.has(pathname)) return 'customer'
  if (pathname.startsWith('/api/')) return 'any' // per-route role checks happen inside each API route, not here
  return null
}

// ---------------------------------------------------------------------------
// middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host') || ''
  const isSubdomain = host.endsWith('.dalgo.online') && host !== 'dalgo.online' && host !== 'www.dalgo.online'

  // On subdomain servers, front-door public routes have no purpose — redirect
  // to dalgo.online so users always authenticate through the main site.
  // /sso, /auth/reset-password, API routes, and static assets are exempt.
  if (isSubdomain && isPublic(pathname) && !pathname.startsWith('/api/') && !isStaticAsset(pathname) && pathname !== '/sso' && pathname !== '/auth/reset-password') {
    return NextResponse.redirect('https://dalgo.online')
  }

  // Step 1 — public route → pass through, no cookie check at all.
  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  const access = requiredAccess(pathname)

  // Step 2 — no session cookie → redirect to login.
  // On a subdomain (narendra.dalgo.online etc.), send to the main auth server
  // rather than the local /login which has no standalone auth purpose.
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) {
    if (isSubdomain) {
      return NextResponse.redirect('https://dalgo.online')
    }
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

  // /api/* — any authenticated role is enough, no specific role check
  // needed here (/sso moved to PUBLIC_EXACT above — it has no session yet).
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
