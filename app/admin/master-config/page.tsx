export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { PageHeader } from '@/components/dalgo/ui'
import MasterConfigClient from './MasterConfigClient'
import FixedRulesClient, { type FixedRuleRow } from '../fixed-rules/FixedRulesClient'
import StrategiesClient, { type PlatformStrategyRow, type CustomerOption } from '../strategies/StrategiesClient'
import SharedCapitalTab from './SharedCapitalTab'

const CAPITAL_DEFAULTS_KEY = 'PLATFORM_CAPITAL_DEFAULTS'

export default async function AdminMasterConfigPage() {
  const admin = getSupabaseAdmin()

  const [
    { data: rules }, { data: strategies }, { data: activeCopies }, { data: customers },
    { data: capitalDefaultRow }, { data: updaters },
  ] = await Promise.all([
    admin.from('platform_fixed_rules').select('*').order('rule_name', { ascending: true }),
    admin.from('platform_strategies').select('*').order('name', { ascending: true }),
    admin.from('customer_strategies').select('platform_strategy_id').eq('active', true),
    admin.from('profiles').select('id, full_name').eq('role', 'customer').eq('status', 'active').order('full_name'),
    admin.from('platform_config').select('value').eq('key', CAPITAL_DEFAULTS_KEY).maybeSingle(),
    admin.from('profiles').select('id, full_name'),
  ])

  const nameById = new Map((updaters ?? []).map((u: any) => [u.id, u.full_name]))
  const fixedRuleRows: FixedRuleRow[] = (rules ?? []).map((r: any) => ({
    id: r.id, rule_key: r.rule_key, rule_name: r.rule_name, description: r.description,
    value: r.value, value_type: r.value_type, warning_message: r.warning_message,
    updated_at: r.updated_at, updatedByName: r.updated_by ? nameById.get(r.updated_by) ?? null : null,
  }))

  const countByPlatformId = new Map<string, number>()
  for (const row of activeCopies ?? []) {
    if (!row.platform_strategy_id) continue
    countByPlatformId.set(row.platform_strategy_id, (countByPlatformId.get(row.platform_strategy_id) ?? 0) + 1)
  }
  const strategyRows: PlatformStrategyRow[] = (strategies ?? []).map((s: any) => ({
    id: s.id, name: s.name, type: s.type, published: s.published,
    scan_interval_min: s.scan_interval_min, params: s.params, exits: s.exits,
    gift_nifty_gate: s.gift_nifty_gate, activeCustomerCount: countByPlatformId.get(s.id) ?? 0,
  }))
  const customerOptions: CustomerOption[] = (customers ?? []).map((c: any) => ({ id: c.id, name: c.full_name }))

  // Parse stored capital defaults; fall back to schema defaults if not set yet
  let capitalDefaults: Record<string, number> = {
    per_trade: 5000, max_buys_per_day: 3, max_sells_per_day: 10, max_positions: 10,
    max_buys_per_symbol: 3, min_drop_between_buys_pct: 10, max_deploy_pct: 80,
    delivery_dp_charge: 15.34, circuit_breaker_pct: -5,
    intraday_circuit_trip_pct: -3, intraday_circuit_resume_pct: -2,
    panic_drop_pct: 0, panic_window_min: 0,
  }
  if (capitalDefaultRow?.value) {
    try { capitalDefaults = { ...capitalDefaults, ...JSON.parse(capitalDefaultRow.value) } } catch {}
  }

  return (
    <div>
      <PageHeader title="Master Config" subtitle="Platform-wide rules, strategy templates, and capital defaults applied to every customer" />
      <MasterConfigClient
        fixedRulesTab={<FixedRulesClient rules={fixedRuleRows} />}
        strategiesTab={<StrategiesClient strategies={strategyRows} customers={customerOptions} />}
        sharedCapitalTab={<SharedCapitalTab defaults={capitalDefaults} configKey={CAPITAL_DEFAULTS_KEY} />}
      />
    </div>
  )
}
