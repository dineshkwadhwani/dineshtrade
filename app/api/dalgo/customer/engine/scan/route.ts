// POST /api/dalgo/customer/engine/scan
// Runs a manual strategy scan using the customer's Kite credentials and their
// strategy config from Supabase. Primary customer's token is used for market
// data (Connect plan quotes); customer's own token is used for order placement.
//
// Pattern mirrors lib/cron.ts::runCustomerTick — withCustomer scopes the state
// context so getState().kiteTokens returns this customer's token, and
// rehydrateForCustomer() loads their strategy config from customer_strategies.

import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (profile.role === 'customer' && profile.status !== 'active') return NextResponse.json({ error: 'Account not active.' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const isPrivileged = profile.role === 'superadmin' || profile.role === 'account_manager'
    // SA/AM can run scan for any customer; customers run for themselves
    const targetCustomerId: string = isPrivileged && typeof body.targetCustomerId === 'string'
      ? body.targetCustomerId
      : profile.id

    // Primary customer supplies market data (paid Kite Connect plan for live quotes)
    const primaryCustomerId = (process.env.CUSTOMER_IDS || '').split(',')[0]?.trim() || profile.id
    const primaryCreds = await loadBrokerAccountCreds(primaryCustomerId)

    if (!primaryCreds) {
      return NextResponse.json({
        error: 'Primary account Kite not connected. Live quotes unavailable.',
        recommendations: [],
        mode: 'error',
        generatedAt: new Date().toISOString(),
      })
    }

    const env = process.env.ZERODHA_ENVIRONMENT === 'PROD' ? 'PROD' : 'TEST'
    const primaryAccountName = process.env[`${env}_ZERODHA_ACCOUNT1`] || 'DINESH'

    let result: Awaited<ReturnType<typeof generateRecommendations>>

    // Scope to target customer: their strategy config + watchlists,
    // primary account's token for live quote data.
    await withCustomer(targetCustomerId, async () => {
      // Seed state.kiteTokens with primary's token so firstConnectedCreds()
      // inside strategyEngine.ts finds a valid Kite connection.
      await saveState({ kiteTokens: { [primaryAccountName]: primaryCreds.accessToken } })
      // Load this customer's strategy config from Supabase into the sync cache.
      await rehydrateForCustomer()
      result = await generateRecommendations()
    })

    // Journal the manual scan
    const res = result!
    appendJournal({
      type: 'strategy_scan',
      date: istDateString(),
      ts: new Date().toISOString(),
      strategyId: res.mode,
      strategyName: `Manual scan (${res.mode})`,
      recs: res.recommendations.length,
      executed: 0,
      symbols: res.recommendations.length > 0 ? res.recommendations.map(r => r.symbol) : undefined,
      skipReason: res.message,
    }).catch(() => {})

    const capital = getCapital()
    return NextResponse.json({
      mode: res.mode,
      recommendations: res.recommendations,
      message: res.message,
      giftChangePct: res.giftChangePct,
      generatedAt: res.generatedAt,
      limits: {
        buyCap: capital.maxBuysPerDay,
        sellCap: capital.maxSellsPerDay,
      },
    })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[engine/scan] error:', err)
    return NextResponse.json({
      error: 'Scan failed: ' + String(err),
      recommendations: [],
      mode: 'error',
      generatedAt: new Date().toISOString(),
    })
  }
}
