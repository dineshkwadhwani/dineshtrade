import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSupabaseAdmin } from '@/lib/supabase'
import { decrypt, encrypt } from '@/lib/encryption'
import { UpstoxAdapter } from '@/lib/broker/UpstoxAdapter'
import { getRequestBase } from '@/lib/requestOrigin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const base = getRequestBase(req.headers)
  const pending = cookies().get('dalgo_broker_pending')?.value
  const [customerId, brokerName] = (pending || '').split(':')
  const responseTo = (path: string) => {
    const response = NextResponse.redirect(`${base}${path}`)
    response.cookies.delete('dalgo_broker_pending')
    return response
  }
  if (!customerId || brokerName !== 'upstox') {
    return responseTo(`/setup?error=${encodeURIComponent('Broker connection session expired. Please try again.')}`)
  }
  const code = req.nextUrl.searchParams.get('code')
  const returnedState = req.nextUrl.searchParams.get('state')
  if (!code || returnedState !== customerId) {
    return responseTo(`/setup?error=${encodeURIComponent('Upstox login was cancelled or could not be verified.')}`)
  }

  const admin = getSupabaseAdmin()
  const { data: row } = await admin
    .from('broker_accounts')
    .select('id, api_key_enc, api_secret_enc')
    .eq('customer_id', customerId)
    .eq('broker_name', brokerName)
    .eq('active', true)
    .maybeSingle()
  if (!row?.api_key_enc || !row.api_secret_enc) {
    return responseTo(`/setup?error=${encodeURIComponent('Upstox app credentials not found. Please save them again.')}`)
  }

  try {
    const adapter = new UpstoxAdapter({ apiKey: decrypt(row.api_key_enc), apiSecret: decrypt(row.api_secret_enc), accessToken: '' })
    const session = await adapter.generateSession(code)
    const now = new Date().toISOString()
    const { error } = await admin.from('broker_accounts').update({
      access_token_enc: encrypt(session.accessToken),
      token_captured_at: now,
      token_expires_at: session.expiresAt,
      refresh_token_enc: session.refreshToken ? encrypt(session.refreshToken) : null,
      updated_at: now,
    }).eq('id', row.id)
    if (error) throw new Error(error.message)

    const { data: profile } = await admin.from('profiles').select('status').eq('id', customerId).maybeSingle()
    if (profile?.status === 'identity_verified') {
      await admin.from('profiles').update({ status: 'broker_setup_complete', updated_at: now }).eq('id', customerId)
    }
    return responseTo(profile?.status === 'active' ? '/dashboard' : '/setup?connected=true')
  } catch (err) {
    console.error('[broker-callback] Upstox session exchange failed:', err)
    return responseTo(`/setup?error=${encodeURIComponent(`Upstox connection failed: ${String(err).slice(0, 120)}`)}`)
  }
}