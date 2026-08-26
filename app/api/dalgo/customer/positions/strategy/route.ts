// PATCH /api/dalgo/customer/positions/strategy
// Changes the strategy tag on an open position.
// Body: { symbol: string; strategyId: string; targetCustomerId?: string }

import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin, withCustomer } from '@/lib/supabase'
import { setStrategyId } from '@/lib/positions'
import { rehydrateForCustomer } from '@/lib/strategyConfigStore'
import { getPrimaryCustomerId } from '@/lib/accounts'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }

  const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
  const newStrategyId = typeof body.strategyId === 'string' ? body.strategyId.trim() : ''
  if (!symbol) return NextResponse.json({ error: 'symbol is required.' }, { status: 400 })
  if (!newStrategyId) return NextResponse.json({ error: 'strategyId is required.' }, { status: 400 })

  const isPrivileged = profile.role === 'superadmin' || profile.role === 'account_manager'
  const targetCustomerId = isPrivileged && typeof body.targetCustomerId === 'string'
    ? body.targetCustomerId : profile.id

  return withCustomer(targetCustomerId, async () => {
    await rehydrateForCustomer()

    // 'manual' is a reserved pseudo-strategy (not a customer_strategies row) —
    // tells the cron engine to leave this position alone entirely (no auto
    // BUY pyramiding, no exit monitoring). Always valid; skip the lookup.
    if (newStrategyId !== 'manual') {
      // Validate against customer_strategies (any registered strategy key is valid, active or not)
      const admin = getSupabaseAdmin()
      const { data: rows } = await admin
        .from('customer_strategies')
        .select('strategy_key')
        .eq('customer_id', targetCustomerId)
      const validKeys = new Set((rows ?? []).map((r: any) => r.strategy_key as string))

      if (!validKeys.has(newStrategyId)) {
        return NextResponse.json({ error: `Unknown strategy: ${newStrategyId}` }, { status: 400 })
      }
    }

    const account = getPrimaryCustomerId()

    // capture prior strategy for audit
    const { getPosition } = await import('@/lib/positions')
    const beforePos = await getPosition(account, symbol)
    const beforeStrategy = beforePos ? beforePos.strategyId : null

    let changed = await setStrategyId(account, symbol, newStrategyId, { restampLots: true }, { id: profile.id, role: profile.role, full_name: profile.full_name })

    if (!changed) {
      // Position not in store — if Kite qty/price provided, create it now
      const kiteQty = typeof body.kiteQty === 'number' ? body.kiteQty : 0
      const kiteAvgPrice = typeof body.kiteAvgPrice === 'number' ? body.kiteAvgPrice : 0
      if (kiteQty > 0 && kiteAvgPrice > 0) {
        const { recordBuy } = await import('@/lib/positions')
        await recordBuy(newStrategyId, account, symbol, kiteQty, kiteAvgPrice)
        changed = true
      } else {
        return NextResponse.json({ error: `Position not found in DAlgo store for ${symbol}. Reload and try again.` }, { status: 404 })
      }
    }

    return NextResponse.json({ ok: true, symbol, strategyId: newStrategyId })
  })
}
