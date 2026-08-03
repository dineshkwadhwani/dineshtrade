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
import { getPosition, listPositions, setStrategyId } from '@/lib/positions'
import { getStrategies, getStrategyById } from '@/lib/strategyConfig'
import { readJournalRange, istDateString } from '@/lib/journal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const all = await listPositions()
  const strategiesById = new Map(getStrategies().map(s => [s.id, s]))
  const positions = all.map(p => {
    // Display/store owner strategy at symbol level. Mixed-lot rows are handled
    // by the holdings page for T0 entries where lot-level strategy is relevant.
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
      lots: p.lots,
    }
  })

  // Journal fallback: for symbols strategy-owned within the last 30 days but no
  // longer in the positions store (already sold and removed), supply the
  // strategy tag from the most recent strategy-owned BUY journal entry so the
  // Holdings page shows the buying strategy instead of OOS/manual drift.
  try {
    const positionKeys = new Set(all.map(p => `${p.account.toUpperCase()}:${p.symbol.toUpperCase()}`))
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const recentJournal = await readJournalRange(thirtyDaysAgo, istDateString())
    // Most recent strategy-owned BUY per account:symbol
    const latestAutoBuy = new Map<string, { strategyId: string; ts: string }>()
    for (const r of recentJournal) {
      if (r.type !== 'order' || (r as any).side !== 'BUY') continue
      const sid = (r as any).strategyId as string | undefined
      if (!sid) continue
      const key = `${String((r as any).account).toUpperCase()}:${String((r as any).symbol).toUpperCase()}`
      if (positionKeys.has(key)) continue   // already in positions store — DO NOT add journal fallback
      const ts = (r as any).ts as string
      const prev = latestAutoBuy.get(key)
      if (!prev || ts > prev.ts) latestAutoBuy.set(key, { strategyId: sid, ts })
    }
    for (const [key, { strategyId }] of Array.from(latestAutoBuy)) {
      const s = strategiesById.get(strategyId)
      if (!s) continue
      const [account, symbol] = key.split(':')
      // Ensure we don't add a duplicate if it's somehow already in positions
      const existingIdx = positions.findIndex(p => p.account === account && p.symbol === symbol)
      if (existingIdx !== -1) continue
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
        lots: undefined,
      })
    }
  } catch {
    // Journal read failure is non-fatal — fall back to positions-store-only tags
  }

  return NextResponse.json({ positions }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}

export async function POST(req: Request) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const account = typeof body.account === 'string' ? body.account.trim().toUpperCase() : ''
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
  const targetStrategyId = typeof body.targetStrategyId === 'string' ? body.targetStrategyId.trim() : ''

  if (!account) return NextResponse.json({ error: 'account is required' }, { status: 400 })
  if (!symbol) return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  if (!targetStrategyId) return NextResponse.json({ error: 'targetStrategyId is required' }, { status: 400 })

  const existing = await getPosition(account, symbol)
  if (!existing) {
    return NextResponse.json({ error: `${account}:${symbol} is not tracked in the positions store` }, { status: 404 })
  }
  const lotId = typeof body.lotId === 'string' && body.lotId.trim() ? body.lotId.trim() : undefined

  if (!lotId && existing.strategyId === targetStrategyId) {
    return NextResponse.json({ error: `${symbol} is already managed by ${targetStrategyId}` }, { status: 409 })
  }

  const target = getStrategyById(targetStrategyId)
  if (!target) {
    return NextResponse.json({ error: `Unknown strategy: ${targetStrategyId}` }, { status: 400 })
  }
  if (!target.active) {
    return NextResponse.json({ error: `${target.name} is inactive — only active strategies can own live positions` }, { status: 409 })
  }

  let changed = false
  if (lotId) {
    // Change only the lot-level strategy
    const { setLotStrategyId } = await import('@/lib/positions')
    changed = await setLotStrategyId(account, symbol, lotId, targetStrategyId)
  } else {
    changed = await setStrategyId(account, symbol, targetStrategyId)
  }
  if (!changed) {
    return NextResponse.json({ error: 'Strategy switch did not apply' }, { status: 409 })
  }

  return NextResponse.json({
    ok: true,
    account,
    symbol,
    fromStrategyId: existing.strategyId,
    toStrategyId: target.id,
    toStrategyName: target.name,
    toStrategyColor: target.color,
    message: `${symbol} is now managed by ${target.name}`,
  })
}
