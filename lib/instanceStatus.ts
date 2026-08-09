// Customer EC2 instance health reporting — Supabase-backed
// (`customer_instances`, one row per customer_id). Phase 5 Tasks 5.3/5.4.
//
// Every cron tick writes (or skips writing, per the SuperAdmin config flag
// below) a single upsert combining heartbeat fields (Task 5.3) and Kite
// token status (Task 5.4) — one round trip per tick, not two.
//
// Gated by `platform_config.HEARTBEAT_DB_ENABLED` (default 'false' — see
// docs/DALGO_REFACTOR_SPEC_v2.md §8.4 seed data). Cached for 60 seconds so a
// 5-min cron tick doesn't add an extra Supabase read on every single fire;
// the SuperAdmin health dashboard is documented as "may show stale data for
// up to a minute" when this flag is flipped, which is an accepted trade-off.

import { getSupabaseAdmin, getCustomerId } from './supabase'
import { resolveAccountCreds, getPositions } from './kite'

// ─── HEARTBEAT_DB_ENABLED cache (60s TTL) ──────────────────────────────────

const HEARTBEAT_FLAG_TTL_MS = 60 * 1000
let heartbeatEnabledCache: boolean | null = null
let heartbeatEnabledCachedAt = 0

export async function isHeartbeatDbEnabled(): Promise<boolean> {
  const now = Date.now()
  if (heartbeatEnabledCache !== null && now - heartbeatEnabledCachedAt < HEARTBEAT_FLAG_TTL_MS) {
    return heartbeatEnabledCache
  }
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('platform_config')
      .select('value')
      .eq('key', 'HEARTBEAT_DB_ENABLED')
      .maybeSingle()
    if (error) throw error
    heartbeatEnabledCache = data?.value === 'true'
  } catch (err) {
    console.warn('[instanceStatus] failed to read HEARTBEAT_DB_ENABLED, defaulting to false:', String(err).slice(0, 200))
    heartbeatEnabledCache = false
  }
  heartbeatEnabledCachedAt = Date.now()
  return heartbeatEnabledCache
}

// ─── Kite token status (Task 5.4) ──────────────────────────────────────────

export type KiteTokenStatus = 'connected' | 'missing' | 'expired'

// Cheap connectivity probe against the first connected account's token (this
// customer's single broker account, in the target multi-tenant model — the
// legacy state.kiteTokens map can carry more than one key only for V1's
// pre-refactor multi-account concept, see lib/state.ts header comment).
// Returns 'missing' with no API call at all when no token is present.
export async function checkKiteTokenStatus(kiteTokens: Record<string, string>): Promise<KiteTokenStatus> {
  const accounts = Object.keys(kiteTokens)
  if (accounts.length === 0) return 'missing'
  try {
    const creds = await resolveAccountCreds(accounts[0])
    if (!creds.ok) return 'missing'
    await getPositions(creds) // throws on an expired/invalid access token
    return 'connected'
  } catch (err) {
    console.warn(`[instanceStatus] token check failed for ${accounts[0]} — reporting expired:`, String(err).slice(0, 150))
    return 'expired'
  }
}

// ─── Combined upsert (Task 5.3 + 5.4, one round trip) ──────────────────────

export interface InstanceStatusFields {
  cronMode?: 'auto' | 'manual'
  kiteTokenStatus?: KiteTokenStatus
  openPositionsCount?: number
  todaysOrdersCount?: number
  todaysBuyCount?: number
  todaysSellCount?: number
}

// Upserts customer_instances for THIS customer (getCustomerId()). Creates the
// row with status='active' if none exists yet. No-ops entirely (no Supabase
// call) when HEARTBEAT_DB_ENABLED is off — the default. Never throws — a
// health-dashboard write failure must never interrupt trading.
export async function updateInstanceStatus(fields: InstanceStatusFields): Promise<void> {
  if (!(await isHeartbeatDbEnabled())) return

  try {
    const admin = getSupabaseAdmin()
    const now = new Date().toISOString()
    const row: Record<string, unknown> = {
      customer_id: getCustomerId(),
      status: 'active',
      last_heartbeat_at: now,
      last_cron_tick_at: now,
      updated_at: now,
    }
    if (fields.cronMode !== undefined) row.cron_mode = fields.cronMode
    if (fields.kiteTokenStatus !== undefined) row.kite_token_status = fields.kiteTokenStatus
    if (fields.openPositionsCount !== undefined) row.open_positions_count = fields.openPositionsCount
    if (fields.todaysOrdersCount !== undefined) row.todays_orders_count = fields.todaysOrdersCount
    if (fields.todaysBuyCount !== undefined) row.todays_buy_count = fields.todaysBuyCount
    if (fields.todaysSellCount !== undefined) row.todays_sell_count = fields.todaysSellCount

    const { error } = await admin.from('customer_instances').upsert(row, { onConflict: 'customer_id' })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.error('[instanceStatus] updateInstanceStatus failed:', String(err).slice(0, 300))
  }
}

// Task 5.10 — records a reset event. Unlike updateInstanceStatus() above,
// this is NOT gated by HEARTBEAT_DB_ENABLED: a reset is a real audit event
// (rare, deliberate, user-initiated) rather than a frequent heartbeat metric,
// so it should always be recorded regardless of that dashboard-staleness
// trade-off. Never throws — a logging failure must not fail the reset itself
// (the reset's own destructive work already completed by the time this runs).
export async function recordResetTimestamp(): Promise<void> {
  try {
    const admin = getSupabaseAdmin()
    const now = new Date().toISOString()
    const { error } = await admin
      .from('customer_instances')
      .upsert({ customer_id: getCustomerId(), status: 'active', last_reset_at: now, updated_at: now }, { onConflict: 'customer_id' })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.error('[instanceStatus] recordResetTimestamp failed:', String(err).slice(0, 300))
  }
}
