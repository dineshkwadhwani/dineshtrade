import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getAccountSecrets, isAccountConfigured } from '@/lib/accounts'

// Reads the session cookie via cookies() (next/headers) on every request —
// force-dynamic makes that explicit instead of relying on Next's implicit
// dynamic-usage detection, which reportedly failed the production build on
// EC2 for a sibling route (app/api/dalgo/admin/reports/export) with the same
// underlying pattern.
export const dynamic = 'force-dynamic'

function normalizedBase(req: NextRequest): URL {
  const configured = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  if (configured) {
    try { return new URL(configured) } catch { /* ignore malformed env */ }
  }

  const proto = (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'http')
    .split(',')[0]
    .trim()
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const hostHeader = req.headers.get('host')?.split(',')[0]?.trim()
  let host = forwardedHost || hostHeader || req.nextUrl.host

  if (!host || host.startsWith('0.0.0.0')) {
    const port = req.nextUrl.port ? `:${req.nextUrl.port}` : ''
    host = `localhost${port}`
  }

  return new URL(`${proto}://${host}`)
}

// GET /api/zerodha/login?account=DINESH
// Sets a short-lived cookie remembering which account is logging in,
// then redirects the browser to Zerodha's Kite Connect login page.
export async function GET(req: NextRequest) {
  const base = normalizedBase(req)
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.redirect(new URL('/login', base))
  }
  const account = req.nextUrl.searchParams.get('account')
  if (!account || !isAccountConfigured(account)) {
    return NextResponse.redirect(new URL('/settings?error=' + encodeURIComponent(`Unknown account: ${account}`), base))
  }
  const { apiKey } = getAccountSecrets(account)!

  const kiteUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey)}`
  const res = NextResponse.redirect(kiteUrl)
  res.cookies.set('dt_kite_pending', account, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 300, // 5 minutes — plenty for the OAuth roundtrip
    path: '/',
  })
  return res
}
