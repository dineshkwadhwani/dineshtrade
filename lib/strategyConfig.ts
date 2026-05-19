// Typed reader for the new strategy.json schema (v2). Phase 1 of the multi-
// strategy refactor — exposes the new shape via this module so future UI and
// engine code can use it without depending on the legacy flat keys. Existing
// callers that still read strategyCfg.targets.* / strategyCfg.ema.* / etc.
// keep working unchanged because those legacy keys are preserved in the JSON.

import strategyCfg from '@/config/strategy.json'

export type StrategyType = 'dip' | 'momentum'

export interface CapitalConfig {
  source: 'live'              // available funds come from Zerodha getMargins
  perTrade: number            // ₹ per trade (auto-mode cap)
  maxBuysPerDay: number       // shared quota across all active strategies
  maxSellsPerDay: number      // shared quota
  circuitBreakerPct: number   // Nifty drop that pauses all trades (e.g. -5)
  maxDeployPct: number        // never deploy more than this % of available funds (default 80)
  sharedPool: boolean         // when true, every strategy draws from one pool of funds
  maxPositions: number        // open-position cap (preflight GATE 6)
}

export interface StrategyExits {
  t1Pct: number               // first target as % gain from entry
  t2Pct: number               // second target as % gain from entry
}

// Loose param shape — concrete fields depend on the strategy type. The cron /
// strategy runners narrow this based on `type`.
export type StrategyParams = Record<string, unknown>

export interface DipParams {
  emaPeriod: number
  entryBelowPct: number
  strongBuyBelowPct: number
  minDownDays: number
  tranche2AboveEMAPct: number
  reactiveDrop: number
  reactiveIntervalMin: number
  firesOnAnyMode: boolean
}

export interface MomentumParams {
  minDayGainPct: number
  maxDayGainPct: number
  consecutiveCandles: number
  emaProximityPct: number
  volumeAvgDays: number
  scanStartHHMM: string       // "HH:MM" 24-hr IST
  scanEndHHMM: string
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
}

// ──────── ACCESSORS ────────

export function getCapital(): CapitalConfig {
  // Belt-and-braces defaults so a partially-edited strategy.json never crashes
  // the engine at runtime.
  const c = (strategyCfg as any).capital || {}
  return {
    source: c.source === 'live' ? 'live' : 'live',
    perTrade: typeof c.perTrade === 'number' ? c.perTrade : 5000,
    maxBuysPerDay: typeof c.maxBuysPerDay === 'number' ? c.maxBuysPerDay : 3,
    maxSellsPerDay: typeof c.maxSellsPerDay === 'number' ? c.maxSellsPerDay : 3,
    circuitBreakerPct: typeof c.circuitBreakerPct === 'number' ? c.circuitBreakerPct : -5,
    maxDeployPct: typeof c.maxDeployPct === 'number' ? c.maxDeployPct : 80,
    sharedPool: c.sharedPool !== false,
    maxPositions: typeof c.maxPositions === 'number' ? c.maxPositions : 10,
  }
}

export function getStrategies(): Strategy[] {
  const arr = (strategyCfg as any).strategies
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
  }
}
