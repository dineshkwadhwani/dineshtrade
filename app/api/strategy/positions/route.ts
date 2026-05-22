// GET /api/strategy/positions — returns the unified position store contents
// (data/positions.json) annotated with each row's strategy display name + color.
// Used by the Holdings page to label every holding with its actual strategy
// (CATALYST, MARKET BOOM, ACCUMULATOR, etc.) rather than only flagging S1 rows.
//
// Pre-refactor this endpoint returned only Strategy 1 (accumulator) positions,
// causing the Holdings UI to label every momentum BUY as "OOS" even though the
// engine was still managing them. The new shape exposes every stored row so the
// caller can render the correct badge.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { listPositions } from '@/lib/positions'
import { getStrategies } from '@/lib/strategyConfig'

export async function GET() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const all = await listPositions()
  const strategiesById = new Map(getStrategies().map(s => [s.id, s]))
  const positions = all.map(p => {
    const s = strategiesById.get(p.strategyId)
    return {
      account: p.account,
      symbol: p.symbol,
      strategyId: p.strategyId,
      strategyName: s?.name || p.strategyId,
      strategyColor: s?.color || '#c9a84c',
      strategyType: s?.type,                  // 'dip' | 'momentum' (undefined if strategy deleted)
      firstBuyPrice: p.firstBuyPrice,
      firstBuyAt: p.firstBuyAt,
      totalQty: p.totalQty,
      remainingQty: p.remainingQty,
      tranche1At: p.tranche1At,
      tranche1SoldQty: p.tranche1SoldQty,
    }
  })
  return NextResponse.json({ positions })
}
