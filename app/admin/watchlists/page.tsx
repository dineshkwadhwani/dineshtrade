export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import WatchlistsClient, { type WatchlistRow, type CustomerOption } from './WatchlistsClient'

// Task 6.15 — Platform Watchlists.
export default async function AdminWatchlistsPage() {
  const admin = getSupabaseAdmin()
  const [{ data }, { data: customers }] = await Promise.all([
    admin.from('platform_watchlists').select('*').order('list_key', { ascending: true }),
    admin.from('profiles').select('id, full_name').eq('role', 'customer').eq('status', 'active').order('full_name'),
  ])
  const watchlists: WatchlistRow[] = (data ?? []).map(w => ({
    list_key: w.list_key,
    name: w.name,
    symbols: Array.isArray(w.symbols) ? w.symbols : [],
  }))

  const customerOptions: CustomerOption[] = (customers ?? []).map((c: any) => ({
    id: c.id as string,
    name: c.full_name as string,
  }))

  return (
    <div>
      <PageHeader title="Watchlists" subtitle="Platform-wide symbol lists used by strategy templates" />
      <SectionCard>
        <WatchlistsClient watchlists={watchlists} customers={customerOptions} />
      </SectionCard>
    </div>
  )
}
