// Strategy 2 position registry — thin facade over the unified `lib/positions.ts`
// store. Kept around so existing callers (cron, /api/zerodha, strategy2.ts
// monitor, retrospective) don't need to change. New code should import from
// `lib/positions.ts` directly.
//
// Note: legacy callers thought of these positions as "S2/catalyst only". After
// the universal-parking-lot refactor, EVERY momentum-type strategy's positions
// live in the same store; the catalyst-specific helper here filters to
// catalyst's strategyId for backward compatibility.

import * as positions from './positions'

export interface S2Position {
  firstBuyAt: string
  firstBuyPrice: number
  totalQty: number
  remainingQty: number
  tranche1At?: string | null
  tranche1SoldQty?: number
}

export interface S2PositionWithKey extends S2Position {
  account: string
  symbol: string
  strategyId: string             // NEW — exposed so callers can branch on it
}

export async function recordStrategy2Buy(account: string, symbol: string, qty: number, price: number): Promise<void> {
  // Legacy callers default to 'catalyst'. The /api/zerodha order path will be
  // updated to pass an explicit strategyId; this remains the safe fallback.
  await positions.recordBuy('catalyst', account, symbol, qty, price)
}

export async function markTranche1Sold(account: string, symbol: string, soldQty: number): Promise<void> {
  await positions.markTranche1Sold(account, symbol, soldQty)
}

export async function removeStrategy2Position(account: string, symbol: string): Promise<void> {
  await positions.removePosition(account, symbol)
}

// Returns all momentum-tagged positions (any strategyId whose type is 'momentum').
// Note: filtering by `type` requires reading the strategy config, so callers
// that need *exactly catalyst-tagged* positions should filter on strategyId
// themselves. The retrospective + monitor both want "all momentum positions",
// which is what we return.
export async function listStrategy2Positions(): Promise<S2PositionWithKey[]> {
  const { getStrategies } = await import('./strategyConfig')
  const momentumIds = new Set(getStrategies().filter(s => s.type === 'momentum').map(s => s.id))
  const all = await positions.listPositions()
  return all
    .filter(p => momentumIds.has(p.strategyId))
    .map(p => ({
      account: p.account,
      symbol: p.symbol,
      strategyId: p.strategyId,
      firstBuyAt: p.firstBuyAt,
      firstBuyPrice: p.firstBuyPrice,
      totalQty: p.totalQty,
      remainingQty: p.remainingQty,
      tranche1At: p.tranche1At,
      tranche1SoldQty: p.tranche1SoldQty,
    }))
}

export const ageInCalendarDays = positions.ageInCalendarDays
