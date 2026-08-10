import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getEnvironment } from '@/lib/accounts'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Accept either DAlgo session or legacy V1 session
  const v1Session = cookies().get('dt_session')?.value
  const dalgoProfile = await getProfile()
  if (!dalgoProfile && (!v1Session || !(await verifySession(v1Session)))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const env = getEnvironment() ?? (process.env.ZERODHA_ENVIRONMENT || 'TEST').toUpperCase()

  // Build account list from Supabase profiles + broker_accounts instead of accounts.json
  const accounts: { name: string; displayName: string; initials: string; color: string; note: string; connected: boolean }[] = []

  if (dalgoProfile) {
    const admin = getSupabaseAdmin()
    const { data: broker } = await admin
      .from('broker_accounts')
      .select('broker_name, access_token_enc')
      .eq('customer_id', dalgoProfile.id)
      .eq('active', true)
      .maybeSingle()

    const prefix = env
    const primaryAccountKey = process.env[`${prefix}_ZERODHA_ACCOUNT1`] || 'DINESH'
    const nameParts = (dalgoProfile.full_name || '').trim().split(/\s+/)
    const initials = nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : (dalgoProfile.full_name || 'DW').slice(0, 2).toUpperCase()

    accounts.push({
      name: primaryAccountKey,
      displayName: dalgoProfile.full_name || primaryAccountKey,
      initials,
      color: '#1E3A8A',
      note: dalgoProfile.email || '',
      connected: !!broker?.access_token_enc,
    })
  } else {
    // V1 fallback — still read from env-based account list
    const { getAccountList } = await import('@/lib/accounts')
    accounts.push(...getAccountList().map(a => ({ ...a, connected: false })))
  }

  return NextResponse.json({ accounts, environment: env })
}
