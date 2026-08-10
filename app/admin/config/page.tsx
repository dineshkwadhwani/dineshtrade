export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import ConfigClient, { type ConfigRow } from './ConfigClient'

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
  const { data } = await admin.from('platform_config').select('*').in('key', VISIBLE_KEYS)
  const byKey = new Map<string, ConfigRow>((data ?? []).map(row => [row.key, row as ConfigRow]))
  const configs: ConfigRow[] = VISIBLE_KEYS.map(k => byKey.get(k)).filter((c): c is ConfigRow => !!c)

  return (
    <div>
      <PageHeader title="Platform Config" subtitle="Feature flags and platform-wide settings — changes take effect immediately" />
      <SectionCard>
        <ConfigClient configs={configs} />
      </SectionCard>
    </div>
  )
}
