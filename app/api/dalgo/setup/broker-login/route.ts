import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encryption'
import { getRequestBase } from '@/lib/requestOrigin'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const base = getRequestBase(req.headers)
  const profile = await getProfile()
  if (!profile) return NextResponse.redirect(`${base}/login`)

  const admin = getSupabaseAdmin()
  const { data: row } = await admin
    .from('broker_accounts')
    .select('broker_name, api_key_enc')
    .eq('customer_id', profile.id)
    .eq('active', true)
    .maybeSingle()
  if (!row?.api_key_enc) return NextResponse.redirect(`${base}/setup?error=${encodeURIComponent('Save your broker credentials first.')}`)

  const apiKey = decrypt(row.api_key_enc)
  let destination: string
  if (row.broker_name === 'zerodha') {
    destination = `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey)}`
  } else if (row.broker_name === 'upstox') {
    const redirectUri = process.env.UPSTOX_REDIRECT_URI || `${base}/api/dalgo/setup/broker-callback`
    const params = new URLSearchParams({ client_id: apiKey, redirect_uri: redirectUri, response_type: 'code', state: profile.id })
    destination = `https://api.upstox.com/v2/login/authorization/dialog?${params}`
  } else {
    return NextResponse.redirect(`${base}/setup?error=${encodeURIComponent(`Broker ${row.broker_name} is not supported yet.`)}`)
  }

  const response = NextResponse.redirect(destination)
  if (row.broker_name === 'zerodha') {
    response.cookies.set('dalgo_kite_pending', profile.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    })
  }
  response.cookies.set('dalgo_broker_pending', `${profile.id}:${row.broker_name}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return response
}