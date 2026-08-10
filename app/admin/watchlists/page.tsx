export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import WatchlistsClient, { type WatchlistRow } from './WatchlistsClient'

// Task 6.15 — Platform Watchlists.
export default async function AdminWatchlistsPage() {
  const admin = getSupabaseAdmin()
  const { data } = await admin.from('platform_watchlists').select('*').order('list_key', { ascending: true })
  const watchlists: WatchlistRow[] = (data ?? []).map(w => ({
    list_key: w.list_key,
    name: w.name,
    symbols: Array.isArray(w.symbols) ? w.symbols : [],
  }))

  return (
    <div>
      <PageHeader title="Watchlists" subtitle="Platform-wide symbol lists used by strategy templates" />
      <SectionCard>
        <WatchlistsClient watchlists={watchlists} />
      </SectionCard>
    </div>
  )
}
