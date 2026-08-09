import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createHash } from 'crypto'
import { verifySession } from '@/lib/auth'
import { getAccountSecrets } from '@/lib/accounts'
import { saveState } from '@/lib/state'

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

// GET /api/zerodha/callback?request_token=...&action=login&status=success
// Reads the pending account from the cookie set by /api/zerodha/login,
// exchanges request_token + checksum for an access_token via Kite,
// saves the token into session state, and redirects to /settings.
export async function GET(req: NextRequest) {
  const base = normalizedBase(req)
  function redirectWithCleanup(url: URL): NextResponse {
    const res = NextResponse.redirect(url)
    res.cookies.delete('dt_kite_pending')
    return res
  }

  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.redirect(new URL('/login', base))
  }

  const sp = req.nextUrl.searchParams
  const requestToken = sp.get('request_token')
  const status = sp.get('status')
  const account = cookies().get('dt_kite_pending')?.value

  if (!account) {
    return redirectWithCleanup(new URL('/settings?error=' + encodeURIComponent('No pending login — start again from Settings'), base))
  }
  if (status !== 'success' || !requestToken) {
    return redirectWithCleanup(new URL('/settings?error=' + encodeURIComponent('Kite login was not completed'), base))
  }

  const secrets = getAccountSecrets(account)
  if (!secrets) {
    return redirectWithCleanup(new URL('/settings?error=' + encodeURIComponent(`Unknown account: ${account}`), base))
  }

  // Kite checksum = sha256(api_key + request_token + api_secret)
  const checksum = createHash('sha256')
    .update(secrets.apiKey + requestToken + secrets.apiSecret)
    .digest('hex')

  try {
    const tokenRes = await fetch('https://api.kite.trade/session/token', {
      method: 'POST',
      headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        api_key: secrets.apiKey,
        request_token: requestToken,
        checksum,
      }),
    })
    const data = await tokenRes.json().catch(() => ({}))
    const accessToken: string | undefined = data?.data?.access_token
    if (!tokenRes.ok || !accessToken) {
      const errMsg = data?.message || data?.error_type || `Kite ${tokenRes.status}`
      return redirectWithCleanup(new URL('/settings?error=' + encodeURIComponent(errMsg), base))
    }

    await saveState({ kiteTokens: { [account]: accessToken } })
    return redirectWithCleanup(new URL('/settings?connected=' + encodeURIComponent(account), base))
  } catch (e) {
    return redirectWithCleanup(new URL('/settings?error=' + encodeURIComponent('Network error: ' + String(e).slice(0, 120)), base))
  }
}
