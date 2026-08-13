import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import SetupClient from './SetupClient'

export const dynamic = 'force-dynamic'

export default async function SetupPage({ searchParams }: { searchParams: { connected?: string; error?: string } }) {
  const profile = await getProfile()

  if (!profile) redirect('/login')
  if (profile.status === 'pending' || profile.status === 'under_review') redirect('/pending')
  // active and broker_setup_complete customers both land here; active shows the "ready" screen

  // Check if broker credentials + access token are already saved
  const admin = getSupabaseAdmin()
  const { data: brokerAccount } = await admin
    .from('broker_accounts')
    .select('broker_name, api_key_enc, access_token_enc, token_captured_at')
    .eq('customer_id', profile.id)
    .eq('active', true)
    .maybeSingle()

  const hasCreds = !!brokerAccount?.api_key_enc
  const isConnected = !!brokerAccount?.access_token_enc || searchParams.connected === 'true'

  const appUrl = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://dalgo.online').replace(/\/$/, '')
  const callbackUrl = `${appUrl}/api/zerodha/callback`

  return (
    <SetupClient
      profile={{ id: profile.id, full_name: profile.full_name, email: profile.email }}
      initialHasCreds={hasCreds}
      initialIsConnected={isConnected}
      initialError={searchParams.error ?? null}
      isActive={profile.status === 'active'}
      callbackUrl={callbackUrl}
    />
  )
}
