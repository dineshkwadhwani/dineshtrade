// Typed reader for the new strategy.json schema (v2). Phase 1 of the multi-
// strategy refactor — exposes the new shape via this module so future UI and
// engine code can use it without depending on the legacy flat keys. Existing
// callers that still read strategyCfg.targets.* / strategyCfg.ema.* / etc.
// keep working unchanged because those legacy keys are preserved in the JSON.

import { getRuntimeStrategyConfig } from './strategyConfigStore'

export type StrategyType = 'dip' | 'momentum'

export interface CapitalConfig {
  source: 'live'              // available funds come from Zerodha getMargins
  perTrade: number            // ₹ per trade (auto-mode cap)
  maxBuysPerDay: number       // shared quota across all active strategies
  maxSellsPerDay: number      // shared quota
  circuitBreakerPct: number   // GIFT Nifty pre-market drop that blocks new auto-BUYs (e.g. -5). Exits + manual unaffected.
  // Intraday circuit — live NIFTY 50 vs today's open. Trips when drop ≤ tripPct,
  // resumes when drop ≥ resumePct (hysteresis prevents flapping). Both ≤ 0.
  // Disabled when either is 0 (or absent). Blocks new auto-BUYs only; exits +
  // manual orders unaffected, same shape as the morning GIFT circuit.
  intradayCircuitTripPct?: number     // e.g. -3 → trip when Nifty ≤ -3% from open
  intradayCircuitResumePct?: number   // e.g. -2 → resume when Nifty ≥ -2% from open
  // Panic-sell gate — per-symbol. If a stock drops ≥ panicDropPct in the last
  // panicWindowMin minutes (measured from peak HIGH in window vs current LTP),
  // it's flagged as a news-driven free-fall and added to a daily skip list.
  // Subsequent auto-BUY attempts on the same symbol that day are blocked.
  // Set panicDropPct = 0 (or panicWindowMin = 0) to disable. Window valid in
  // 5-min steps because we measure off the 5-min candle cache.
  panicDropPct?: number               // e.g. 3 → trip on a 3% peak-to-current drop
  panicWindowMin?: number             // e.g. 15 → look at last 15 min of 5-min candles
  maxDeployPct: number        // never deploy more than this % of available funds (default 80)
  sharedPool: boolean         // when true, every strategy draws from one pool of funds
  maxPositions: number        // open-position cap (preflight GATE 6)
  // Pyramiding controls — limit averaging-down behaviour in auto mode.
  // maxBuysPerSymbol: hard cap on consecutive BUYs accumulating into one position.
  //   Resets when the position is fully exited (Kite qty for the symbol = 0).
  // minDropBetweenBuysPct: each subsequent BUY must be at least this % below the
  //   previous BUY price. Default 10 = next BUY only if LTP ≤ previous × 0.90.
  maxBuysPerSymbol: number
  minDropBetweenBuysPct: number
}

export interface StrategyExits {
  t1Pct: number               // first target as % gain from entry
  t2Pct: number               // second target as % gain from entry
}

// Optional GIFT Nifty pre-market gate. When `enabled: true`, the strategy
// only fires if today's GIFT Nifty change% falls within [minPct, maxPct]
// (either bound may be null → open-ended). Use cases:
//   - Oscillator (mean-reversion): { enabled: true, maxPct: -0.5 } → only gap-down days
//   - Market Boom (momentum): { enabled: true, minPct: 1.0 } → only strong-up days
//   - Catalyst: { enabled: false } → fires every day, no gate
export interface GiftNiftyGate {
  enabled: boolean
  minPct?: number | null    // null/undefined = no lower bound
  maxPct?: number | null    // null/undefined = no upper bound
}

// Loose param shape — concrete fields depend on the strategy type. The cron /
// strategy runners narrow this based on `type`.
export type StrategyParams = Record<string, unknown>

export interface DipParams {
  emaPeriod: number
  entryBelowPct: number
  strongBuyBelowPct: number
  minDownDays: number
  // Capitulation floor — stocks more than this many % below 20-EMA are
  // considered crashing / news-event, not mean-reversion candidates. Skipped
  // from both BUY scans and tile rendering. Default 12 (preserves the old
  // hardcoded `capitulationFloor` constant for backward compatibility).
  capitulationFloorPct: number
  tranche2AboveEMAPct: number
  reactiveDrop: number
  reactiveIntervalMin: number
  firesOnAnyMode: boolean
  // Sector concentration gate — max DineshTrade-tracked open positions in the
  // same sector before new auto-BUYs for this strategy are blocked. Skip gate
  // when undefined / 0 or when the symbol has no sector in the watchlist.
  maxPerSector?: number
}

export interface MomentumParams {
  minDayGainPct: number
  maxDayGainPct: number
  consecutiveCandles: number
  emaProximityPct: number
  volumeAvgDays: number
  scanStartHHMM: string       // "HH:MM" 24-hr IST
  scanEndHHMM: string
  // Calendar days after first BUY before this strategy's position hands off to
  // Accumulator (the universal mean-reversion parking lot). 0 = never hand off.
  // Default 15 matches the original catalyst behaviour.
  deliveryHandoffDays: number
}

export interface Strategy {
  id: string                  // stable unique identifier
  name: string                // display label (editable)
  type: StrategyType
  active: boolean             // when false, no cron fires for it
  color: string               // hex for UI accents (tabs, tiles, etc.)
  scanIntervalMin: number     // cron cadence in minutes
  watchlist: string[]         // list keys from config/watchlist.json (e.g. ["listA"])
  params: StrategyParams
  exits: StrategyExits
  giftNiftyGate?: GiftNiftyGate  // optional pre-market mode gate; absent = no gate (always fire)
}

// ──────── ACCESSORS ────────

export function getCapital(): CapitalConfig {
  // Belt-and-braces defaults so a partially-edited strategy.json never crashes
  // the engine at runtime.
  const c = (getRuntimeStrategyConfig() as any).capital || {}
  return {
    source: c.source === 'live' ? 'live' : 'live',
    perTrade: typeof c.perTrade === 'number' ? c.perTrade : 5000,
    maxBuysPerDay: typeof c.maxBuysPerDay === 'number' ? c.maxBuysPerDay : 3,
    maxSellsPerDay: typeof c.maxSellsPerDay === 'number' ? c.maxSellsPerDay : 3,
    circuitBreakerPct: typeof c.circuitBreakerPct === 'number' ? c.circuitBreakerPct : -5,
    intradayCircuitTripPct: typeof c.intradayCircuitTripPct === 'number' ? c.intradayCircuitTripPct : 0,
    intradayCircuitResumePct: typeof c.intradayCircuitResumePct === 'number' ? c.intradayCircuitResumePct : 0,
    panicDropPct: typeof c.panicDropPct === 'number' ? c.panicDropPct : 0,
    panicWindowMin: typeof c.panicWindowMin === 'number' ? c.panicWindowMin : 0,
    maxDeployPct: typeof c.maxDeployPct === 'number' ? c.maxDeployPct : 80,
    sharedPool: c.sharedPool !== false,
    maxPositions: typeof c.maxPositions === 'number' ? c.maxPositions : 10,
    maxBuysPerSymbol: typeof c.maxBuysPerSymbol === 'number' ? c.maxBuysPerSymbol : 3,
    minDropBetweenBuysPct: typeof c.minDropBetweenBuysPct === 'number' ? c.minDropBetweenBuysPct : 10,
  }
}

export function getStrategies(): Strategy[] {
  const arr = (getRuntimeStrategyConfig() as any).strategies
  if (!Array.isArray(arr)) return []
  return arr.map(normalizeStrategy).filter(Boolean) as Strategy[]
}

export function getActiveStrategies(): Strategy[] {
  return getStrategies().filter(s => s.active)
}

export function getStrategyById(id: string): Strategy | null {
  return getStrategies().find(s => s.id === id) || null
}

// ──────── DERIVED HELPERS ────────

export interface DeployableFunds {
  available: number            // raw cash from Zerodha
  reserve: number              // available × (1 − maxDeployPct/100)
  maxDeployable: number        // available × maxDeployPct/100
  deployed: number             // sum of current open-position values
  remaining: number            // maxDeployable − deployed (clamped to >= 0)
}

export function computeDeployable(available: number, deployed: number): DeployableFunds {
  const cap = getCapital()
  const maxDeployable = (available * cap.maxDeployPct) / 100
  const reserve = available - maxDeployable
  return {
    available,
    reserve,
    maxDeployable,
    deployed,
    remaining: Math.max(0, maxDeployable - deployed),
  }
}

// ──────── INTERNAL ────────

function normalizeStrategy(raw: any): Strategy | null {
  if (!raw || typeof raw.id !== 'string') return null
  const type: StrategyType = raw.type === 'dip' ? 'dip' : 'momentum'
  let giftNiftyGate: GiftNiftyGate | undefined
  if (raw.giftNiftyGate && typeof raw.giftNiftyGate === 'object') {
    giftNiftyGate = {
      enabled: raw.giftNiftyGate.enabled === true,
      minPct: typeof raw.giftNiftyGate.minPct === 'number' ? raw.giftNiftyGate.minPct : null,
      maxPct: typeof raw.giftNiftyGate.maxPct === 'number' ? raw.giftNiftyGate.maxPct : null,
    }
  }
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : raw.id,
    type,
    active: raw.active === true,
    color: typeof raw.color === 'string' ? raw.color : '#c9a84c',
    scanIntervalMin: typeof raw.scanIntervalMin === 'number' ? raw.scanIntervalMin : 5,
    watchlist: Array.isArray(raw.watchlist) ? raw.watchlist.filter((w: any) => typeof w === 'string') : ['listA'],
    params: (raw.params && typeof raw.params === 'object') ? raw.params : {},
    exits: {
      t1Pct: typeof raw?.exits?.t1Pct === 'number' ? raw.exits.t1Pct : 1.5,
      t2Pct: typeof raw?.exits?.t2Pct === 'number' ? raw.exits.t2Pct : 2.0,
    },
    giftNiftyGate,
  }
}

// Returns:
//   { allowed: true }                   — strategy can fire
//   { allowed: false, reason: '...' }   — gate blocks it
export function checkGiftNiftyGate(gate: GiftNiftyGate | undefined, giftChangePct: number): { allowed: boolean; reason?: string } {
  if (!gate || !gate.enabled) return { allowed: true }
  const min = (gate.minPct === null || gate.minPct === undefined) ? -Infinity : gate.minPct
  const max = (gate.maxPct === null || gate.maxPct === undefined) ?  Infinity : gate.maxPct
  if (giftChangePct < min) return { allowed: false, reason: `GIFT Nifty ${giftChangePct.toFixed(2)}% < required min ${min}%` }
  if (giftChangePct > max) return { allowed: false, reason: `GIFT Nifty ${giftChangePct.toFixed(2)}% > allowed max ${max}%` }
  return { allowed: true }
}
