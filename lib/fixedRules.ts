// Platform Fixed Rules — Supabase-backed (`platform_fixed_rules`), read-only
// from every customer instance. See docs/DALGO_REFACTOR_SPEC_v2.md §7.8 /
// Phase 5 Task 5.6.
//
// SuperAdmin edits these rows (Phase 6 UI, not built yet); every customer
// cron process must pick up a change WITHOUT a restart, so this module caches
// for 5 minutes (rules rarely change, but a change must propagate fast enough
// to matter — "immediate effect" per spec §7.8 means "within the cache TTL",
// not literally instant, which is an acceptable trade-off against querying
// Supabase on every single cron tick).
//
// On a DB read failure, we fall back to safe hardcoded defaults and log a
// warning — trading must never stop because a config read failed (explicit
// Phase 5 requirement).

import { getSupabaseAdmin } from './supabase'

export interface FixedRules {
  sellMonitorCadenceMin: number
  noShortSelling: boolean
  noFoTrading: boolean
  noLossSellAuto: boolean
  orderProductType: string
  exchange: string
}

const SAFE_DEFAULTS: FixedRules = {
  sellMonitorCadenceMin: 5,
  noShortSelling: true,
  noFoTrading: true,
  noLossSellAuto: true,
  orderProductType: 'CNC',
  exchange: 'NSE',
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

let cache: FixedRules | null = null
let cachedAt = 0
// Coalesces concurrent cache-miss callers into a single Supabase round trip.
let inFlight: Promise<FixedRules> | null = null

function coerceNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true'
  return fallback
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

async function fetchFixedRulesFromDb(): Promise<FixedRules> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('platform_fixed_rules')
    .select('rule_key, value')
  if (error) throw new Error(`[fixedRules] read failed: ${error.message}`)

  const byKey = new Map<string, unknown>((data || []).map(row => [row.rule_key, row.value]))

  return {
    sellMonitorCadenceMin: coerceNumber(byKey.get('sell_monitor_cadence_min'), SAFE_DEFAULTS.sellMonitorCadenceMin),
    noShortSelling: coerceBoolean(byKey.get('no_short_selling'), SAFE_DEFAULTS.noShortSelling),
    noFoTrading: coerceBoolean(byKey.get('no_fo_trading'), SAFE_DEFAULTS.noFoTrading),
    noLossSellAuto: coerceBoolean(byKey.get('no_loss_sell_auto'), SAFE_DEFAULTS.noLossSellAuto),
    orderProductType: coerceString(byKey.get('order_product_type'), SAFE_DEFAULTS.orderProductType),
    exchange: coerceString(byKey.get('exchange'), SAFE_DEFAULTS.exchange),
  }
}

// Returns the current Fixed Rules, cached for 5 minutes. Never throws — falls
// back to SAFE_DEFAULTS (and logs a warning) on any DB failure so a Supabase
// hiccup can never halt trading.
export async function getFixedRules(): Promise<FixedRules> {
  const now = Date.now()
  if (cache && now - cachedAt < CACHE_TTL_MS) return cache

  if (!inFlight) {
    inFlight = fetchFixedRulesFromDb()
      .then(rules => {
        cache = rules
        cachedAt = Date.now()
        return rules
      })
      .catch(err => {
        console.warn('[fixedRules] failed to read platform_fixed_rules — using safe defaults:', String(err).slice(0, 200))
        // Cache the fallback too (still for the full TTL) so a sustained DB
        // outage doesn't turn into a read-storm of failing requests.
        cache = { ...SAFE_DEFAULTS }
        cachedAt = Date.now()
        return cache
      })
      .finally(() => { inFlight = null })
  }
  return inFlight
}

// Test/ops escape hatch — forces the next getFixedRules() call to re-read
// from Supabase instead of serving the cache. Not called anywhere in
// production code paths today; kept for completeness/future admin tooling.
export function invalidateFixedRulesCache(): void {
  cache = null
  cachedAt = 0
}
