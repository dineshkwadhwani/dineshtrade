// POST /api/strategy/tiles?account=DINESH
// Returns the full-scan tile view for the Engine page — every List A stock
// evaluated against all 8 rules of both Strategy 1 (Oscillator) and
// Strategy 2 (Catalyst), with per-rule pass/fail. Joins with the given
// account's current holdings so each tile knows if it should render a SELL
// button + qty/avg/pnl. Underlying scan logic is unchanged from what the
// cron uses — this endpoint only exposes the per-rule results that the cron
// already computes internally.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { evaluateAllForTiles, type Tile } from '@/lib/strategyEngine'
import { loadCustomerBroker } from '@/lib/broker/customer'
import type { BrokerHolding } from '@/lib/broker'

export const dynamic = 'force-dynamic'
type Holding = BrokerHolding

interface TileWithHolding extends Tile {
  holding?: { qty: number; avgPrice: number; pnl: number }
}

export async function POST(req: Request) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const account = new URL(req.url).searchParams.get('account')

  // Holdings join — best-effort. If account isn't provided or call fails, tiles
  // simply render without holding annotation (no SELL button).
  let heldBySymbol = new Map<string, Holding>()
  let customerBroker: Awaited<ReturnType<typeof loadCustomerBroker>> = null
  if (account) {
    customerBroker = await loadCustomerBroker(account).catch(() => null)
    if (customerBroker) {
      const holdings = await customerBroker.broker.getHoldings().catch(() => [] as Holding[])
      for (const h of holdings) heldBySymbol.set(h.symbol.toUpperCase(), h)
    }
  }

  const result = await evaluateAllForTiles(customerBroker?.broker)

  function annotateHolding(tile: Tile): TileWithHolding {
    const h = heldBySymbol.get(tile.symbol)
    if (!h) return tile
    // Sum settled + T+1-in-settlement qty so same-day buys still show on tiles.
    const qty = (h.quantity || 0) + (h.t1Quantity || 0)
    return {
      ...tile,
      holding: {
        qty,
        avgPrice: h.averagePrice,
        // Recompute pnl from the tile's live LTP so it matches what the row
        // displays (same approach as the Positions page fix).
        pnl: qty * (tile.ltp - h.averagePrice),
      },
    }
  }

  return NextResponse.json({
    ...result,
    catalyst: result.catalyst.map(annotateHolding),
    oscillator: result.oscillator.map(annotateHolding),
    fetchedAt: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
