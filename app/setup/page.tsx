import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getRequestBase } from '@/lib/requestOrigin'
import { getAvailableBrokers } from '@/lib/broker/availability'
import SetupClient from './SetupClient'

export const dynamic = 'force-dynamic'

export default async function SetupPage({ searchParams }: { searchParams: { connected?: string; error?: string } }) {
  const profile = await getProfile()

  if (!profile) redirect('/login')
  if (profile.status === 'pending' || profile.status === 'under_review') redirect('/pending')
  // active and broker_setup_complete customers both land here; active shows the "ready" screen

  // Check if broker credentials + access token are already saved
  const admin = getSupabaseAdmin()
  const [{ data: brokerAccount }, availableBrokers] = await Promise.all([
    admin
      .from('broker_accounts')
      .select('broker_name, api_key_enc, access_token_enc, token_captured_at')
      .eq('customer_id', profile.id)
      .eq('active', true)
      .maybeSingle(),
    getAvailableBrokers(),
  ])

  const hasCreds = !!brokerAccount?.api_key_enc
  const isConnected = !!brokerAccount?.access_token_enc || searchParams.connected === 'true'

  const appUrl = getRequestBase(headers())
  const brokerName = brokerAccount?.broker_name || availableBrokers[0] || ''
  const callbackUrl = brokerName === 'upstox'
    ? process.env.UPSTOX_REDIRECT_URI || `${appUrl}/api/dalgo/setup/broker-callback`
    : `${appUrl}/api/dalgo/setup/kite-callback`

  return (
    <SetupClient
      profile={{ id: profile.id, full_name: profile.full_name, email: profile.email }}
      initialHasCreds={hasCreds}
      initialIsConnected={isConnected}
      initialBroker={brokerName}
      availableBrokers={availableBrokers}
      initialError={searchParams.error ?? null}
      isActive={profile.status === 'active'}
      callbackUrl={callbackUrl}
      loginUrl="/api/dalgo/setup/broker-login"
    />
  )
}
