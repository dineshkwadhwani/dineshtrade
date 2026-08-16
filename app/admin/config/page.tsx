export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import ConfigClient, { type ConfigRow } from './ConfigClient'
import HolidayManager, { type HolidayRow } from './HolidayManager'
import BrokerSourceManager, { type BrokerSourceRow } from './BrokerSourceManager'

// Task 6.8 — Platform Config. Only the 6 keys the spec explicitly names as
// "Configurable items shown" are rendered here — platform_config also holds
// a few display-only seed rows (DALGO_APP_NAME, the two disclaimer texts)
// that the task brief doesn't list as admin-editable on this page.
const VISIBLE_KEYS = [
  'SUREPASS_KYC_ENABLED',
  'SMS_OTP_ENABLED',
  'STRATEGY_SCAN_DB_ENABLED',
  'HEARTBEAT_DB_ENABLED',
  'TOKEN_ALERT_TIME_IST',
  'SUPPORT_EMAIL',
]

export default async function AdminConfigPage() {
  const admin = getSupabaseAdmin()
  const [{ data: configData }, { data: holidayData }, { data: brokerData }] = await Promise.all([
    admin.from('platform_config').select('*').in('key', VISIBLE_KEYS),
    admin.from('platform_holidays').select('*').eq('market', 'NSE').order('holiday_date', { ascending: true }),
    admin.from('platform_broker_sources').select('*').order('display_order', { ascending: true }).order('name', { ascending: true }),
  ])
  const byKey = new Map<string, ConfigRow>((configData ?? []).map(row => [row.key, row as ConfigRow]))
  const configs: ConfigRow[] = VISIBLE_KEYS.map(k => byKey.get(k)).filter((c): c is ConfigRow => !!c)
  const holidays: HolidayRow[] = (holidayData ?? []) as HolidayRow[]
  const brokerSources: BrokerSourceRow[] = (brokerData ?? []) as BrokerSourceRow[]

  return (
    <div>
      <PageHeader title="Platform Config" subtitle="Feature flags and platform-wide settings — changes take effect immediately" />
      <SectionCard>
        <ConfigClient configs={configs} />
      </SectionCard>
      <div style={{ height: 12 }} />
      <SectionCard>
        <HolidayManager initialHolidays={holidays} />
      </SectionCard>
      <div style={{ height: 12 }} />
      <SectionCard>
        <BrokerSourceManager initialSources={brokerSources} />
      </SectionCard>
    </div>
  )
}
