// GET  /api/dalgo/admin/reconcile?customerId=xxx — check if sync is needed
// POST /api/dalgo/admin/reconcile { customerId } — trigger reconciliation

import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { loadBrokerAccountCreds, getHoldings } from '@/lib/kite'
import { withCustomer } from '@/lib/supabase'
import { saveState } from '@/lib/state'
import { rehydrateForCustomer } from '@/lib/strategyConfigStore'
import { reconcileManualSells } from '@/lib/cronReconcile'

export const dynamic = 'force-dynamic'

function isPrivilegedRole(role: string) {
  return role === 'superadmin' || role === 'account_manager' || role === 'broking_company'
}

/** GET: compare Kite holdings vs customer_positions to detect discrepancies */
export async function GET(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile || !isPrivilegedRole(profile.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const customerId = new URL(req.url).searchParams.get('customerId') || ''
    if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 })

    const admin = getSupabaseAdmin()
    const primaryCustomerId = (process.env.CUSTOMER_IDS || '').split(',')[0]?.trim() || customerId

    const [{ data: trackedPositions }, primaryCreds] = await Promise.all([
      admin.from('customer_positions').select('symbol').eq('customer_id', customerId).eq('status', 'open'),
      loadBrokerAccountCreds(primaryCustomerId),
    ])

    const trackedSymbols = new Set((trackedPositions ?? []).map((p: any) => p.symbol.toUpperCase()))

    // Use primary account's creds to fetch this customer's holdings (if customer token expired)
    const customerCreds = await loadBrokerAccountCreds(customerId)
    const creds = customerCreds ?? primaryCreds
    if (!creds) {
      return NextResponse.json({ inSync: null, error: 'No Kite credentials available to check' })
    }

    const kiteHoldings = await getHoldings(creds).catch(() => null)
    if (!kiteHoldings) {
      return NextResponse.json({ inSync: null, error: 'Could not reach Kite API' })
    }

    const kiteSymbols = new Set(
      kiteHoldings.filter(h => (h.quantity + (h.t1_quantity ?? 0)) > 0).map(h => h.tradingsymbol.toUpperCase())
    )

    const inKiteNotTracked = [...kiteSymbols].filter(s => !trackedSymbols.has(s))
    const trackedNotInKite = [...trackedSymbols].filter(s => !kiteSymbols.has(s))
    const inSync = inKiteNotTracked.length === 0 && trackedNotInKite.length === 0

    return NextResponse.json({
      inSync,
      kiteCount: kiteSymbols.size,
      supabaseCount: trackedSymbols.size,
      inKiteNotTracked,
      trackedNotInKite,
    })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST: trigger reconciliation for a customer */
export async function POST(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile || !isPrivilegedRole(profile.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const customerId = typeof body.customerId === 'string' ? body.customerId : ''
    if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 })

    const primaryCustomerId = (process.env.CUSTOMER_IDS || '').split(',')[0]?.trim() || customerId
    const primaryCreds = await loadBrokerAccountCreds(primaryCustomerId)
    if (!primaryCreds) return NextResponse.json({ ok: false, error: 'Primary Kite not connected' }, { status: 400 })

    const env = process.env.ZERODHA_ENVIRONMENT === 'PROD' ? 'PROD' : 'TEST'
    const primaryAccountName = process.env[`${env}_ZERODHA_ACCOUNT1`] || 'DINESH'

    await withCustomer(customerId, async () => {
      await saveState({ kiteTokens: { [primaryAccountName]: primaryCreds.accessToken } })
      await rehydrateForCustomer()
      await reconcileManualSells()
    })

    return NextResponse.json({ ok: true, message: 'Reconciliation completed' })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[admin/reconcile] error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
