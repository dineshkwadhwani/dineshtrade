// Runtime strategy config store — Supabase-backed (`customer_strategies` +
// `customer_capital_config`). STRICT: all strategies must come from Supabase.
// No JSON fallbacks.
//
// lib/strategyConfig.ts (unchanged per spec §1.5/§15) wraps this module and
// exposes getStrategies()/getStrategyById()/getCapital()/getActiveStrategies()
// as SYNCHRONOUS calls — dozens of call sites across the engine, cron and
// preflight read them without awaiting. Supabase reads are inherently async,
// so getRuntimeStrategyConfig() stays synchronous by serving an in-memory
// cache that's hydrated from Supabase in the background: the module kicks
// off a hydration fetch on load.
//
// If Supabase returns empty strategies or throws an error, that is a FATAL
// ERROR — no fallback to bundled JSON. The trading engine must not run with
// silent strategy misconfigurations. Fix the Supabase row or the connection.
//
// Only `capital` and `strategies` are round-tripped: the legacy top-level
// keys `config/strategy.json` used to also carry (capital_legacy, limits,
// targets, strategy2_momentum, ema, strategy1_reactive, sources, version,
// _comment) are not read by any caller of getRuntimeStrategyConfig() today
// (verified — only lib/strategyConfig.ts's `.capital`/`.strategies` and
// app/api/strategies/route.ts's merge-spread touch this object), so they're
// dropped rather than given a home in the relational schema.

import { getSupabaseAdmin, getCustomerId } from './supabase'

// Migrate legacy strategy ids. Currently: rename 'oscillator' → 'accumulator'
// (the universal "keeper" strategy that everything hands off to).
function migrateLegacyIds(cfg: any): { changed: boolean; cfg: any } {
  if (!cfg || !Array.isArray(cfg.strategies)) return { changed: false, cfg }
  let changed = false
  const strategies = cfg.strategies.map((s: any) => {
    if (s && s.id === 'oscillator') {
      changed = true
      const newName = typeof s.name === 'string' && /oscillator/i.test(s.name) ? 'Accumulator' : s.name
      return { ...s, id: 'accumulator', name: newName }
    }
    return s
  })
  if (!changed) return { changed: false, cfg }
  return { changed: true, cfg: { ...cfg, strategies } }
}

// ─── Row ⇄ config mapping ───────────────────────────────────────────────────

function rowToStrategy(row: any): any {
  return {
    id: row.strategy_key,
    name: row.name,
    type: row.type,
    active: row.active,
    color: row.color,
    scanIntervalMin: row.scan_interval_min,
    watchlist: Array.isArray(row.watchlist_keys) ? row.watchlist_keys : [],
    params: row.params || {},
    exits: row.exits || {},
    giftNiftyGate: row.gift_nifty_gate ?? undefined,
  }
}

function strategyToRow(customerId: string, strategy: any): Record<string, unknown> {
  return {
    customer_id: customerId,
    strategy_key: strategy.id,
    name: strategy.name,
    type: strategy.type,
    active: !!strategy.active,
    color: strategy.color,
    scan_interval_min: strategy.scanIntervalMin,
    watchlist_keys: strategy.watchlist ?? [],
    params: strategy.params ?? {},
    exits: strategy.exits ?? {},
    gift_nifty_gate: strategy.giftNiftyGate ?? null,
    updated_at: new Date().toISOString(),
  }
}

function rowToCapital(row: any): any {
  if (!row) return undefined
  return {
    source: 'live',
    perTrade: row.per_trade,
    maxBuysPerDay: row.max_buys_per_day,
    maxSellsPerDay: row.max_sells_per_day,
    deliveryDpCharge: row.delivery_dp_charge,
    circuitBreakerPct: row.circuit_breaker_pct,
    intradayCircuitTripPct: row.intraday_circuit_trip_pct,
    intradayCircuitResumePct: row.intraday_circuit_resume_pct,
    panicDropPct: row.panic_drop_pct,
    panicWindowMin: row.panic_window_min,
    maxDeployPct: row.max_deploy_pct,
    // sharedPool has no column — always true in practice (nothing branches on
    // it; lib/strategyConfig.ts's getCapital() already defaults it to true
    // whenever it's undefined, which is what omitting it here produces).
    maxPositions: row.max_positions,
    maxBuysPerSymbol: row.max_buys_per_symbol,
    minDropBetweenBuysPct: row.min_drop_between_buys_pct,
  }
}

function capitalToRow(customerId: string, capital: any): Record<string, unknown> {
  return {
    customer_id: customerId,
    per_trade: capital.perTrade,
    max_buys_per_day: capital.maxBuysPerDay,
    max_sells_per_day: capital.maxSellsPerDay,
    max_positions: capital.maxPositions,
    max_buys_per_symbol: capital.maxBuysPerSymbol,
    min_drop_between_buys_pct: capital.minDropBetweenBuysPct,
    max_deploy_pct: capital.maxDeployPct,
    delivery_dp_charge: capital.deliveryDpCharge,
    circuit_breaker_pct: capital.circuitBreakerPct,
    intraday_circuit_trip_pct: capital.intradayCircuitTripPct ?? 0,
    intraday_circuit_resume_pct: capital.intradayCircuitResumePct ?? 0,
    panic_drop_pct: capital.panicDropPct ?? 0,
    panic_window_min: capital.panicWindowMin ?? 0,
    updated_at: new Date().toISOString(),
  }
}

// ─── Per-customer in-memory cache ────────────────────────────────────────
// Keyed by customerId so multi-customer EC2s don't bleed across ticks.

const cacheMap = new Map<string, any>()
const hydratedSet = new Set<string>()

// Returns the current customer's ID for cache keying, falls back to 'default'
// so the cache still works in API routes where no customer context is set.
function cacheKey(): string {
  try { return getCustomerId() } catch { return 'default' }
}

async function hydrate(): Promise<void> {
  const admin = getSupabaseAdmin()
  const customerId = getCustomerId()
  
  const [capitalRes, strategiesRes] = await Promise.all([
    admin.from('customer_capital_config').select('*').eq('customer_id', customerId).maybeSingle(),
    admin.from('customer_strategies').select('*').eq('customer_id', customerId),
  ])
  
  if (capitalRes.error) throw capitalRes.error
  if (strategiesRes.error) throw strategiesRes.error

  const strategies = (strategiesRes.data || [])
    .filter(row => !!row.strategy_key)
    .map(rowToStrategy)
  
  // FATAL: strategies must come from Supabase. No JSON fallbacks.
  if (strategies.length === 0) {
    throw new Error(`[strategyConfigStore] FATAL: customer ${customerId} has zero strategies in Supabase. All strategies must be stored in customer_strategies table — no JSON fallbacks allowed.`)
  }
  
  const capital = rowToCapital(capitalRes.data)
  if (!capital) {
    throw new Error(`[strategyConfigStore] FATAL: customer ${customerId} has no capital_config in Supabase. Capital limits must be stored in customer_capital_config table.`)
  }

  const next = migrateLegacyIds({
    capital,
    strategies,
  }).cfg
  
  cacheMap.set(customerId, next)
  hydratedSet.add(customerId)
}

// Kick off hydration for the startup customer immediately, while retaining the
// promise so startup can wait for the synchronous config readers below.
const initialHydration = hydrate()
void initialHydration.catch(err => {
  console.error('[strategyConfigStore] CRITICAL: Initial Supabase hydration failed, trading engine CANNOT start:', String(err).slice(0, 300))
})

export async function waitForInitialHydration(): Promise<void> {
  await initialHydration
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getRuntimeStrategyConfig(): any {
  const key = cacheKey()
  const cached = cacheMap.get(key)
  if (!cached) {
    throw new Error(`[strategyConfigStore] FATAL: strategy config not hydrated yet for customer ${key}. Supabase must be successfully loaded before trading engine runs. Check logs for hydration errors.`)
  }
  return cached
}

export async function saveRuntimeStrategyConfig(next: any): Promise<void> {
  const admin = getSupabaseAdmin()
  const customerId = getCustomerId()

  if (next.capital) {
    const { error } = await admin
      .from('customer_capital_config')
      .upsert(capitalToRow(customerId, next.capital), { onConflict: 'customer_id' })
    if (error) throw new Error(`[strategyConfigStore] capital upsert failed: ${error.message}`)
  }

  if (Array.isArray(next.strategies)) {
    const rows = next.strategies.map((s: any) => strategyToRow(customerId, s))
    if (rows.length > 0) {
      const { error } = await admin
        .from('customer_strategies')
        .upsert(rows, { onConflict: 'customer_id,strategy_key' })
      if (error) throw new Error(`[strategyConfigStore] strategies upsert failed: ${error.message}`)
    }

    // Remove strategies deleted in this save (present before, absent now).
    const keep = new Set(next.strategies.map((s: any) => s.id))
    const { data: existing, error: selectError } = await admin
      .from('customer_strategies')
      .select('strategy_key')
      .eq('customer_id', customerId)
    if (selectError) throw new Error(`[strategyConfigStore] post-save read failed: ${selectError.message}`)
    const toDelete = (existing || [])
      .map(r => r.strategy_key)
      .filter((key): key is string => !!key && !keep.has(key))
    if (toDelete.length > 0) {
      const { error: deleteError } = await admin
        .from('customer_strategies')
        .delete()
        .eq('customer_id', customerId)
        .in('strategy_key', toDelete)
      if (deleteError) throw new Error(`[strategyConfigStore] delete removed strategies failed: ${deleteError.message}`)
    }
  }

  const key = cacheKey()
  cacheMap.set(key, migrateLegacyIds(next).cfg)
  hydratedSet.add(key)
}

export function invalidateStrategyConfigCache(): void {
  void hydrate()
}

// Called at the start of each customer's cron tick to refresh their strategy
// config from Supabase before buy/sell scans run. Always awaited so a Settings
// change (e.g. Max Open Positions) is guaranteed live before this tick's gates
// run, instead of racing a fire-and-forget refresh that could silently fail
// and leave the cache stuck on whatever it held at first hydration.
export async function rehydrateForCustomer(): Promise<void> {
  await hydrate().catch(err => {
    console.error(`[strategyConfigStore] rehydrate failed for customer ${cacheKey()} — using last cached config:`, String(err).slice(0, 300))
  })
}

// Exposed for diagnostics/tests — true once the first Supabase read has
// completed (successfully or not).
export function isStrategyConfigHydrated(): boolean {
  return hydratedSet.has(cacheKey())
}
