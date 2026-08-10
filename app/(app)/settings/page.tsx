export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { getProfile } from '@/lib/dalgoAuth'
import { decrypt } from '@/lib/encryption'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const sessionProfile = await getProfile()
  if (!sessionProfile) return null
  const customerId = sessionProfile.id
  const admin = getSupabaseAdmin()
  const env = process.env.ZERODHA_ENVIRONMENT === 'PROD' ? 'PROD' : 'TEST'
  const primaryAccount = process.env[`${env}_ZERODHA_ACCOUNT1`] || 'DINESH'
  const apiKey = process.env[`${env}_ZERODHA_API_KEY_${primaryAccount}`] || ''

  const [brokerRes, stateRes, strategiesRes, capitalRes, fixedRulesRes, watchlistRes] = await Promise.all([
    admin.from('broker_accounts').select('api_key_enc, access_token_enc, token_captured_at').eq('customer_id', customerId).eq('broker_name', 'zerodha').maybeSingle(),
    admin.from('customer_state').select('cron_mode').eq('customer_id', customerId).maybeSingle(),
    admin.from('customer_strategies').select('id, name, type, active, scan_interval_min, color, watchlist_keys, strategy_key, params, exits, gift_nifty_gate').eq('customer_id', customerId).order('name'),
    admin.from('customer_capital_config').select('*').eq('customer_id', customerId).maybeSingle(),
    admin.from('platform_fixed_rules').select('rule_key, value, description, rule_name').order('rule_key'),
    admin.from('customer_watchlists').select('list_key, name, symbols').eq('customer_id', customerId).order('list_key'),
  ])

  const broker = brokerRes.data
  let savedApiKey = ''
  let isConnected = false
  if (broker?.api_key_enc) {
    try {
      const full = decrypt(broker.api_key_enc)
      savedApiKey = full.slice(0, 4) + '••••' + full.slice(-4)
    } catch { /* ignore */ }
  }
  if (broker?.access_token_enc) {
    isConnected = true
  }

  const cronMode = stateRes.data?.cron_mode ?? 'manual'
  const strategies = strategiesRes.data ?? []
  const capitalConfig = capitalRes.data
  const fixedRules = fixedRulesRes.data ?? []
  const watchlists = (watchlistRes.data ?? []).map(r => ({ ...r, symbols: Array.isArray(r.symbols) ? r.symbols : [] }))

  return (
    <SettingsClient
      savedApiKey={savedApiKey}
      isConnected={isConnected}
      tokenCapturedAt={broker?.token_captured_at ?? null}
      cronMode={cronMode}
      kiteLoginUrl={`/api/dalgo/setup/kite-login`}
      strategies={strategies}
      capitalConfig={capitalConfig}
      fixedRules={fixedRules}
      watchlists={watchlists}
    />
  )
}
