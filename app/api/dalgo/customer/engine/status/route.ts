// GET /api/dalgo/customer/engine/status
// Returns customer engine state: cron mode, kite connection, capital caps,
// active strategies, market status. Used by the Engine page to render tiles.

import { NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { isMarketOpen } from '@/lib/market'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = getSupabaseAdmin()
    const targetParam = new URL(req.url).searchParams.get('targetCustomerId')
    const isPrivileged = profile.role === 'superadmin' || profile.role === 'account_manager'
    const customerId = isPrivileged && targetParam ? targetParam : profile.id

    const [stateRes, capitalRes, instanceRes, strategiesRes] = await Promise.all([
      admin.from('customer_state')
        .select('cron_mode, daily_buy_count, daily_sell_count')
        .eq('customer_id', customerId)
        .maybeSingle(),
      admin.from('customer_capital_config')
        .select('max_buys_per_day, max_sells_per_day, per_trade, max_positions')
        .eq('customer_id', customerId)
        .maybeSingle(),
      admin.from('customer_instances')
        .select('kite_token_status, cron_mode, last_cron_tick_at, todays_buy_count, todays_sell_count')
        .eq('customer_id', customerId)
        .maybeSingle(),
      admin.from('customer_strategies')
        .select('strategy_key, name, type, scan_interval_min, active')
        .eq('customer_id', customerId)
        .order('name'),
    ])

    const state = stateRes.data
    const capital = capitalRes.data
    const instance = instanceRes.data
    const strategies = strategiesRes.data ?? []

    const market = await isMarketOpen()

    // kite connection: instance row updated by heartbeat (stale in manual mode) —
    // always fall back to broker_accounts for the ground truth when not 'connected'.
    let kiteConnected = false
    if (instance?.kite_token_status === 'connected') {
      kiteConnected = true
    } else {
      // Heartbeat may be stale (manual mode) or instance row missing — check broker_accounts directly
      const { data: broker } = await admin
        .from('broker_accounts')
        .select('token_expires_at, access_token_enc')
        .eq('customer_id', customerId)
        .eq('broker_name', 'zerodha')
        .eq('active', true)
        .maybeSingle()
      kiteConnected = !!(broker?.access_token_enc) && (!broker.token_expires_at || new Date(broker.token_expires_at) > new Date())
    }

    // customer_state is the live source (settings page writes here directly);
    // customer_instances.cron_mode is only updated by heartbeat (may be stale).
    const cronMode: 'auto' | 'manual' = (state?.cron_mode ?? instance?.cron_mode ?? 'manual') as 'auto' | 'manual'
    const buysToday = instance?.todays_buy_count ?? state?.daily_buy_count ?? 0
    const sellsToday = instance?.todays_sell_count ?? state?.daily_sell_count ?? 0

    return NextResponse.json({
      cronMode,
      kiteConnected,
      marketOpen: market.open,
      marketStatus: market.status,
      buyCap: capital?.max_buys_per_day ?? 6,
      sellCap: capital?.max_sells_per_day ?? 20,
      perTrade: capital?.per_trade ?? 20000,
      maxPositions: capital?.max_positions ?? 35,
      buysToday,
      sellsToday,
      strategies: strategies.map(s => ({
        id: s.strategy_key,
        name: s.name,
        type: s.type,
        scanIntervalMin: s.scan_interval_min,
        active: s.active,
      })),
      instanceHealth: instance ? {
        lastCronTickAt: instance.last_cron_tick_at,
        kiteTokenStatus: instance.kite_token_status,
      } : null,
    })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[engine/status] error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
