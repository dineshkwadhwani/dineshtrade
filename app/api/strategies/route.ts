// GET /api/strategies — returns the new schema-2 config: capital block +
// strategies array. Phase 2 is read-only; POST will land in Phase 4 with
// validation + hot-reload.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getCapital, getStrategies } from '@/lib/strategyConfig'
import { getWatchlist } from '@/lib/watchlistStore'
import { getRuntimeStrategyConfig, saveRuntimeStrategyConfig } from '@/lib/strategyConfigStore'
import { getState } from '@/lib/state'

export const dynamic = 'force-dynamic'

export async function GET() {
  const t = cookies().get('dt_session')?.value
  if (!t || !(await verifySession(t))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Watchlist keys are derived dynamically so a future `listC` shows up in
  // the Strategies UI dropdown with no code change required.
  const wl = await getWatchlist()
  const watchlistKeys = Object.keys(wl).filter(k =>
    Array.isArray((wl as any)[k]) && (k === 'listA' || k === 'listB' || k.startsWith('list'))
  )

  return NextResponse.json({
    capital: getCapital(),
    strategies: getStrategies(),
    watchlistKeys,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

// POST /api/strategies — save edited config. Validates, refuses if Auto is
// on, writes to data/strategy.json, hot-reloads cron tasks.
export async function POST(req: Request) {
  const t = cookies().get('dt_session')?.value
  if (!t || !(await verifySession(t))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // GATE: Auto must be paused before strategy params can change. Forces the
  // user to make an explicit "I'm pausing the engine to tune" decision.
  const state = await getState()
  if (state.mode === 'auto') {
    return NextResponse.json({ error: 'Switch to Manual mode before editing strategies. Auto-mode trades against the live config; changes mid-session can produce unexpected fires.' }, { status: 409 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  // Validation
  const errors: string[] = []
  const capital = body.capital
  if (!capital || typeof capital !== 'object') errors.push('capital block missing')
  else {
    if (!(capital.perTrade > 0))            errors.push('Per-trade amount must be > 0')
    if (!(capital.maxBuysPerDay >= 0))       errors.push('Max BUYs/day must be ≥ 0')
    if (!(capital.maxSellsPerDay >= 0))      errors.push('Max SELLs/day must be ≥ 0')
    if (!(capital.maxDeployPct > 0 && capital.maxDeployPct <= 100)) errors.push('Max Deploy % must be between 1 and 100')
    if (capital.circuitBreakerPct > 0)       errors.push('Circuit breaker % must be 0 or negative')
    if (!(capital.maxPositions >= 1))        errors.push('Max positions must be ≥ 1')
  }

  if (!Array.isArray(body.strategies)) errors.push('strategies array missing')
  else {
    const ids = new Set<string>()
    for (const s of body.strategies) {
      if (!s.id || typeof s.id !== 'string') { errors.push('Each strategy needs an id'); continue }
      if (ids.has(s.id)) errors.push(`Duplicate strategy id "${s.id}"`)
      ids.add(s.id)
      if (!s.name) errors.push(`"${s.id}": name is required`)
      if (s.type !== 'dip' && s.type !== 'momentum') errors.push(`"${s.id}": type must be 'dip' or 'momentum'`)
      if (!Number.isFinite(s.scanIntervalMin) || s.scanIntervalMin < 1) errors.push(`"${s.id}": scanIntervalMin must be ≥ 1`)
      if (!Array.isArray(s.watchlist) || s.watchlist.length === 0) errors.push(`"${s.id}": watchlist must include at least one list`)
      if (!s.exits || typeof s.exits !== 'object') errors.push(`"${s.id}": exits block required`)
      else {
        if (!(s.exits.t1Pct > 0)) errors.push(`"${s.id}": t1Pct must be > 0`)
        if (!(s.exits.t2Pct > 0)) errors.push(`"${s.id}": t2Pct must be > 0`)
        if (s.exits.t1Pct > s.exits.t2Pct) errors.push(`"${s.id}": t1Pct (${s.exits.t1Pct}) cannot exceed t2Pct (${s.exits.t2Pct})`)
      }
      // Optional GIFT Nifty gate
      if (s.giftNiftyGate) {
        const g = s.giftNiftyGate
        if (typeof g.enabled !== 'boolean') errors.push(`"${s.id}": giftNiftyGate.enabled must be a boolean`)
        const hasMin = g.minPct !== null && g.minPct !== undefined
        const hasMax = g.maxPct !== null && g.maxPct !== undefined
        if (g.enabled && !hasMin && !hasMax) errors.push(`"${s.id}": giftNiftyGate is enabled but has no bounds — set min or max (or both)`)
        if (hasMin && hasMax && g.minPct > g.maxPct) errors.push(`"${s.id}": giftNiftyGate minPct (${g.minPct}) cannot exceed maxPct (${g.maxPct})`)
      }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 })
  }

  // Merge into existing runtime config so we preserve any legacy keys
  const current = getRuntimeStrategyConfig()
  const next = { ...current, capital: body.capital, strategies: body.strategies, _updatedAt: new Date().toISOString() }

  try {
    await saveRuntimeStrategyConfig(next)
  } catch (e) {
    return NextResponse.json({ error: 'Save failed: ' + String(e).slice(0, 200) }, { status: 500 })
  }

  // Hot-reload cron with the new active set + intervals
  let reload: { added: string[]; removed: string[]; restarted: string[] } | null = null
  try {
    const { reloadCronStrategies } = await import('@/lib/cron')
    reload = reloadCronStrategies()
  } catch (e) {
    console.warn('[POST /api/strategies] cron reload failed (will pick up at next process restart):', String(e).slice(0, 200))
  }

  return NextResponse.json({ ok: true, reload })
}
