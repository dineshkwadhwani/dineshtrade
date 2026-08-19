// GET /api/dalgo/admin/health/customers
// Returns health data for all customers visible to the caller:
//   SA → all active customers
//   AM → assigned customers only
//   BC → their customers only
// Fetches Kite margins in parallel for connected customers.

import { NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { loadBrokerAccountCreds, kiteRequest } from '@/lib/kite'
import { decrypt } from '@/lib/encryption'
import { getPrimaryCustomerId } from '@/lib/accounts'

export const dynamic = 'force-dynamic'

function computeTokenStatus(hasToken: boolean, expiresAt: string | null): 'connected' | 'expired' | 'missing' {
  if (!hasToken) return 'missing'
  if (!expiresAt) return 'connected'
  return new Date(expiresAt) > new Date() ? 'connected' : 'expired'
}

function minutesSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

export async function GET() {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const allowed = ['superadmin', 'account_manager', 'broking_company']
    if (!allowed.includes(profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const admin = getSupabaseAdmin()

    // Build customer query based on role
    let customerQuery = admin.from('profiles').select('id, full_name, email, assigned_account_manager_id, broking_company_id')
      .eq('role', 'customer').eq('status', 'active').order('full_name')

    if (profile.role === 'account_manager') {
      customerQuery = customerQuery.eq('assigned_account_manager_id', profile.id)
    } else if (profile.role === 'broking_company') {
      customerQuery = customerQuery.eq('broking_company_id', profile.id)
    }

    const { data: customers } = await customerQuery
    if (!customers || customers.length === 0) return NextResponse.json({ customers: [] })

    const ids = customers.map(c => c.id)

    // Fetch all supporting data in parallel
    const [{ data: brokerAccounts }, { data: states }, { data: strategies }, { data: capitalConfigs }, { data: instances }] = await Promise.all([
      admin.from('broker_accounts').select('customer_id, access_token_enc, api_key_enc, token_expires_at, active')
        .in('customer_id', ids).eq('broker_name', 'zerodha').eq('active', true),
      admin.from('customer_state').select('customer_id, cron_mode').in('customer_id', ids),
      admin.from('customer_strategies').select('customer_id, active').in('customer_id', ids),
      admin.from('customer_capital_config').select('customer_id, per_trade, max_positions').in('customer_id', ids),
      admin.from('customer_instances').select('customer_id, last_cron_tick_at, last_heartbeat_at').in('customer_id', ids),
    ])

    const brokerByCustomer = new Map((brokerAccounts ?? []).map(b => [b.customer_id, b]))
    const stateByCustomer = new Map((states ?? []).map(s => [s.customer_id, s]))
    const capitalByCustomer = new Map((capitalConfigs ?? []).map(c => [c.customer_id, c]))
    const instanceByCustomer = new Map((instances ?? []).map(i => [i.customer_id, i]))

    // Count active strategies per customer
    const stratsByCustomer = new Map<string, number>()
    for (const s of strategies ?? []) {
      if (s.active) stratsByCustomer.set(s.customer_id, (stratsByCustomer.get(s.customer_id) ?? 0) + 1)
    }

    // Fetch Kite margins for connected customers in parallel (best-effort)
    const primaryAccountName = getPrimaryCustomerId()
    const envApiKey = ''  // V2: API key always comes from DB, not env

    interface MarginResult { available: number | null; invested: number | null; error?: string }
    const marginResults = await Promise.all(
      customers.map(async (c): Promise<{ customerId: string } & MarginResult> => {
        const broker = brokerByCustomer.get(c.id)
        const tokenStatus = computeTokenStatus(!!broker?.access_token_enc, broker?.token_expires_at ?? null)
        if (tokenStatus !== 'connected' || !broker) return { customerId: c.id, available: null, invested: null }
        try {
          const accessToken = decrypt(broker.access_token_enc)
          const apiKey = broker.api_key_enc
            ? (() => { try { return decrypt(broker.api_key_enc!) } catch { return envApiKey } })()
            : envApiKey
          const creds = { apiKey, accessToken }
          const [marginsR, holdingsR] = await Promise.all([
            kiteRequest<{ data?: any }>('/user/margins', creds),
            kiteRequest<{ data?: any[] }>('/portfolio/holdings', creds),
          ])
          const eq = marginsR.data?.data?.equity
          const available = eq?.available?.live_balance ?? eq?.available?.cash ?? null
          const holdings: any[] = holdingsR.data?.data ?? []
          const invested = holdings.reduce((sum, h) => {
            const qty = (h.quantity ?? 0) + (h.t1_quantity ?? 0)
            return sum + qty * (h.average_price ?? 0)
          }, 0)
          return { customerId: c.id, available: available != null ? Number(available) : null, invested }
        } catch (e) {
          return { customerId: c.id, available: null, invested: null, error: String(e).slice(0, 80) }
        }
      })
    )
    const marginByCustomer = new Map(marginResults.map(m => [m.customerId, m]))

    const result = customers.map(c => {
      const broker = brokerByCustomer.get(c.id)
      const tokenStatus = computeTokenStatus(!!broker?.access_token_enc, broker?.token_expires_at ?? null)
      const state = stateByCustomer.get(c.id)
      const capital = capitalByCustomer.get(c.id)
      const instance = instanceByCustomer.get(c.id)
      const margin = marginByCustomer.get(c.id)
      const totalConfiguredCapital = capital ? (capital.per_trade ?? 0) * (capital.max_positions ?? 0) : 0
      const heartbeatAt = instance?.last_cron_tick_at ?? instance?.last_heartbeat_at ?? null
      const heartbeatAgeMin = minutesSince(heartbeatAt)
      const heartbeatRunning = heartbeatAgeMin !== null && heartbeatAgeMin <= 10
      const heartbeatComment = heartbeatRunning
        ? `Heartbeat healthy (${heartbeatAgeMin}m ago).`
        : heartbeatAt
          ? `Heartbeat stale (${heartbeatAgeMin}m ago).`
          : 'No heartbeat recorded yet.'

      let availablePct: number | null = null
      if (margin?.available != null && margin?.invested != null) {
        const total = margin.available + margin.invested
        availablePct = total > 0 ? (margin.available / total) * 100 : 100
      }

      const errors: string[] = []
      if (margin?.error) errors.push(`Kite: ${margin.error}`)
      if (!heartbeatRunning) errors.push(heartbeatComment)

      return {
        id: c.id,
        name: c.full_name,
        email: c.email,
        tokenStatus,
        tokenExpiresAt: broker?.token_expires_at ?? null,
        cronMode: state?.cron_mode ?? 'manual',
        availableFunds: margin?.available ?? null,
        availablePct,
        heartbeatRunning,
        heartbeatAt,
        heartbeatAgeMin,
        activeStrategies: stratsByCustomer.get(c.id) ?? 0,
        needsReminder: tokenStatus !== 'connected',
        comment: errors.join('; ') || null,
      }
    })

    return NextResponse.json({ customers: result })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[health/customers]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
