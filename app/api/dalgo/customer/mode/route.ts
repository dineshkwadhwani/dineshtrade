import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })
    if (profile.status !== 'active') return NextResponse.json({ error: 'Account not active.' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const mode = typeof body.mode === 'string' ? body.mode.trim() : ''
    if (mode !== 'auto' && mode !== 'manual') {
      return NextResponse.json({ error: 'mode must be "auto" or "manual".' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const { error } = await admin
      .from('customer_state')
      .upsert({ customer_id: profile.id, cron_mode: mode, updated_at: new Date().toISOString() }, { onConflict: 'customer_id' })

    if (error) {
      console.error('[customer/mode] upsert failed:', error.message)
      return NextResponse.json({ error: 'Failed to update mode.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, mode })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[customer/mode] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
