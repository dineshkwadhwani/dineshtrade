export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import ConfigClient, { type ConfigRow } from './ConfigClient'
import NotificationsConfig from './NotificationsConfig'
import HolidayManager, { type HolidayRow } from './HolidayManager'
import BrokerSourceManager, { type BrokerSourceRow } from './BrokerSourceManager'

const FEATURE_KEYS = [
  'SUREPASS_KYC_ENABLED',
  'SMS_OTP_ENABLED',
  'STRATEGY_SCAN_DB_ENABLED',
  'HEARTBEAT_DB_ENABLED',
]
const NOTIFICATION_KEYS = ['TOKEN_ALERT_TIME_IST', 'SUPPORT_EMAIL', 'SKIP_TRADE_MAILS']
const ALL_KEYS = [...FEATURE_KEYS, ...NOTIFICATION_KEYS]

export default async function AdminConfigPage() {
  const admin = getSupabaseAdmin()
  const [{ data: configData }, { data: holidayData }, { data: brokerData }] = await Promise.all([
    admin.from('platform_config').select('*').in('key', ALL_KEYS),
    admin.from('platform_holidays').select('*').eq('market', 'NSE').order('holiday_date', { ascending: true }),
    admin.from('platform_broker_sources').select('*').order('display_order', { ascending: true }).order('name', { ascending: true }),
  ])
  const byKey = new Map<string, ConfigRow>((configData ?? []).map(row => [row.key, row as ConfigRow]))
  const featureConfigs: ConfigRow[] = FEATURE_KEYS.map(k => byKey.get(k)).filter((c): c is ConfigRow => !!c)
  const notifConfigs: ConfigRow[]   = NOTIFICATION_KEYS.map(k => byKey.get(k)).filter((c): c is ConfigRow => !!c)
  const holidays: HolidayRow[] = (holidayData ?? [])
    .filter((r: any) => r && typeof r.id === 'string')
    .map((r: any) => ({
      id: String(r.id),
      market: String(r.market ?? 'NSE'),
      holiday_date: String(r.holiday_date ?? ''),
      name: String(r.name ?? ''),
      notes: r.notes == null ? null : String(r.notes),
      active: !!r.active,
    }))
    .filter(r => !!r.holiday_date && !!r.name)

  const brokerSources: BrokerSourceRow[] = (brokerData ?? [])
    .filter((r: any) => r && typeof r.id === 'string')
    .map((r: any) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      url: String(r.url ?? ''),
      notes: r.notes == null ? null : String(r.notes),
      active: !!r.active,
      display_order: Number.isFinite(r.display_order) ? Number(r.display_order) : 100,
    }))
    .filter(r => !!r.name && !!r.url)

  return (
    <div>
      <PageHeader title="Platform Config" subtitle="Feature flags and platform-wide settings — changes take effect immediately" />
      <SectionCard>
        <ConfigClient configs={featureConfigs} />
      </SectionCard>
      <div style={{ height: 12 }} />
      <SectionCard>
        <NotificationsConfig configs={notifConfigs} />
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
