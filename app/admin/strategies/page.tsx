export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import StrategiesClient, { type PlatformStrategyRow } from './StrategiesClient'

// Task 6.9 — Platform Strategies.
export default async function AdminStrategiesPage() {
  const admin = getSupabaseAdmin()
  const [{ data: strategies }, { data: activeCopies }] = await Promise.all([
    admin.from('platform_strategies').select('*').order('name', { ascending: true }),
    admin.from('customer_strategies').select('platform_strategy_id').eq('active', true),
  ])

  const countByPlatformId = new Map<string, number>()
  for (const row of activeCopies ?? []) {
    if (!row.platform_strategy_id) continue
    countByPlatformId.set(row.platform_strategy_id, (countByPlatformId.get(row.platform_strategy_id) ?? 0) + 1)
  }

  const rows: PlatformStrategyRow[] = (strategies ?? []).map(s => ({
    id: s.id,
    name: s.name,
    type: s.type,
    published: s.published,
    scan_interval_min: s.scan_interval_min,
    params: s.params,
    exits: s.exits,
    gift_nifty_gate: s.gift_nifty_gate,
    activeCustomerCount: countByPlatformId.get(s.id) ?? 0,
  }))

  return (
    <div>
      <PageHeader title="Platform Strategies" subtitle="Manage strategy templates offered to customers" />
      <SectionCard>
        <StrategiesClient strategies={rows} />
      </SectionCard>
    </div>
  )
}
