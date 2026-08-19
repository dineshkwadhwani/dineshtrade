import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// DELETE /api/dalgo/customer/broker/disconnect — clears the Zerodha access token
// for the logged-in customer so they can re-authenticate and get a fresh token.
// API key + secret are preserved; only the OAuth session token is cleared.
export async function DELETE() {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('broker_accounts')
    .update({
      access_token_enc: null,
      token_captured_at: null,
      token_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('customer_id', profile.id)
    .eq('broker_name', 'zerodha')

  if (error) {
    console.error('[broker/disconnect] update error:', error.message)
    return NextResponse.json({ error: 'Failed to disconnect.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
