// Intraday circuit breaker. Live NIFTY 50 vs today's open; trips when drop% ≤
// tripPct, resumes when drop% ≥ resumePct (hysteresis). Symmetrical with the
// morning GIFT-Nifty circuit but driven by live spot during the session.
//
// Scope: blocks new auto-BUYs only. SELL monitors and manual orders unaffected
// — by the time this fires, you usually want exits to keep flowing.
//
// Wired into preflight as a gate. State lives in-process (intentionally
// non-persistent): on a fresh restart we re-evaluate from live Kite — if Nifty
// is still in the danger zone, we'll trip again on the very next BUY.

import { getCapital } from './strategyConfig'
import { getState } from './state'
import { resolveAccountCreds, kiteRequest } from './kite'
import { istDateString } from './journal'

const QUOTE_TTL_MS = 30 * 1000   // re-query Kite at most once per 30s — preflight
                                  // can fire repeatedly inside a single tick
const NIFTY_KEY = 'NSE:NIFTY 50'

interface NiftySnapshot {
  ltp: number
  open: number
  dropPct: number
  fetchedAt: number
}

let snapshotCache: NiftySnapshot | null = null

interface CircuitState {
  tripped: boolean
  trippedAt?: string        // ISO timestamp of last trip
  baselineDate?: string     // YYYY-MM-DD IST — reset state at start of new day
  lastDropPct?: number
}
let state: CircuitState = { tripped: false }

export interface IntradayCircuitResult {
  enabled: boolean
  tripped: boolean
  dropPct: number | null
  tripPct: number
  resumePct: number
  reason?: string           // populated when tripped or just resumed
}

async function fetchNifty(): Promise<NiftySnapshot | null> {
  const now = Date.now()
  if (snapshotCache && now - snapshotCache.fetchedAt < QUOTE_TTL_MS) return snapshotCache

  // Use the first connected Kite token (same pattern as /api/market/indices).
  const s = await getState()
  let creds: { apiKey: string; accessToken: string } | null = null
  for (const account of Object.keys(s.kiteTokens || {})) {
    const r = await resolveAccountCreds(account)
    if (r.ok) { creds = { apiKey: r.apiKey, accessToken: r.accessToken }; break }
  }
  if (!creds) return null

  try {
    const r = await kiteRequest<{ data?: Record<string, any> }>(
      `/quote?i=${encodeURIComponent(NIFTY_KEY)}`,
      creds,
    )
    const q = r.data?.data?.[NIFTY_KEY]
    if (!q?.last_price || !q?.ohlc?.open) return null
    const ltp = Number(q.last_price)
    const open = Number(q.ohlc.open)
    if (!(open > 0)) return null
    const dropPct = ((ltp - open) / open) * 100
    snapshotCache = { ltp, open, dropPct, fetchedAt: now }
    return snapshotCache
  } catch (err) {
    console.warn('[intradayCircuit] kite /quote failed:', String(err).slice(0, 200))
    return null
  }
}

// Public entrypoint. Returns the current circuit state and mutates the in-process
// state machine in the same call (trip ↔ resume edges).
//
// Failure modes:
//  - Feature disabled (either threshold is 0) → { enabled: false, tripped: false }
//  - Nifty quote unavailable (no Kite token, /quote errored) → returns the LAST
//    known state. We don't want a transient quote failure to silently unblock
//    BUYs if we're already tripped, OR to spuriously trip if we're not.
export async function checkIntradayCircuit(): Promise<IntradayCircuitResult> {
  const cap = getCapital()
  const tripPct = cap.intradayCircuitTripPct ?? 0
  const resumePct = cap.intradayCircuitResumePct ?? 0

  // Disabled when either is 0 (or both, or unset)
  if (tripPct === 0 || resumePct === 0) {
    return { enabled: false, tripped: false, dropPct: null, tripPct, resumePct }
  }

  // Reset state at start of new IST day (baseline = today's open)
  const today = istDateString()
  if (state.baselineDate !== today) {
    state = { tripped: false, baselineDate: today }
    snapshotCache = null
  }

  const snap = await fetchNifty()
  if (!snap) {
    // No live quote — hold whatever state we already had.
    return {
      enabled: true,
      tripped: state.tripped,
      dropPct: state.lastDropPct ?? null,
      tripPct, resumePct,
      reason: state.tripped ? 'Intraday circuit tripped (no live Nifty quote — held)' : undefined,
    }
  }

  state.lastDropPct = snap.dropPct

  // Edge transitions
  if (!state.tripped && snap.dropPct <= tripPct) {
    state.tripped = true
    state.trippedAt = new Date().toISOString()
    console.warn(`[intradayCircuit] TRIPPED: Nifty ${snap.dropPct.toFixed(2)}% ≤ ${tripPct}%`)
  } else if (state.tripped && snap.dropPct >= resumePct) {
    state.tripped = false
    state.trippedAt = undefined
    console.warn(`[intradayCircuit] RESUMED: Nifty ${snap.dropPct.toFixed(2)}% ≥ ${resumePct}%`)
  }

  return {
    enabled: true,
    tripped: state.tripped,
    dropPct: snap.dropPct,
    tripPct, resumePct,
    reason: state.tripped
      ? `Intraday circuit — NIFTY 50 ${snap.dropPct.toFixed(2)}% from open (≤ ${tripPct}% trip threshold). Resumes when ≥ ${resumePct}%.`
      : undefined,
  }
}

// Lightweight read-only view of the current circuit — does NOT trigger a quote
// fetch. Used by UI surfaces that just want to render the status pill.
export function getIntradayCircuitState(): { tripped: boolean; dropPct: number | null; baselineDate?: string } {
  return { tripped: state.tripped, dropPct: state.lastDropPct ?? null, baselineDate: state.baselineDate }
}
