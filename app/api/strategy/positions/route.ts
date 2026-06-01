// GET /api/strategy/positions — returns the unified position store contents
// (data/positions.json) annotated with each row's strategy display name + color.
// Used by the Holdings page to label every holding with its actual strategy
// (CATALYST, MARKET BOOM, ACCUMULATOR, etc.) rather than only flagging S1 rows.
//
// Fallback: for symbols that were auto-bought but are no longer in the positions
// store (manually sold → store entry cleared by a prior reconcile run), the
// journal's most recent auto-BUY is used to supply the strategy tag. This ensures
// sold positions continue to show their buying strategy (e.g. ACCUMULATOR) rather
// than OOS on the Holdings page.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { listPositions } from '@/lib/positions'
import { getStrategies } from '@/lib/strategyConfig'
import { readJournalRange, istDateString } from '@/lib/journal'

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
      strategyType: s?.type,
      firstBuyPrice: p.firstBuyPrice,
      firstBuyAt: p.firstBuyAt,
      totalQty: p.totalQty,
      remainingQty: p.remainingQty,
      tranche1At: p.tranche1At,
      tranche1SoldQty: p.tranche1SoldQty,
    }
  })

  // Journal fallback: for symbols auto-bought within the last 30 days but no
  // longer in the positions store (already sold and removed), supply the
  // strategy tag from the most recent auto-BUY journal entry so the Holdings
  // page shows the buying strategy instead of OOS.
  try {
    const positionKeys = new Set(all.map(p => `${p.account.toUpperCase()}:${p.symbol.toUpperCase()}`))
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const recentJournal = await readJournalRange(thirtyDaysAgo, istDateString())
    // Most recent auto-BUY per account:symbol
    const latestAutoBuy = new Map<string, { strategyId: string; ts: string }>()
    for (const r of recentJournal) {
      if (r.type !== 'order' || (r as any).side !== 'BUY' || (r as any).source !== 'auto') continue
      const sid = (r as any).strategyId as string | undefined
      if (!sid) continue
      const key = `${String((r as any).account).toUpperCase()}:${String((r as any).symbol).toUpperCase()}`
      if (positionKeys.has(key)) continue   // already in positions store
      const ts = (r as any).ts as string
      const prev = latestAutoBuy.get(key)
      if (!prev || ts > prev.ts) latestAutoBuy.set(key, { strategyId: sid, ts })
    }
    for (const [key, { strategyId }] of Array.from(latestAutoBuy)) {
      const s = strategiesById.get(strategyId)
      if (!s) continue
      const [account, symbol] = key.split(':')
      positions.push({
        account,
        symbol,
        strategyId,
        strategyName: s.name,
        strategyColor: s.color,
        strategyType: s.type,
        firstBuyPrice: 0,
        firstBuyAt: '',
        totalQty: 0,
        remainingQty: 0,
        tranche1At: undefined,
        tranche1SoldQty: undefined,
      })
    }
  } catch {
    // Journal read failure is non-fatal — fall back to positions-store-only tags
  }

  return NextResponse.json({ positions })
}
