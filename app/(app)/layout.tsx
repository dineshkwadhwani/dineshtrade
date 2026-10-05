import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = getSupabaseAdmin()
  const { data: broker } = await admin
    .from('broker_accounts')
    .select('access_token_enc, token_expires_at')
    .eq('customer_id', profile.id)
    .eq('broker_name', 'zerodha')
    .eq('active', true)
    .maybeSingle()

  const tokenExpired = !broker?.access_token_enc || !broker?.token_expires_at || new Date(broker.token_expires_at) < new Date()

  return (
    <AppShell fullName={profile?.full_name ?? undefined} tokenExpired={tokenExpired}>
      {children}
    </AppShell>
  )
}
