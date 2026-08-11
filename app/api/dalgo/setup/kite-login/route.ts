import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

function normalizedBase(req: NextRequest): string {
  const configured = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http'
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

// GET /api/dalgo/setup/kite-login
// Reads the customer's saved API key, then redirects to Kite OAuth.
export async function GET(req: NextRequest) {
  const base = normalizedBase(req)
  const profile = await getProfile()
  if (!profile) return NextResponse.redirect(`${base}/login`)
  const setupEligible = new Set(['identity_verified', 'broker_setup_complete', 'active'])
  if (!setupEligible.has(profile.status)) return NextResponse.redirect(`${base}/setup`)

  const admin = getSupabaseAdmin()
  const { data: brokerAccount } = await admin
    .from('broker_accounts')
    .select('api_key_enc, broker_name')
    .eq('customer_id', profile.id)
    .eq('active', true)
    .maybeSingle()

  if (!brokerAccount?.api_key_enc) {
    return NextResponse.redirect(`${base}/setup?error=` + encodeURIComponent('Save your API credentials first.'))
  }

  const apiKey = decrypt(brokerAccount.api_key_enc)
  const kiteUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey)}`

  // Set pending cookie so the callback knows which customer is completing OAuth
  const res = NextResponse.redirect(kiteUrl)
  res.cookies.set('dalgo_kite_pending', profile.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes — enough for the OAuth round-trip
    path: '/',
  })
  return res
}
