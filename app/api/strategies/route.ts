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

  // Watchlist keys + display names are derived dynamically so newly created
  // lists show up in the Strategies UI multi-select with no code change.
  const wl = await getWatchlist()
  const watchlistKeys = Object.keys(wl.lists)
  const watchlistOptions = watchlistKeys.map(k => ({ key: k, name: wl.meta[k]?.name || k }))

  // Open-position counts per strategy — used by Settings UI for the
  // "deactivating X has N open positions that will migrate to Accumulator"
  // confirmation dialog. Best-effort: if positions store can't be read, returns {}.
  let openPositionCounts: Record<string, number> = {}
  try {
    const { listPositions } = await import('@/lib/positions')
    const positions = await listPositions()
    for (const p of positions) openPositionCounts[p.strategyId] = (openPositionCounts[p.strategyId] || 0) + 1
  } catch { /* best-effort */ }

  return NextResponse.json({
    capital: getCapital(),
    strategies: getStrategies(),
    watchlistKeys,
    watchlistOptions,
    openPositionCounts,
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

    // Intraday circuit — both must be ≤ 0; resume must be > trip (less negative) for hysteresis.
    // 0 on either means feature disabled.
    const tripPct = capital.intradayCircuitTripPct
    const resumePct = capital.intradayCircuitResumePct
    if (tripPct !== undefined && tripPct !== null) {
      if (typeof tripPct !== 'number' || !Number.isFinite(tripPct)) errors.push('Intraday circuit Trip % must be a number')
      else if (tripPct > 0)                                          errors.push('Intraday circuit Trip % must be 0 or negative')
    }
    if (resumePct !== undefined && resumePct !== null) {
      if (typeof resumePct !== 'number' || !Number.isFinite(resumePct)) errors.push('Intraday circuit Resume % must be a number')
      else if (resumePct > 0)                                            errors.push('Intraday circuit Resume % must be 0 or negative')
    }
    if (typeof tripPct === 'number' && typeof resumePct === 'number' && tripPct !== 0 && resumePct !== 0) {
      if (!(resumePct > tripPct)) errors.push(`Intraday circuit Resume % (${resumePct}) must be greater than Trip % (${tripPct}) — e.g. trip -3, resume -2`)
    }

    // Panic-sell — drop% must be ≥ 0, window must be a non-negative multiple of 5.
    // 0 on either field = feature disabled.
    const panicDrop = capital.panicDropPct
    const panicWin = capital.panicWindowMin
    if (panicDrop !== undefined && panicDrop !== null) {
      if (typeof panicDrop !== 'number' || !Number.isFinite(panicDrop)) errors.push('Panic-sell Drop % must be a number')
      else if (panicDrop < 0) errors.push('Panic-sell Drop % must be ≥ 0')
    }
    if (panicWin !== undefined && panicWin !== null) {
      if (typeof panicWin !== 'number' || !Number.isFinite(panicWin)) errors.push('Panic-sell Window must be a number')
      else if (panicWin < 0)                                            errors.push('Panic-sell Window must be ≥ 0')
      else if (panicWin > 0 && panicWin % 5 !== 0)                      errors.push('Panic-sell Window must be a multiple of 5 minutes (5, 10, 15, 20, 25, 30)')
    }
    if (typeof panicDrop === 'number' && typeof panicWin === 'number') {
      const dropEnabled = panicDrop > 0
      const winEnabled = panicWin > 0
      if (dropEnabled !== winEnabled) errors.push('Panic-sell: set both Drop % and Window, or set both to 0 to disable')
    }

    if (!(capital.maxPositions >= 1))        errors.push('Max positions must be ≥ 1')
    if (capital.maxBuysPerSymbol !== undefined && !(capital.maxBuysPerSymbol >= 1)) errors.push('Max BUYs per symbol must be ≥ 1')
    if (capital.minDropBetweenBuysPct !== undefined && !(capital.minDropBetweenBuysPct >= 0)) errors.push('Min drop between BUYs must be ≥ 0%')
  }

  if (!Array.isArray(body.strategies)) errors.push('strategies array missing')
  else {
    const ids = new Set<string>()
    // Accumulator is the universal parking lot — every momentum strategy hands
    // off to it after `deliveryHandoffDays`. It must always exist and be active.
    const accumulator = body.strategies.find((s: any) => s?.id === 'accumulator')
    if (!accumulator) errors.push('"accumulator" strategy is required — it is the universal parking lot every other strategy hands off to')
    else if (accumulator.active === false) errors.push('"accumulator" cannot be deactivated — it is the keeper strategy')

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

  // Identify strategies that are being deactivated OR deleted in this save.
  // Their open positions migrate to accumulator (universal parking lot).
  const previousActiveIds = new Set<string>(
    (Array.isArray(current?.strategies) ? current.strategies : [])
      .filter((s: any) => s?.active === true && s?.id !== 'accumulator')
      .map((s: any) => s.id),
  )
  const newActiveIds = new Set<string>(
    body.strategies.filter((s: any) => s?.active === true).map((s: any) => s.id),
  )
  const losingActiveStatus = Array.from(previousActiveIds).filter(id => !newActiveIds.has(id))

  try {
    await saveRuntimeStrategyConfig(next)
  } catch (e) {
    return NextResponse.json({ error: 'Save failed: ' + String(e).slice(0, 200) }, { status: 500 })
  }

  // Migrate any open positions belonging to deactivated/deleted strategies
  // over to accumulator. Done AFTER the save so the new config is in place
  // before the next monitor tick sees the re-stamped positions.
  let migratedPositions = 0
  if (losingActiveStatus.length > 0) {
    try {
      const { migrateStrategyId } = await import('@/lib/positions')
      for (const id of losingActiveStatus) {
        migratedPositions += await migrateStrategyId(id, 'accumulator')
      }
    } catch (e) {
      console.warn('[POST /api/strategies] position migration failed:', String(e).slice(0, 200))
    }
  }

  // Hot-reload cron with the new active set + intervals
  let reload: { added: string[]; removed: string[]; restarted: string[] } | null = null
  try {
    const { reloadCronStrategies } = await import('@/lib/cron')
    reload = reloadCronStrategies()
  } catch (e) {
    console.warn('[POST /api/strategies] cron reload failed (will pick up at next process restart):', String(e).slice(0, 200))
  }

  return NextResponse.json({ ok: true, reload, migratedPositions, migratedFrom: losingActiveStatus })
}
