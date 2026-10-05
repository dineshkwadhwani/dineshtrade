import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { encrypt } from '@/lib/encryption'
import { getAvailableBrokers } from '@/lib/broker/availability'

export const dynamic = 'force-dynamic'

const ALLOWED_STATUSES = new Set(['identity_verified', 'broker_setup_complete', 'active'])

export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) {
    return NextResponse.json({ error: 'No active session.' }, { status: 401 })
  }
  if (!ALLOWED_STATUSES.has(profile.status)) {
    return NextResponse.json({ error: 'Broker setup is only available after identity verification.' }, { status: 403 })
  }

  let body: { broker?: unknown; apiKey?: unknown; apiSecret?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const broker = typeof body.broker === 'string' ? body.broker.trim() : ''
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  const apiSecret = typeof body.apiSecret === 'string' ? body.apiSecret.trim() : ''

  const ALLOWED_BROKERS = new Set(['zerodha', 'upstox'])
  if (!ALLOWED_BROKERS.has(broker)) {
    return NextResponse.json({ error: 'Invalid broker.' }, { status: 400 })
  }
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: 'API Key and API Secret are required.' }, { status: 400 })
  }

  const availableBrokers = await getAvailableBrokers()
  if (!availableBrokers.includes(broker as 'zerodha' | 'upstox')) {
    const admin = getSupabaseAdmin()
    const { data: existing } = await admin
      .from('broker_accounts')
      .select('id')
      .eq('customer_id', profile.id)
      .eq('broker_name', broker)
      .eq('active', true)
      .maybeSingle()
    if (!existing) {
      return NextResponse.json({ error: 'This broker is not currently available for new connections.' }, { status: 403 })
    }
  }

  const apiKeyEnc = encrypt(apiKey)
  const apiSecretEnc = encrypt(apiSecret)

  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { error: deactivateError } = await admin
    .from('broker_accounts')
    .update({ active: false, updated_at: now })
    .eq('customer_id', profile.id)
  if (deactivateError) {
    console.error('[api/dalgo/setup/broker] deactivate error:', deactivateError.message)
    return NextResponse.json({ error: 'Failed to update selected broker.' }, { status: 500 })
  }

  const { error } = await admin.from('broker_accounts').upsert(
    {
      customer_id: profile.id,
      broker_name: broker,
      api_key_enc: apiKeyEnc,
      api_secret_enc: apiSecretEnc,
      // New credentials require a fresh broker OAuth session.
      access_token_enc: null,
      token_captured_at: null,
      active: true,
      updated_at: now,
    },
    { onConflict: 'customer_id,broker_name' }
  )

  if (error) {
    console.error('[api/dalgo/setup/broker] upsert error:', error.message)
    return NextResponse.json({ error: 'Failed to save broker credentials.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
