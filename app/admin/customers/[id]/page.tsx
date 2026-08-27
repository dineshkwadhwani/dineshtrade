export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { getCustomerFullDetail, listAccountManagers } from '@/lib/dalgoAdmin'
import { getSupabaseAdmin } from '@/lib/supabase'
import { PageHeader } from '@/components/dalgo/ui'
import CustomerDetailClient from './CustomerDetailClient'
import SettingsClient from '@/app/(app)/settings/SettingsClient'

export default async function AdminCustomerDetailPage({ params }: { params: { id: string } }) {
  const admin = getSupabaseAdmin()
  const customerId = params.id

  const [detail, managers, brokerRes, stateRes, strategiesRes, capitalRes, fixedRulesRes, watchlistRes, platformConfigRes] = await Promise.all([
    getCustomerFullDetail(customerId),
    listAccountManagers(),
    admin.from('broker_accounts').select('api_key_enc, api_secret_enc, access_token_enc, token_captured_at').eq('customer_id', customerId).eq('broker_name', 'zerodha').maybeSingle(),
    admin.from('customer_state').select('cron_mode').eq('customer_id', customerId).maybeSingle(),
    admin.from('customer_strategies').select('id, name, type, active, scan_interval_min, color, watchlist_keys, strategy_key, params, exits, gift_nifty_gate').eq('customer_id', customerId).order('name'),
    admin.from('customer_capital_config').select('*').eq('customer_id', customerId).maybeSingle(),
    admin.from('platform_fixed_rules').select('rule_key, value, description, rule_name').order('rule_key'),
    admin.from('customer_watchlists').select('list_key, name, symbols').eq('customer_id', customerId).order('list_key'),
    admin.from('platform_config').select('key, value').in('key', ['SKIPPED_EMAILS_ENABLED','SKIPPED_EMAILS_TO']),
  ])

  if (!detail) notFound()

  const cronMode = stateRes.data?.cron_mode ?? 'manual'
  const strategies = strategiesRes.data ?? []
  const watchlists = (watchlistRes.data ?? []).map(r => ({ ...r, symbols: Array.isArray(r.symbols) ? r.symbols : [] }))
  const broker = brokerRes.data
  let savedApiKey = ''
  let savedApiSecret = ''
  let isConnected = false
  if (broker?.api_key_enc) {
    try {
      const { decrypt } = await import('@/lib/encryption')
      const full = decrypt(broker.api_key_enc)
      savedApiKey = full.slice(0, 4) + '••••' + full.slice(-4)
    } catch { /* ignore */ }
  }
  if (broker?.api_secret_enc) {
    try {
      const { decrypt } = await import('@/lib/encryption')
      const full = decrypt(broker.api_secret_enc)
      savedApiSecret = full.slice(0, 4) + '••••' + full.slice(-4)
    } catch { /* ignore */ }
  }
  if (broker?.access_token_enc) isConnected = true

  return (
    <div>
      <PageHeader title={detail.profile.full_name} subtitle={detail.profile.email} />
      <CustomerDetailClient
        detail={detail}
        accountManagers={managers.map(m => ({ id: m.id, full_name: m.full_name }))}
        canActivate
        canEditCapital
      />

      {/* Customer settings — admin can manage on behalf */}
      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: 16, fontWeight: 700, color: '#1E3A8A', margin: '0 0 16px', padding: '0 0 10px', borderBottom: '1px solid #BFDBFE' }}>
          Customer Settings (acting on behalf)
        </h2>
        <SettingsClient
          savedApiKey={savedApiKey}
          savedApiSecret={savedApiSecret}
          isConnected={isConnected}
          tokenCapturedAt={broker?.token_captured_at ?? null}
          cronMode={cronMode}
          kiteLoginUrl={`/api/dalgo/setup/kite-login`}
          strategies={strategies}
          capitalConfig={capitalRes.data}
          fixedRules={fixedRulesRes.data ?? []}
          watchlists={watchlists}
          platformConfig={platformConfigRes.data ?? []}
          targetCustomerId={customerId}
        />
      </div>
    </div>
  )
}
