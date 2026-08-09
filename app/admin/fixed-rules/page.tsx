import { getSupabaseAdmin } from '@/lib/supabase'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import FixedRulesClient, { type FixedRuleRow } from './FixedRulesClient'

// Task 6.7 — Fixed Rules editor.
export default async function AdminFixedRulesPage() {
  const admin = getSupabaseAdmin()
  const { data: rules } = await admin.from('platform_fixed_rules').select('*').order('rule_name', { ascending: true })

  const updaterIds = Array.from(new Set((rules ?? []).map(r => r.updated_by).filter(Boolean)))
  const { data: updaters } = updaterIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', updaterIds)
    : { data: [] as { id: string; full_name: string }[] }
  const nameById = new Map((updaters ?? []).map(u => [u.id, u.full_name]))

  const rows: FixedRuleRow[] = (rules ?? []).map(r => ({
    id: r.id,
    rule_key: r.rule_key,
    rule_name: r.rule_name,
    description: r.description,
    value: r.value,
    value_type: r.value_type,
    warning_message: r.warning_message,
    updated_at: r.updated_at,
    updatedByName: r.updated_by ? nameById.get(r.updated_by) ?? null : null,
  }))

  return (
    <div>
      <PageHeader title="Fixed Rules" subtitle="Platform-wide engine rules — changes take effect immediately for every customer in Auto mode" />
      <SectionCard>
        <FixedRulesClient rules={rows} />
      </SectionCard>
    </div>
  )
}
