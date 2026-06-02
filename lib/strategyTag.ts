// Shared tag-resolution logic for positions UI.
// Previously duplicated between app/api/positions/route.ts (classifyTag) and
// app/api/strategy/positions/route.ts (inline). Both routes now call this.

import type { Strategy } from './strategyConfig'

export interface PositionTag {
  kind: 'strategy' | 'manual' | 'pre' | 'mixed'
  strategyId?: string
  label: string
  color: string
}

// Resolves the display tag for a symbol given:
// - journalStrategyId: from the positions store OR journal fallback (pre-resolved by caller)
// - todaysOrderTags: today's Kite order tags for this symbol (empty set if unknown)
// - strategiesById: display info map
export function resolvePositionTag(
  journalStrategyId: string | null | undefined,
  todaysOrderTags: Set<string>,
  strategiesById: Map<string, Pick<Strategy, 'name' | 'color'>>,
): PositionTag {
  const accumulator = strategiesById.get('accumulator')

  if (journalStrategyId) {
    const s = strategiesById.get(journalStrategyId)
    return {
      kind: 'strategy',
      strategyId: journalStrategyId,
      label: s?.name?.slice(0, 12) || journalStrategyId,
      color: s?.color || '#c9a84c',
    }
  }
  const hasManual = todaysOrderTags.has('dt-manual')
  const dtPrefixed = Array.from(todaysOrderTags).filter(t => t.startsWith('dt-') && t !== 'dt-manual')
  const strategyIdsFromTags = new Set<string>()
  for (const t of dtPrefixed) {
    let sid = t.slice(3).replace(/-(t1|t2|exit)$/, '')
    if (sid === 's1') sid = 'accumulator'
    else if (sid === 's2') sid = 'catalyst'
    strategyIdsFromTags.add(sid)
  }
  if (strategyIdsFromTags.size === 0 && !hasManual) {
    return {
      kind: 'strategy',
      strategyId: 'accumulator',
      label: accumulator?.name?.slice(0, 12) || 'Accumulator',
      color: accumulator?.color || '#c9a84c',
    }
  }
  if (strategyIdsFromTags.size === 1 && !hasManual) {
    const sid = Array.from(strategyIdsFromTags)[0]
    const s = strategiesById.get(sid)
    return { kind: 'strategy', strategyId: sid, label: s?.name?.slice(0, 12) || sid, color: s?.color || '#c9a84c' }
  }
  if (strategyIdsFromTags.size === 0 && hasManual) return { kind: 'manual', label: 'MANUAL', color: '#a78bfa' }
  return { kind: 'mixed', label: 'MIXED', color: '#f59e0b' }
}
