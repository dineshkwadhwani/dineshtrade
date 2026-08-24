// POST /api/dalgo/customer/engine/tiles
// Evaluates every watchlist symbol against every strategy rule for the
// logged-in customer, returning per-rule pass/fail tiles grouped by strategy.
// Works at any time — uses Kite's last_price (valid after-hours) + daily closes
// cache for prevClose, so tiles evaluate correctly when market is closed.
// SA/AM pass targetCustomerId in request body to run for any customer.

import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { loadBrokerAccountCreds, getHoldings } from '@/lib/kite'
import { withCustomer } from '@/lib/supabase'
import { saveState } from '@/lib/state'
import { rehydrateForCustomer } from '@/lib/strategyConfigStore'
import { evaluateAllForTiles, type Tile } from '@/lib/strategyEngine'
import { getPrimaryCustomerId } from '@/lib/accounts'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (profile.role === 'customer' && profile.status !== 'active') return NextResponse.json({ error: 'Account not active.' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const isPrivileged = profile.role === 'superadmin' || profile.role === 'account_manager'
    const targetCustomerId: string = isPrivileged && typeof body.targetCustomerId === 'string'
      ? body.targetCustomerId
      : profile.id

    // Primary customer supplies market data (paid Kite Connect plan)
    const primaryCustomerId = getPrimaryCustomerId()
    const primaryCreds = await loadBrokerAccountCreds(primaryCustomerId)

    if (!primaryCreds) {
      return NextResponse.json({ error: 'Primary account Kite not connected.', tilesByStrategy: {}, activeStrategies: [] })
    }

    const primaryAccountName = primaryCustomerId

    // Customer's own creds for holdings annotation (best-effort)
    const customerCreds = await loadBrokerAccountCreds(targetCustomerId)

    let result: Awaited<ReturnType<typeof evaluateAllForTiles>>
    let holdings: Awaited<ReturnType<typeof getHoldings>> = []

    await withCustomer(targetCustomerId, async () => {
      await saveState({ kiteTokens: { [primaryAccountName]: primaryCreds.accessToken } })
      await rehydrateForCustomer()
      ;[result, holdings] = await Promise.all([
        evaluateAllForTiles(primaryCreds),
        customerCreds ? getHoldings(customerCreds).catch(() => []) : Promise.resolve([]),
      ])
    })

    const res = result!
    const heldBySymbol = new Map(holdings.map(h => [h.tradingsymbol.toUpperCase(), h]))

    function annotate(tile: Tile) {
      const h = heldBySymbol.get(tile.symbol)
      if (!h) return tile
      const qty = (h.quantity || 0) + (h.t1_quantity || 0)
      return {
        ...tile,
        holding: {
          qty,
          avgPrice: h.average_price,
          pnl: qty * (tile.ltp - h.average_price),
        },
      }
    }

    const tilesByStrategy: Record<string, ReturnType<typeof annotate>[]> = {}
    for (const [stratId, tiles] of Object.entries(res.tilesByStrategy)) {
      tilesByStrategy[stratId] = tiles.map(annotate)
    }

    return NextResponse.json({
      tilesByStrategy,
      activeStrategies: res.activeStrategies,
      recommendedTab: res.recommendedTab,
      giftChangePct: res.giftChangePct,
      catalystScanOpen: res.catalystScanOpen,
      generatedAt: res.generatedAt,
      dataHealth: res.dataHealth,
    })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[engine/tiles] error:', err)
    return NextResponse.json({ error: 'Tiles failed: ' + String(err), tilesByStrategy: {}, activeStrategies: [] })
  }
}
