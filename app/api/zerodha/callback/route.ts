import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createHash } from 'crypto'
import { verifySession } from '@/lib/auth'
import { getAccountSecrets } from '@/lib/accounts'
import { saveState } from '@/lib/state'
import { getSupabaseAdmin } from '@/lib/supabase'
import { decrypt, encrypt } from '@/lib/encryption'
import { getProfile } from '@/lib/dalgoAuth'

export const dynamic = 'force-dynamic'

// next 6AM IST in UTC (Zerodha tokens expire daily at 6AM IST = 00:30 UTC)
function nextKiteExpiry(): string {
  const now = new Date()
  const expiry = new Date()
  expiry.setUTCHours(0, 30, 0, 0)
  if (expiry <= now) expiry.setUTCDate(expiry.getUTCDate() + 1)
  return expiry.toISOString()
}

function normalizedBase(req: NextRequest): URL {
  const configured = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  if (configured) {
    try { return new URL(configured) } catch { /* ignore malformed env */ }
  }
  const proto = (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'http').split(',')[0].trim()
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
//
// Handles two flows in one route (Kite's registered callback URL never changes):
//
// ── DAlgo flow ─────────────────────────────────────────────────────────────
// Customer identity: dalgo_access_token JWT cookie (set at DAlgo login).
// Saves encrypted access_token to Supabase broker_accounts.
// Redirects based on profile status: identity_verified → /setup, active → /sso.
//
// ── V1 flow ────────────────────────────────────────────────────────────────
// Falls through when no DAlgo session. Uses dt_kite_pending + dt_session.
// Saves token to state.json (legacy). Redirects to /settings.
export async function GET(req: NextRequest) {
  const base = normalizedBase(req)
  const cookieStore = cookies()
  const sp = req.nextUrl.searchParams
  const requestToken = sp.get('request_token')
  const status = sp.get('status')

  // ── DAlgo flow — customer identified via dalgo_access_token JWT ──────────
  const dalgoProfile = await getProfile()
  if (dalgoProfile) {
    function dalgoRedirect(path: string): NextResponse {
      return NextResponse.redirect(new URL(path, base))
    }

    if (status !== 'success' || !requestToken) {
      return dalgoRedirect('/setup?error=' + encodeURIComponent('Kite login was cancelled or failed.'))
    }

    const admin = getSupabaseAdmin()
    const { data: brokerAccount } = await admin
      .from('broker_accounts')
      .select('id, api_key_enc, api_secret_enc')
      .eq('customer_id', dalgoProfile.id)
      .eq('active', true)
      .maybeSingle()

    if (!brokerAccount?.api_key_enc || !brokerAccount?.api_secret_enc) {
      return dalgoRedirect('/setup?error=' + encodeURIComponent('Broker credentials not found. Please re-enter them.'))
    }

    const apiKey = decrypt(brokerAccount.api_key_enc)
    const apiSecret = decrypt(brokerAccount.api_secret_enc)
    const checksum = createHash('sha256').update(apiKey + requestToken + apiSecret).digest('hex')

    try {
      const tokenRes = await fetch('https://api.kite.trade/session/token', {
        method: 'POST',
        headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum }),
      })
      const data = await tokenRes.json().catch(() => ({}))
      const accessToken: string | undefined = data?.data?.access_token
      if (!tokenRes.ok || !accessToken) {
        const errMsg = data?.message || data?.error_type || `Kite error ${tokenRes.status}`
        return dalgoRedirect('/setup?error=' + encodeURIComponent(errMsg))
      }

      const now = new Date().toISOString()
      await admin.from('broker_accounts').update({
        access_token_enc: encrypt(accessToken),
        token_captured_at: now,
        token_expires_at: nextKiteExpiry(),
        updated_at: now,
      }).eq('id', brokerAccount.id)

      // Also write to state.kiteTokens so the V1 trading dashboard can use it
      const env = process.env.ZERODHA_ENVIRONMENT === 'PROD' ? 'PROD' : 'TEST'
      const primaryAccount = process.env[`${env}_ZERODHA_ACCOUNT1`] || 'DINESH'
      await saveState({ kiteTokens: { [primaryAccount]: accessToken } }).catch(err =>
        console.error('[zerodha/callback] saveState kiteTokens failed:', err)
      )

      // Mark instance as connected
      await admin.from('customer_instances').upsert(
        { customer_id: dalgoProfile.id, kite_token_status: 'connected', updated_at: now },
        { onConflict: 'customer_id' }
      )

      // Advance status if still at identity_verified; don't downgrade active customers
      if (dalgoProfile.status === 'identity_verified') {
        const { error: statusErr } = await admin.from('profiles').update({ status: 'broker_setup_complete', updated_at: now }).eq('id', dalgoProfile.id)
        if (statusErr) console.error('[zerodha/callback] status update failed:', statusErr.message, '| code:', statusErr.code)
      }

      const redirectTo = dalgoProfile.status === 'active' ? '/dashboard' : '/setup?connected=true'
      return dalgoRedirect(redirectTo)
    } catch (e) {
      return dalgoRedirect('/setup?error=' + encodeURIComponent('Network error: ' + String(e).slice(0, 100)))
    }
  }

  // ── V1 flow — falls through when no DAlgo session ────────────────────────
  function redirectWithCleanup(url: URL): NextResponse {
    const res = NextResponse.redirect(url)
    res.cookies.delete('dt_kite_pending')
    return res
  }

  const session = cookieStore.get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.redirect(new URL('/login', base))
  }

  const account = cookieStore.get('dt_kite_pending')?.value
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

  const checksum = createHash('sha256').update(secrets.apiKey + requestToken + secrets.apiSecret).digest('hex')

  try {
    const tokenRes = await fetch('https://api.kite.trade/session/token', {
      method: 'POST',
      headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: secrets.apiKey, request_token: requestToken, checksum }),
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

