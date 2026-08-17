import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import SetupClient from './SetupClient'

export const dynamic = 'force-dynamic'

function getAppUrl(req: Headers): string {
  const configured = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  
  const proto = req.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
  const host = req.get('x-forwarded-host')?.split(',')[0]?.trim() || req.get('host') || 'dalgo.online'
  return `${proto}://${host}`
}

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

  const req = headers()
  const appUrl = getAppUrl(req)
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
