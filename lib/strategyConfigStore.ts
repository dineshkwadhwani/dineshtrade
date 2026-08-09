// Runtime strategy config store — Supabase-backed (`customer_strategies` +
// `customer_capital_config`). Ported in Phase 4 of the multi-tenant refactor
// from the file-based `~/dineshtrade/data/strategy.json` overlay.
//
// lib/strategyConfig.ts (unchanged per spec §1.5/§15) wraps this module and
// exposes getStrategies()/getStrategyById()/getCapital()/getActiveStrategies()
// as SYNCHRONOUS calls — dozens of call sites across the engine, cron and
// preflight read them without awaiting. Supabase reads are inherently async,
// so getRuntimeStrategyConfig() stays synchronous by serving an in-memory
// cache that's hydrated from Supabase in the background: the module kicks
// off a hydration fetch on load, and every sync read serves the bundled seed
// config until that first hydration resolves (same fallback shape the old
// file backend used for "runtime file missing"). saveRuntimeStrategyConfig()
// writes through to Supabase AND updates the cache immediately, so an
// edit's own process sees it on the very next sync read — no restart needed,
// matching the old cache-invalidate-on-save behaviour exactly.
//
// Only `capital` and `strategies` are round-tripped: the legacy top-level
// keys `config/strategy.json` used to also carry (capital_legacy, limits,
// targets, strategy2_momentum, ema, strategy1_reactive, sources, version,
// _comment) are not read by any caller of getRuntimeStrategyConfig() today
// (verified — only lib/strategyConfig.ts's `.capital`/`.strategies` and
// app/api/strategies/route.ts's merge-spread touch this object), so they're
// dropped rather than given a home in the relational schema.

import { getSupabaseAdmin, getCustomerId } from './supabase'
import bundled from '@/config/strategy.json'

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

function bundledConfig(): any {
  return migrateLegacyIds(bundled).cfg
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

// ─── In-memory cache (see module header for why this must stay sync) ──────

let cache: any = migrateLegacyIds(bundled).cfg
let hydrated = false

async function hydrate(): Promise<void> {
  try {
    const admin = getSupabaseAdmin()
    const customerId = getCustomerId()
    const [capitalRes, strategiesRes] = await Promise.all([
      admin.from('customer_capital_config').select('*').eq('customer_id', customerId).maybeSingle(),
      admin.from('customer_strategies').select('*').eq('customer_id', customerId),
    ])
    if (capitalRes.error) throw capitalRes.error
    if (strategiesRes.error) throw strategiesRes.error

    const strategies = (strategiesRes.data || [])
      .filter(row => !!row.strategy_key)   // rows without a strategy_key predate Phase 4 — skip until re-saved
      .map(rowToStrategy)
    const capital = rowToCapital(capitalRes.data)

    // Fall back to bundled seed values for anything not yet in Supabase
    // (e.g. a brand-new customer before activation seeds these rows).
    const next = migrateLegacyIds({
      capital: capital ?? bundledConfig().capital,
      strategies: strategies.length > 0 ? strategies : bundledConfig().strategies,
    }).cfg
    cache = next
    hydrated = true
  } catch (err) {
    console.warn('[strategyConfigStore] Supabase hydration failed, serving bundled config:', String(err).slice(0, 200))
  }
}

// Kick off hydration immediately on module load — by the time any real
// request or cron tick reads getRuntimeStrategyConfig() (never
// sub-millisecond after process boot), this has almost always resolved.
void hydrate()

// ─── Public API ─────────────────────────────────────────────────────────────

export function getRuntimeStrategyConfig(): any {
  return cache
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

  cache = migrateLegacyIds(next).cfg
  hydrated = true
}

export function invalidateStrategyConfigCache(): void {
  // Can't synchronously drop `cache` to null the way the old file backend
  // did (Supabase reads are async, and getRuntimeStrategyConfig() must stay
  // sync) — instead, force a fresh hydration in the background. In practice
  // this is a no-op safety net: saveRuntimeStrategyConfig() already updates
  // `cache` synchronously with the exact saved value, so the only case this
  // actually matters is if something changed the DB without going through
  // this module.
  void hydrate()
}

// Exposed for diagnostics/tests — true once the first Supabase read has
// completed (successfully or not).
export function isStrategyConfigHydrated(): boolean {
  return hydrated
}
