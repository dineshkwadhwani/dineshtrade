import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createHash } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { decrypt, encrypt } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

function normalizedBase(req: NextRequest): string {
  const configured = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http'
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

// GET /api/dalgo/setup/kite-callback?request_token=...&status=success
// Exchanges the Kite request_token for an access_token and saves it encrypted.
export async function GET(req: NextRequest) {
  const base = normalizedBase(req)
  const cookieStore = cookies()

  function redirectWithCleanup(path: string): NextResponse {
    const res = NextResponse.redirect(`${base}${path}`)
    res.cookies.delete('dalgo_kite_pending')
    return res
  }

  const customerId = cookieStore.get('dalgo_kite_pending')?.value
  if (!customerId) {
    return redirectWithCleanup('/setup?error=' + encodeURIComponent('Session expired. Please try connecting again.'))
  }

  const sp = req.nextUrl.searchParams
  const requestToken = sp.get('request_token')
  const status = sp.get('status')

  if (status !== 'success' || !requestToken) {
    return redirectWithCleanup('/setup?error=' + encodeURIComponent('Kite login was cancelled or failed.'))
  }

  const admin = getSupabaseAdmin()
  const { data: brokerAccount } = await admin
    .from('broker_accounts')
    .select('id, api_key_enc, api_secret_enc, broker_name')
    .eq('customer_id', customerId)
    .eq('active', true)
    .maybeSingle()

  if (!brokerAccount?.api_key_enc || !brokerAccount?.api_secret_enc) {
    return redirectWithCleanup('/setup?error=' + encodeURIComponent('Broker credentials not found. Please re-enter them.'))
  }

  const apiKey = decrypt(brokerAccount.api_key_enc)
  const apiSecret = decrypt(brokerAccount.api_secret_enc)

  // Kite checksum = sha256(api_key + request_token + api_secret)
  const checksum = createHash('sha256')
    .update(apiKey + requestToken + apiSecret)
    .digest('hex')

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
      return redirectWithCleanup('/setup?error=' + encodeURIComponent(errMsg))
    }

    const now = new Date().toISOString()
    await admin
      .from('broker_accounts')
      .update({
        access_token_enc: encrypt(accessToken),
        token_captured_at: now,
        updated_at: now,
      })
      .eq('id', brokerAccount.id)

    // Only advance status if not already active — don't downgrade an active customer
    const { data: currentProfile } = await admin.from('profiles').select('status').eq('id', customerId).maybeSingle()
    if (currentProfile?.status === 'identity_verified') {
      await admin.from('profiles').update({ status: 'broker_setup_complete', updated_at: now }).eq('id', customerId)
    }

    return redirectWithCleanup('/setup?connected=true')
  } catch (e) {
    return redirectWithCleanup('/setup?error=' + encodeURIComponent('Network error: ' + String(e).slice(0, 100)))
  }
}
