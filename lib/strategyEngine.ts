// Strategy engine — produces buy recommendations for both Strategy 1 (Oscillator)
// and Strategy 2 (Daily Catalyst). Mode is picked from GIFT Nifty change %.
//
// Used by the /api/strategy HTTP route (Manual) and the cron tick (Auto).

import { getWatchlist } from './watchlistStore'
import strategyCfg from '@/config/strategy.json'
import { getStrategyById, getActiveStrategies, getCapital, checkGiftNiftyGate, type Strategy } from './strategyConfig'
import { getMarketBriefing } from './marketBriefing'
import { getState } from './state'
import {
  resolveAccountCreds, getQuotes, getHistoricalCandles, type KiteCreds,
} from './kite'
import { getInstrumentTokens } from './instruments'
import { loadAndRefreshCloses } from './dailyCloses'
import { computeEMA, consecutiveDownDays, deviationPct } from './ema'

// ──────── DAILY-AGGREGATE CACHE (Strategy 2 momentum) ────────
// Cache EMA + 10-day avg volume per symbol, keyed by IST date. Reset each day.
interface DailyAggregate {
  ema20: number
  avgVolume10d: number
  prevClose: number
}
const dailyAggregateCache = new Map<string, { date: string; data: DailyAggregate }>()

function istDateString(): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`
}

function istMinutesSinceMidnight(): number {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return ist.getHours() * 60 + ist.getMinutes()
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10))
  return h * 60 + m
}

interface WatchlistStock { nse: string; name?: string; trades?: number }

export type PriceSource = 'kite_live' | 'briefing_cmp'

export interface Recommendation {
  symbol: string
  name: string
  price: number
  priceSource: PriceSource
  dayChangePct?: number    // today's % change from previous close — for direction indicator on Engine
  action: string
  strategy: 'catalyst' | 'accumulator'
  source: string
  reason: string
  target1: number
  target2: number
  suggestedQty: number
  confidence: 'normal' | 'high'
}
// NOTE: No `stopLoss` field — per "Never sell at a loss" rule (CB1 in functional
// spec). Preflight gate 8 (no-loss-sell rider) makes auto-SELL impossible below
// entry, so an SL number would be misleading. Manual SELLs are user judgement.

export type StrategyMode = 'catalyst' | 'dip' | 'circuit' | 'error'

export interface StrategyResult {
  mode: StrategyMode
  recommendations: Recommendation[]
  message?: string
  giftChangePct?: number
  counts?: {
    briefingRecs?: number
    skippedOffWatchlist?: number
    skippedNoPrice?: number
    skippedNoToken?: number
    skippedNoHistorical?: number
    skippedDownDays?: number
    skippedNotStretched?: number
    produced: number
  }
  priceSource?: PriceSource
  generatedAt: string
}

function parsePct(s: string | undefined): number {
  if (!s) return 0
  const v = parseFloat(String(s).replace(/[%\s]/g, '').replace('+', ''))
  return isNaN(v) ? 0 : v
}

function parseNumber(s: string | undefined): number | null {
  if (s === undefined || s === null) return null
  const v = parseFloat(String(s).replace(/[,₹\s]/g, ''))
  return isNaN(v) ? null : v
}

function ymdIST(daysOffset = 0): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  ist.setDate(ist.getDate() + daysOffset)
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`
}

// Run async work with a concurrency cap (semaphore pattern).
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

// Find a connected account's creds — used by both strategies for /quote and /historical.
// The data is account-agnostic (the same LTP, same candle); we just need someone's tokens.
async function firstConnectedCreds(): Promise<KiteCreds | null> {
  // Iterate ALL tokens (not just the first) and return creds for the first one
  // that actually resolves. Without this, orphaned tokens in state.kiteTokens
  // for accounts that have since been commented out of env would short-circuit
  // the lookup and cause every strategy call to fail with "No Kite account".
  const state = await getState()
  for (const account of Object.keys(state.kiteTokens)) {
    const r = await resolveAccountCreds(account)
    if (r.ok) return { apiKey: r.apiKey, accessToken: r.accessToken }
  }
  return null
}

// ──────── MARKET MODE (cached briefing) ────────
// Briefing comes from AI provider — expensive (₹ + latency). Cache per IST day.
// Both the HTTP route and the cron tick share this cache.

let briefingCache: { date: string; result: Awaited<ReturnType<typeof getMarketBriefing>> } | null = null

async function getMarketBriefingCached(): Promise<Awaited<ReturnType<typeof getMarketBriefing>>> {
  const today = istDateString()
  if (briefingCache && briefingCache.date === today) return briefingCache.result
  const r = await getMarketBriefing()
  if (r.ok) briefingCache = { date: today, result: r }
  return r
}

export interface MarketModeInfo { mode: StrategyMode; giftChangePct: number }

export async function getMarketMode(): Promise<MarketModeInfo | null> {
  const briefing = await getMarketBriefingCached()
  if (!briefing.ok || !briefing.data) return null
  const giftChangePct = parsePct(briefing.data.giftNifty?.change)
  const circuitThreshold = strategyCfg.limits.circuitBreakerPct
  let mode: StrategyMode = 'catalyst'
  if (giftChangePct <= circuitThreshold) mode = 'circuit'
  else if (giftChangePct <= -0.5) mode = 'dip'
  return { mode, giftChangePct }
}

// ──────── PUBLIC ENTRY POINT ────────

export async function generateRecommendations(): Promise<StrategyResult> {
  const now = new Date().toISOString()

  const modeInfo = await getMarketMode()
  if (!modeInfo) {
    return {
      mode: 'error', recommendations: [],
      message: 'Could not fetch market briefing for mode detection',
      generatedAt: now,
    }
  }
  const { mode, giftChangePct } = modeInfo

  if (mode === 'circuit') {
    return {
      mode, recommendations: [], giftChangePct,
      message: `Circuit breaker — GIFT Nifty ${giftChangePct.toFixed(2)}%. No trades today.`,
      generatedAt: now,
    }
  }

  if (mode === 'dip') return await runStrategy1(now, giftChangePct)
  return await runStrategy2(now, giftChangePct)
}

// ──────── STRATEGY 2 — MOMENTUM SCANNER ────────
// Replaces the old broker-rec filter. Scans List A every 5 min during 9:30–14:30 IST
// looking for stocks with all four conditions:
//   1. Up 0.5%–1.5% from yesterday's close
//   2. Last 3 consecutive 5-min candles each higher than the previous
//   3. Today's volume so far > 10-day avg daily volume × (elapsed / 375 min session)
//   4. Current price within ±3% of 20-day EMA

// Pulls Strategy 2 params from the optional `strategy` argument; falls back
// to the canonical 'catalyst' entry in strategy.json. Allowing this lets
// multiple momentum strategies (Catalyst, Market Boom, …) share this engine
// while running with their own per-strategy params + watchlist + exits.
async function runStrategy2(now: string, giftChangePct: number, strategyOverride?: Strategy): Promise<StrategyResult> {
  const strategy = strategyOverride || getStrategyById('catalyst')
  const params = (strategy?.params || {}) as Record<string, any>
  const cfg = {
    minDayGainPct: params.minDayGainPct ?? strategyCfg.strategy2_momentum?.minDayGainPct ?? 0.5,
    maxDayGainPct: params.maxDayGainPct ?? strategyCfg.strategy2_momentum?.maxDayGainPct ?? 1.5,
    emaProximityPct: params.emaProximityPct ?? strategyCfg.strategy2_momentum?.emaProximityPct ?? 3.0,
    consecutiveCandles: params.consecutiveCandles ?? strategyCfg.strategy2_momentum?.consecutiveCandles ?? 3,
    scanStartHHMM: params.scanStartHHMM ?? strategyCfg.strategy2_momentum?.scanStartHHMM ?? '09:30',
    scanEndHHMM: params.scanEndHHMM ?? strategyCfg.strategy2_momentum?.scanEndHHMM ?? '14:30',
    volumeAvgDays: params.volumeAvgDays ?? strategyCfg.strategy2_momentum?.volumeAvgDays ?? 10,
  }
  const exitT1 = strategy?.exits?.t1Pct ?? strategyCfg.targets.intraday_t1_pct ?? 1.5
  const exitT2 = strategy?.exits?.t2Pct ?? strategyCfg.targets.intraday_t2_pct ?? 2.0
  const watchlistKeys = strategy?.watchlist || ['listA']
  const SESSION_MINUTES = 375  // 9:15 → 15:30

  // Window check — only run BUY scan between scanStart and scanEnd
  const nowMin = istMinutesSinceMidnight()
  const startMin = hhmmToMinutes(cfg.scanStartHHMM)
  const endMin = hhmmToMinutes(cfg.scanEndHHMM)
  if (nowMin < startMin) {
    return {
      mode: 'catalyst', recommendations: [], giftChangePct,
      message: `Strategy 2 momentum scan opens at ${cfg.scanStartHHMM} IST.`,
      generatedAt: now,
    }
  }
  if (nowMin > endMin) {
    return {
      mode: 'catalyst', recommendations: [], giftChangePct,
      message: `Strategy 2 momentum scan closed at ${cfg.scanEndHHMM} IST. No new entries; existing positions monitored till 15:00.`,
      generatedAt: now,
    }
  }

  // 1. Need a connected Kite account
  const creds = await firstConnectedCreds()
  if (!creds) {
    return {
      mode: 'catalyst', recommendations: [], giftChangePct,
      message: 'No Kite account connected — Login with Kite in Settings to run Strategy 2.',
      generatedAt: now,
    }
  }

  // 2. Universe from strategy.watchlist (default ['listA'])
  const wl = await getWatchlist()
  const universe: WatchlistStock[] = watchlistKeys.flatMap(k => wl.lists[k] || []) as any[]
  const symbols = universe.map(s => s.nse.toUpperCase())
  const nameBySymbol = new Map(universe.map(s => [s.nse.toUpperCase(), s.name || s.nse]))

  // 3. Load daily aggregates (EMA + 10-day avg vol + prev close) — cached per IST date
  await ensureDailyAggregates(creds, symbols, cfg.volumeAvgDays)

  // 4. Batched live quote for all List A
  const quotes = await getQuotes(creds, symbols)

  // 5. Cheap filters first — eliminate most symbols before fetching 5-min candles
  const cheapPassed: Array<{ symbol: string; ltp: number; volume: number; agg: DailyAggregate }> = []
  let skippedNoQuote = 0
  let skippedNoAgg = 0
  let skippedGainOutOfRange = 0
  let skippedEMAExtended = 0
  let skippedVolumeWeak = 0

  const elapsedMin = Math.max(1, nowMin - hhmmToMinutes('09:15'))

  for (const symbol of symbols) {
    const q = quotes[`NSE:${symbol}`]
    if (!q?.last_price) { skippedNoQuote++; continue }
    const ltp = q.last_price
    const todayVol = (q as any).volume || (q as any).volume_traded || 0

    const aggEntry = dailyAggregateCache.get(symbol)
    if (!aggEntry || aggEntry.date !== istDateString()) { skippedNoAgg++; continue }
    const agg = aggEntry.data

    // Condition 1: gain from yesterday close
    if (!agg.prevClose) { skippedNoAgg++; continue }
    const dayGainPct = ((ltp - agg.prevClose) / agg.prevClose) * 100
    if (dayGainPct < cfg.minDayGainPct || dayGainPct > cfg.maxDayGainPct) {
      skippedGainOutOfRange++; continue
    }

    // Condition 4: within ±3% of EMA
    const emaDev = deviationPct(ltp, agg.ema20)
    if (Math.abs(emaDev) > cfg.emaProximityPct) { skippedEMAExtended++; continue }

    // Condition 3: volume proration
    const proratedAvgVol = agg.avgVolume10d * (elapsedMin / SESSION_MINUTES)
    if (todayVol < proratedAvgVol) { skippedVolumeWeak++; continue }

    cheapPassed.push({ symbol, ltp, volume: todayVol, agg })
  }

  // 6. Expensive filter — fetch 5-min candles only for the few that passed cheap checks
  let skippedNoCandles = 0
  let skippedNotRising = 0
  const survivors: Array<{ symbol: string; ltp: number; agg: DailyAggregate; dayGainPct: number }> = []

  for (const c of cheapPassed) {
    let candles
    try {
      // Today's intraday 5-min candles: from today 9:15 to now
      const from = `${istDateString()} 09:15:00`
      const to = `${istDateString()} 15:30:00`
      const aggEntry = dailyAggregateCache.get(c.symbol)!
      const token = await import('./instruments').then(m => m.getInstrumentToken(creds, c.symbol))
      if (!token) { skippedNoCandles++; continue }
      candles = await getHistoricalCandles(creds, token, from, to, '5minute')
    } catch (err) {
      skippedNoCandles++
      continue
    }
    if (candles.length < cfg.consecutiveCandles) { skippedNoCandles++; continue }

    // Check last N candles are monotonically rising
    const lastN = candles.slice(-cfg.consecutiveCandles)
    let rising = true
    for (let i = 1; i < lastN.length; i++) {
      if (lastN[i].close <= lastN[i - 1].close) { rising = false; break }
    }
    if (!rising) { skippedNotRising++; continue }

    const dayGainPct = ((c.ltp - c.agg.prevClose) / c.agg.prevClose) * 100
    survivors.push({ symbol: c.symbol, ltp: c.ltp, agg: c.agg, dayGainPct })
  }

  // 7. Build recommendations from survivors
  const recs: Recommendation[] = []
  for (const s of survivors) {
    const perTrade = strategyCfg.capital.perTrade
    const qty = Math.floor(perTrade / s.ltp)
    if (qty < 1) continue

    const t1 = +(s.ltp * (1 + exitT1 / 100)).toFixed(2)
    const t2 = +(s.ltp * (1 + exitT2 / 100)).toFixed(2)

    recs.push({
      symbol: s.symbol,
      name: nameBySymbol.get(s.symbol) || s.symbol,
      price: s.ltp,
      priceSource: 'kite_live',
      dayChangePct: s.dayGainPct,
      action: 'BUY',
      strategy: 'catalyst',
      source: 'Momentum scan',
      reason: `+${s.dayGainPct.toFixed(2)}% today, ${cfg.consecutiveCandles} rising 5-min candles, vol > prorated 10-day avg, within ${cfg.emaProximityPct}% of 20-EMA (₹${s.agg.ema20.toFixed(2)})`,
      target1: t1,
      target2: t2,
      suggestedQty: qty,
      confidence: 'normal',
    })
  }

  // Sort by day gain ascending (least extended first — more room to run)
  recs.sort((a, b) => a.price - b.price)

  return {
    mode: 'catalyst',
    recommendations: recs.slice(0, 5),
    giftChangePct,
    counts: {
      skippedOffWatchlist: 0,
      skippedNoPrice: skippedNoQuote,
      skippedNoToken: skippedNoAgg,
      skippedNoHistorical: skippedNoCandles,
      skippedDownDays: skippedNotRising,        // reusing field — "not 3 rising candles"
      skippedNotStretched: skippedGainOutOfRange + skippedEMAExtended + skippedVolumeWeak,
      produced: recs.length,
    },
    priceSource: 'kite_live',
    message: recs.length === 0
      ? `No List A stocks meet the momentum criteria at ${Math.floor(nowMin/60).toString().padStart(2,'0')}:${(nowMin%60).toString().padStart(2,'0')} IST. Will re-scan next tick.`
      : undefined,
    generatedAt: now,
  }
}

// Load (or refresh) the daily-aggregate cache for given symbols. Once per IST day.
async function ensureDailyAggregates(creds: KiteCreds, symbols: string[], volumeAvgDays: number): Promise<void> {
  const today = istDateString()
  const stale = symbols.filter(s => {
    const entry = dailyAggregateCache.get(s)
    return !entry || entry.date !== today
  })
  if (stale.length === 0) return

  // Disk-backed rolling cache of daily closes. On most days this is a tiny
  // incremental fetch (yesterday's bar only); on cold-start it does the
  // full 60-day window. Failures are logged inside loadAndRefreshCloses.
  const closesBySymbol = await loadAndRefreshCloses(creds, stale)
  const emaPeriod = strategyCfg.ema?.period ?? 20

  for (const symbol of stale) {
    const bars = closesBySymbol[symbol]
    if (!bars || bars.length < emaPeriod + 2) {
      // Not enough history yet (e.g. recent listing, fetch failed cold). Skip;
      // tile evaluator will render '—' for this symbol's EMA-dependent rules.
      continue
    }
    const closes = bars.map(b => b.close)
    const emas = computeEMA(closes, emaPeriod)
    const ema20 = emas[emas.length - 1]
    const prevClose = closes[closes.length - 1]
    const lastN = bars.slice(-volumeAvgDays)
    const avgVolume10d = lastN.reduce((sum, c) => sum + c.volume, 0) / Math.max(1, lastN.length)
    if (!ema20 || isNaN(ema20) || !prevClose) continue
    dailyAggregateCache.set(symbol, { date: today, data: { ema20, avgVolume10d, prevClose } })
  }
}

// ──────── TILES — per-symbol per-rule evaluation for the Engine page UI ────────
//
// The cron/strategy logic above is UNCHANGED. This is a parallel evaluation
// path that reuses the exact same rule checks (same thresholds from
// strategy.json) but records each rule's pass/fail status per symbol so the
// UI can render a tile showing "X of 8 rules met".
//
// Auto-BUY behavior is unchanged: the cron still only fires on stocks that
// pass all rules — which corresponds to an 8/8 tile here.

export interface RuleEval {
  id: string
  label: string
  passed: boolean
  actual: string          // human-readable actual value, e.g. "+1.2%" or "0.8× avg"
  threshold?: string      // human-readable threshold, e.g. "0.5%–1.5%"
  skipped?: boolean       // true when the expensive rule wasn't evaluated (gated by earlier failure)
}

export interface Tile {
  symbol: string
  name: string
  ltp: number
  prevClose: number
  dayChangePct: number
  rules: RuleEval[]
  score: number          // count of passed rules
  total: number          // total rules
}

export interface TileEvalResult {
  catalyst: Tile[]
  oscillator: Tile[]
  // Tiles keyed by strategy id — populated for every ACTIVE strategy. Built
  // strategies (oscillator, catalyst) share these arrays; new active
  // strategies get their own slot here. Engine page reads this to render
  // one tab per active strategy.
  tilesByStrategy: Record<string, Tile[]>
  activeStrategies: Array<{ id: string; name: string; color: string; type: string; scanIntervalMin: number }>
  recommendedTab: string       // strategy id (was: 'catalyst' | 'accumulator')
  giftChangePct: number
  generatedAt: string
  catalystScanOpen: boolean
  message?: string
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export async function evaluateAllForTiles(): Promise<TileEvalResult> {
  const generatedAt = new Date().toISOString()

  const active = getActiveStrategies()
  const activeSummary = active.map(s => ({
    id: s.id, name: s.name, color: s.color, type: s.type, scanIntervalMin: s.scanIntervalMin,
  }))

  // Default empty result (returned on early exits)
  const empty: TileEvalResult = {
    catalyst: [], oscillator: [],
    tilesByStrategy: Object.fromEntries(active.map(s => [s.id, []])),
    activeStrategies: activeSummary,
    recommendedTab: active[0]?.id || 'catalyst',
    giftChangePct: 0,
    catalystScanOpen: false,
    generatedAt,
  }

  const creds = await firstConnectedCreds()
  if (!creds) return { ...empty, message: 'No Kite account connected — Login with Kite in Settings.' }

  const listA: WatchlistStock[] = (await getWatchlist()).lists.listA || []
  if (listA.length === 0) return { ...empty, message: 'List A is empty.' }
  const symbols = listA.map(s => s.nse.toUpperCase())
  const nameBySymbol = new Map(listA.map(s => [s.nse.toUpperCase(), s.name || s.nse]))

  // Market mode → recommended tab
  let giftChangePct = 0
  try {
    const mode = await getMarketMode()
    if (mode) giftChangePct = mode.giftChangePct
  } catch { /* fallback to 0 */ }
  // recommendedTab is now computed at the end against active strategies — see bottom of fn.

  // Live quotes (batched) + daily aggregates (cached).
  // Catalyst (Strategy 2) thresholds: prefer the user's edited catalyst params,
  // fall back to the legacy strategy2_momentum block. Same pattern as the
  // oscillator wiring below.
  const catStrategy = active.find(s => s.id === 'catalyst')
  const catParams = (catStrategy?.params || {}) as Record<string, unknown>
  const legacyS2 = strategyCfg.strategy2_momentum
  const s2cfg = {
    scanStartHHMM:     typeof catParams.scanStartHHMM === 'string'     ? catParams.scanStartHHMM     : legacyS2.scanStartHHMM,
    scanEndHHMM:       typeof catParams.scanEndHHMM === 'string'       ? catParams.scanEndHHMM       : legacyS2.scanEndHHMM,
    minDayGainPct:     typeof catParams.minDayGainPct === 'number'     ? catParams.minDayGainPct     : legacyS2.minDayGainPct,
    maxDayGainPct:     typeof catParams.maxDayGainPct === 'number'     ? catParams.maxDayGainPct     : legacyS2.maxDayGainPct,
    emaProximityPct:   typeof catParams.emaProximityPct === 'number'   ? catParams.emaProximityPct   : legacyS2.emaProximityPct,
    consecutiveCandles:typeof catParams.consecutiveCandles === 'number'? catParams.consecutiveCandles: legacyS2.consecutiveCandles,
    volumeAvgDays:     typeof catParams.volumeAvgDays === 'number'     ? catParams.volumeAvgDays     : legacyS2.volumeAvgDays,
  }
  // Capital block — read the runtime overlay so user edits in Settings show up
  // immediately on tiles (not just on the cron's BUY decisions).
  const capCfg = getCapital()
  await ensureDailyAggregates(creds, symbols, s2cfg.volumeAvgDays)
  const quotes = await getQuotes(creds, symbols).catch(() => ({} as Awaited<ReturnType<typeof getQuotes>>))

  // Scan window status (Strategy 2 only — uses scanStartHHMM/scanEndHHMM)
  const nowMin = istMinutesSinceMidnight()
  const s2start = hhmmToMinutes(s2cfg.scanStartHHMM)
  const s2end = hhmmToMinutes(s2cfg.scanEndHHMM)
  const catalystScanOpen = nowMin >= s2start && nowMin <= s2end
  const SESSION_MINUTES = 375
  const elapsedMin = Math.max(1, nowMin - hhmmToMinutes('09:15'))

  // Market hours check (Strategy 1) — 9:15–15:30
  const marketOpenMin = hhmmToMinutes('09:15')
  const marketCloseMin = hhmmToMinutes('15:30')
  const marketOpen = nowMin >= marketOpenMin && nowMin <= marketCloseMin

  // Strategy 1 (Oscillator) thresholds. Prefer the live oscillator strategy's
  // params (so the tile visualisation reflects what the cron will actually use);
  // fall back to the legacy `ema` block + hardcoded defaults if the strategy
  // doesn't expose them.
  const oscStrategy = active.find(s => s.id === 'accumulator')
  const oscParams = (oscStrategy?.params || {}) as Record<string, unknown>
  const legacyEma = strategyCfg.ema || { period: 20, entryBelowPct: 5, strongBuyBelowPct: 8, minDownDays: 3 }
  const emaCfg = {
    period:           typeof oscParams.emaPeriod === 'number'        ? oscParams.emaPeriod        : legacyEma.period,
    entryBelowPct:    typeof oscParams.entryBelowPct === 'number'    ? oscParams.entryBelowPct    : legacyEma.entryBelowPct,
    strongBuyBelowPct:typeof oscParams.strongBuyBelowPct === 'number'? oscParams.strongBuyBelowPct: legacyEma.strongBuyBelowPct,
    minDownDays:      typeof oscParams.minDownDays === 'number'      ? oscParams.minDownDays      : legacyEma.minDownDays,
  }
  const reactiveDropPct = typeof oscParams.reactiveDrop === 'number' ? oscParams.reactiveDrop : 3
  // Capitulation floor — tiles hide / mark red anything more than this many %
  // below 20-EMA (panic / news-event territory, not mean-reversion). Default 12
  // matches the old hardcoded value.
  const capitulationFloor = typeof oscParams.capitulationFloorPct === 'number' ? oscParams.capitulationFloorPct : 12

  // Per-symbol data snapshot used by both Catalyst + Oscillator rule evaluations.
  // We populate this once from quotes + the daily-aggregate cache.
  const dataBySymbol = new Map<string, {
    ltp: number; volume: number; prevClose: number; ema20: number; avgVol10d: number;
    hasQuote: boolean; hasAgg: boolean;
  }>()

  for (const sym of symbols) {
    const q: any = quotes[`NSE:${sym}`]
    const ltp = Number(q?.last_price) || 0
    const volume = Number(q?.volume || q?.volume_traded) || 0
    const agg = dailyAggregateCache.get(sym)?.data
    const prevClose = Number(q?.ohlc?.close) || agg?.prevClose || 0
    const ema20 = agg?.ema20 || 0
    const avgVol10d = agg?.avgVolume10d || 0
    dataBySymbol.set(sym, {
      ltp, volume, prevClose, ema20, avgVol10d,
      hasQuote: ltp > 0,
      hasAgg: !!agg && ema20 > 0,
    })
  }

  // 5-min candle check — evaluated for EVERY List A symbol so the rule always
  // resolves to green/red on the tile (never "not evaluated"). At Kite's
  // historical rate limit (~3/sec safe) this takes ~30 sec for 80 symbols on
  // a cold cache; subsequent calls within 60 sec hit Next.js' route handler
  // cache. The `_logFirst` flag prints the raw request + response for the
  // first symbol so we can see exactly what Kite returns.
  const risingBySymbol = new Map<string, boolean>()
  const { getInstrumentToken } = await import('./instruments')
  const today = istDateString()
  const fromTs = `${today} 09:15:00`
  const toTs = `${today} 15:30:00`
  let logged = false
  await mapWithLimit(symbols, 5, async (symbol) => {
    try {
      const token = await getInstrumentToken(creds, symbol)
      if (!token) { risingBySymbol.set(symbol, false); return }
      const shouldLog = !logged
      if (shouldLog) logged = true
      const candles = await getHistoricalCandles(creds, token, fromTs, toTs, '5minute', shouldLog)
      if (shouldLog) {
        console.log(`[tiles candles] ${symbol}: parsed ${candles.length} candle(s). Last 4 closes: ${candles.slice(-4).map(c => c.close.toFixed(2)).join(' → ')}`)
      }
      if (candles.length < s2cfg.consecutiveCandles) { risingBySymbol.set(symbol, false); return }
      const lastN = candles.slice(-s2cfg.consecutiveCandles)
      let rising = true
      for (let i = 1; i < lastN.length; i++) {
        if (lastN[i].close <= lastN[i - 1].close) { rising = false; break }
      }
      risingBySymbol.set(symbol, rising)
    } catch (err) {
      console.warn(`[tiles candles] ${symbol} failed:`, String(err).slice(0, 120))
      risingBySymbol.set(symbol, false)
    }
  })

  // Build Catalyst + Oscillator tiles in parallel
  const catalyst: Tile[] = []
  const oscillator: Tile[] = []

  for (const sym of symbols) {
    const d = dataBySymbol.get(sym)!
    const dayGainPct = d.prevClose > 0 ? ((d.ltp - d.prevClose) / d.prevClose) * 100 : 0
    const emaDev = d.ema20 > 0 ? ((d.ltp - d.ema20) / d.ema20) * 100 : 0
    const proratedAvgVol = d.avgVol10d * (elapsedMin / SESSION_MINUTES)

    // ── CATALYST RULES (8) ──
    const catRules: RuleEval[] = []
    catRules.push({
      id: 'scan_window',
      label: `Within scan window (${s2cfg.scanStartHHMM}–${s2cfg.scanEndHHMM} IST)`,
      passed: catalystScanOpen,
      actual: catalystScanOpen ? 'inside window' : 'outside window',
      threshold: `${s2cfg.scanStartHHMM}–${s2cfg.scanEndHHMM}`,
    })
    catRules.push({
      id: 'gain_min',
      label: `Day gain ≥ ${s2cfg.minDayGainPct >= 0 ? '+' : ''}${s2cfg.minDayGainPct}%`,
      passed: d.hasQuote && d.hasAgg && dayGainPct >= s2cfg.minDayGainPct,
      actual: d.hasQuote && d.hasAgg ? fmtPct(dayGainPct) : '—',
      threshold: `≥ ${s2cfg.minDayGainPct >= 0 ? '+' : ''}${s2cfg.minDayGainPct}%`,
    })
    catRules.push({
      id: 'gain_max',
      label: `Day gain ≤ ${s2cfg.maxDayGainPct >= 0 ? '+' : ''}${s2cfg.maxDayGainPct}%`,
      passed: d.hasQuote && d.hasAgg && dayGainPct <= s2cfg.maxDayGainPct,
      actual: d.hasQuote && d.hasAgg ? fmtPct(dayGainPct) : '—',
      threshold: `≤ ${s2cfg.maxDayGainPct >= 0 ? '+' : ''}${s2cfg.maxDayGainPct}%`,
    })
    const candleRising = risingBySymbol.get(sym) === true
    catRules.push({
      id: 'rising_candles',
      label: `${s2cfg.consecutiveCandles}+ rising 5-min candles`,
      passed: candleRising,
      actual: candleRising ? `last ${s2cfg.consecutiveCandles} rising` : 'not rising',
      threshold: `${s2cfg.consecutiveCandles} in a row`,
    })
    const volMult = proratedAvgVol > 0 ? d.volume / proratedAvgVol : 0
    catRules.push({
      id: 'volume',
      label: 'Volume > prorated 10-day avg',
      passed: d.hasAgg && d.volume > 0 && proratedAvgVol > 0 && d.volume >= proratedAvgVol,
      actual: d.hasAgg && proratedAvgVol > 0 ? `${volMult.toFixed(2)}× avg` : '—',
      threshold: '> 1.00×',
    })
    catRules.push({
      id: 'ema_proximity',
      label: `LTP within ±${s2cfg.emaProximityPct}% of 20-EMA`,
      passed: d.hasAgg && Math.abs(emaDev) <= s2cfg.emaProximityPct,
      actual: d.hasAgg ? `${emaDev >= 0 ? '+' : ''}${emaDev.toFixed(2)}% vs EMA ₹${d.ema20.toFixed(2)}` : '—',
      threshold: `±${s2cfg.emaProximityPct}%`,
    })
    catRules.push({
      id: 'data',
      label: 'Live quote + 20-EMA available',
      passed: d.hasQuote && d.hasAgg,
      actual: d.hasQuote && d.hasAgg ? 'OK' : !d.hasQuote ? 'no quote' : 'no EMA',
    })
    // Funds: rule shows whether per-trade cap can be afforded. Since we don't
    // know per-account funds in this evaluator (it's account-agnostic), we
    // treat it as a structural check — per-trade cap defined > 0. The route
    // layer can overlay account-specific funds availability if needed.
    catRules.push({
      id: 'funds',
      label: 'Per-trade cap configured',
      passed: capCfg.perTrade > 0,
      actual: `₹${capCfg.perTrade.toLocaleString('en-IN')}`,
      threshold: `> 0`,
    })

    catalyst.push({
      symbol: sym,
      name: nameBySymbol.get(sym) || sym,
      ltp: d.ltp,
      prevClose: d.prevClose,
      dayChangePct: dayGainPct,
      rules: catRules,
      score: catRules.filter(r => r.passed).length,
      total: catRules.length,
    })

    // ── OSCILLATOR RULES (8) ──
    // We don't have consecutiveDownDays cached, so we approximate from
    // historical candles via the daily aggregate cache. The aggregate doesn't
    // currently store down-days, so we mark the rule as evaluated only when
    // the cache has fresh data and skip otherwise.
    const oscRules: RuleEval[] = []
    oscRules.push({
      id: 'market_open',
      label: 'Market open (9:15–15:30 IST)',
      passed: marketOpen,
      actual: marketOpen ? 'open' : 'closed',
      threshold: '09:15–15:30',
    })
    oscRules.push({
      id: 'ema_available',
      label: '20-day EMA computable',
      passed: d.hasAgg,
      actual: d.hasAgg ? `₹${d.ema20.toFixed(2)}` : '—',
    })
    oscRules.push({
      id: 'below_ema_min',
      label: `LTP ≥ ${emaCfg.entryBelowPct}% below 20-EMA`,
      passed: d.hasAgg && emaDev <= -emaCfg.entryBelowPct,
      actual: d.hasAgg ? `${emaDev.toFixed(2)}% vs EMA` : '—',
      threshold: `≤ −${emaCfg.entryBelowPct}%`,
    })
    oscRules.push({
      id: 'below_ema_max',
      label: `LTP ≤ ${capitulationFloor}% below 20-EMA (not panic)`,
      passed: d.hasAgg && emaDev >= -capitulationFloor,
      actual: d.hasAgg ? `${emaDev.toFixed(2)}% vs EMA` : '—',
      threshold: `≥ −${capitulationFloor}%`,
    })
    // Today as down day if intraday drop ≥ the strategy's reactiveDrop %
    // (matches what the live reactive scan uses to decide a BUY).
    const todayDown = dayGainPct <= -reactiveDropPct
    oscRules.push({
      id: 'intraday_drop',
      label: `Today ≥${reactiveDropPct}% drop (reactive trigger)`,
      passed: todayDown,
      actual: d.hasQuote && d.hasAgg ? fmtPct(dayGainPct) : '—',
      threshold: `≤ −${reactiveDropPct}%`,
    })
    oscRules.push({
      id: 'live_data',
      label: 'Live LTP available',
      passed: d.hasQuote,
      actual: d.hasQuote ? `₹${d.ltp.toFixed(2)}` : '—',
    })
    oscRules.push({
      id: 'funds',
      label: 'Per-trade cap configured',
      passed: capCfg.perTrade > 0,
      actual: `₹${capCfg.perTrade.toLocaleString('en-IN')}`,
    })
    oscRules.push({
      id: 'position_room',
      label: `Position cap (max ${capCfg.maxPositions})`,
      passed: capCfg.maxPositions > 0,
      actual: `cap = ${capCfg.maxPositions}`,
    })

    oscillator.push({
      symbol: sym,
      name: nameBySymbol.get(sym) || sym,
      ltp: d.ltp,
      prevClose: d.prevClose,
      dayChangePct: dayGainPct,
      rules: oscRules,
      score: oscRules.filter(r => r.passed).length,
      total: oscRules.length,
    })
  }

  // Sort by score descending, then by symbol asc within same score
  // Sort: highest score first (better prospects on top). Within the same
  // score tier, break ties by today's day change descending — a stock that's
  // already moving in the strategy's favour is a better next-tick candidate
  // than one sitting flat. Finally fall back to alphabetical for full ties.
  const byScore = (a: Tile, b: Tile) =>
    b.score - a.score ||
    b.dayChangePct - a.dayChangePct ||
    a.symbol.localeCompare(b.symbol)
  catalyst.sort(byScore)
  oscillator.sort(byScore)

  // tilesByStrategy: each active strategy gets a tile array. For the canonical
  // 'catalyst' / 'accumulator' strategies, reuse the arrays we just built. For
  // any other active momentum strategy (e.g. Market Boom), we surface the
  // catalyst tiles as a *starting* approximation — Phase 3 doesn't yet rebuild
  // tile evaluation per strategy params; that's Phase 4. The cron framework
  // already uses the strategy's own params for BUY decisions, so behaviour-
  // wise auto-mode is correct; only the per-tab tile rule display is shared.
  const tilesByStrategy: Record<string, Tile[]> = {}
  for (const s of active) {
    if (s.id === 'accumulator') tilesByStrategy[s.id] = oscillator
    else if (s.id === 'catalyst') tilesByStrategy[s.id] = catalyst
    else if (s.type === 'momentum') tilesByStrategy[s.id] = catalyst
    else if (s.type === 'dip') tilesByStrategy[s.id] = oscillator
    else tilesByStrategy[s.id] = []
  }

  // Pick recommended tab: the one matching market mode if among active,
  // else the first active strategy.
  let chosenTab = active[0]?.id || 'catalyst'
  if (giftChangePct < -0.5) {
    const dipStrat = active.find(s => s.type === 'dip')
    if (dipStrat) chosenTab = dipStrat.id
  } else {
    const momStrat = active.find(s => s.type === 'momentum')
    if (momStrat) chosenTab = momStrat.id
  }

  return {
    catalyst, oscillator,
    tilesByStrategy,
    activeStrategies: activeSummary,
    recommendedTab: chosenTab,
    giftChangePct, catalystScanOpen, generatedAt,
  }
}

// ──────── GENERIC DISPATCHER ────────
// Picks the right inner scanner based on the strategy's type. Applies the
// optional GIFT Nifty gate (e.g. Oscillator only fires on gap-down days)
// before delegating. Used by the per-strategy cron tasks.
export async function runStrategyScan(strategy: Strategy): Promise<StrategyResult> {
  const now = new Date().toISOString()
  const giftChangePct = (await getMarketMode())?.giftChangePct ?? 0

  // Apply GIFT Nifty gate first — short-circuit if today's pre-market signal
  // is outside this strategy's configured range. Returns a clear message so
  // the cron log and Engine UI show why the strategy didn't fire.
  const gate = checkGiftNiftyGate(strategy.giftNiftyGate, giftChangePct)
  if (!gate.allowed) {
    return {
      mode: strategy.type === 'dip' ? 'dip' : 'catalyst',
      recommendations: [], giftChangePct,
      message: `${strategy.name}: GIFT Nifty gate blocked — ${gate.reason}`,
      generatedAt: now,
    }
  }

  if (strategy.type === 'momentum') return runStrategy2(now, giftChangePct, strategy)
  if (strategy.type === 'dip')      return runStrategy1(now, giftChangePct, strategy)
  return {
    mode: 'error', recommendations: [], giftChangePct,
    message: `Unknown strategy type "${strategy.type}" for "${strategy.id}".`,
    generatedAt: now,
  }
}

// ──────── STRATEGY 1 — OSCILLATOR (EMA dip) ────────

async function runStrategy1(now: string, giftChangePct: number, strategyOverride?: Strategy): Promise<StrategyResult> {
  const strategy = strategyOverride || getStrategyById('accumulator')
  const params = (strategy?.params || {}) as Record<string, any>
  const watchlistKeys = strategy?.watchlist || ['listA']

  const creds = await firstConnectedCreds()
  if (!creds) {
    return {
      mode: 'dip', recommendations: [], giftChangePct,
      message: 'No Kite account connected — Login with Kite in Settings to run Strategy 1.',
      generatedAt: now,
    }
  }

  const wl = await getWatchlist()
  const universe: WatchlistStock[] = watchlistKeys.flatMap(k => wl.lists[k] || []) as any[]
  const symbols = universe.map(s => s.nse.toUpperCase())
  const nameBySymbol = new Map(universe.map(s => [s.nse.toUpperCase(), s.name || s.nse]))

  // 1. Resolve instrument tokens
  let tokens: Record<string, number> = {}
  try {
    tokens = await getInstrumentTokens(creds, symbols)
  } catch (err) {
    return {
      mode: 'dip', recommendations: [], giftChangePct,
      message: `Could not load Kite instruments: ${String(err).slice(0, 200)}`,
      generatedAt: now,
    }
  }

  const from = ymdIST(-60)
  const to = ymdIST(-1)   // yesterday — exclude today's incomplete bar
  // Params from the strategy object — fall back to legacy strategy.json keys
  const entryBelowPct     = params.entryBelowPct      ?? strategyCfg.ema?.entryBelowPct      ?? 5
  const strongBuyBelowPct = params.strongBuyBelowPct  ?? strategyCfg.ema?.strongBuyBelowPct  ?? 8
  const minDownDays       = params.minDownDays        ?? strategyCfg.ema?.minDownDays        ?? 3
  const emaPeriod         = params.emaPeriod          ?? strategyCfg.ema?.period             ?? 20
  const capitulationFloor = params.capitulationFloorPct ?? 12  // skip stocks deeper than -12% from EMA (news/panic, not mean-reversion)
  const tranche2AbovePct  = params.tranche2AboveEMAPct ?? strategyCfg.targets?.strategy1_tranche2_above_ema_pct ?? 3

  let skippedNoToken = 0
  let skippedNoHistorical = 0

  type EmaCandidate = {
    symbol: string
    ema: number
    downDays: number
    lastClose: number
  }

  // 2. Fetch historicals in parallel (3 at a time — Kite rate limit ~3/sec)
  const fetched = await mapWithLimit(symbols, 3, async (symbol): Promise<EmaCandidate | null> => {
    const token = tokens[symbol]
    if (!token) { skippedNoToken++; return null }
    try {
      const candles = await getHistoricalCandles(creds, token, from, to, 'day')
      if (candles.length < emaPeriod + 2) { skippedNoHistorical++; return null }
      const closes = candles.map(c => c.close)
      const emas = computeEMA(closes, emaPeriod)
      const lastEMA = emas[emas.length - 1]
      if (!lastEMA || isNaN(lastEMA)) return null
      const downDays = consecutiveDownDays(closes)
      const lastClose = closes[closes.length - 1]
      return { symbol, ema: lastEMA, downDays, lastClose }
    } catch (err) {
      console.warn(`[strategy1] historical fetch failed ${symbol}:`, String(err).slice(0, 100))
      skippedNoHistorical++
      return null
    }
  })
  const validHistoricals = fetched.filter((x): x is EmaCandidate => !!x)

  // 3. Fetch live LTPs for everyone in one batch
  const quotes = await getQuotes(creds, validHistoricals.map(v => v.symbol))

  // 4. Filter to stocks meeting Strategy 1 entry: ≥5% below EMA AND ≥3 consecutive down days
  let skippedDownDays = 0
  let skippedNotStretched = 0
  let skippedCapitulation = 0
  const recs: Array<Recommendation & { _dev: number }> = []

  for (const v of validHistoricals) {
    const ltp = quotes[`NSE:${v.symbol}`]?.last_price ?? v.lastClose
    const dev = deviationPct(ltp, v.ema)

    if (dev > -entryBelowPct) { skippedNotStretched++; continue }
    // Capitulation floor — past this depth from EMA, it's a news event / panic
    // not a mean-reversion candidate. Matches the Engine tile's "below_ema_max" rule.
    if (dev < -capitulationFloor) { skippedCapitulation++; continue }
    if (v.downDays < minDownDays) { skippedDownDays++; continue }

    const perTrade = strategyCfg.capital.perTrade
    const qty = Math.floor(perTrade / ltp)
    if (qty < 1) continue

    const prevCloseFromHist = v.lastClose
    const dayChgPct = prevCloseFromHist > 0 ? ((ltp - prevCloseFromHist) / prevCloseFromHist) * 100 : undefined
    recs.push({
      symbol: v.symbol,
      name: nameBySymbol.get(v.symbol) || v.symbol,
      price: ltp,
      priceSource: 'kite_live',
      dayChangePct: dayChgPct,
      action: 'BUY',
      strategy: 'accumulator',
      source: 'EMA stretch signal',
      reason: `${Math.abs(dev).toFixed(1)}% below 20-EMA (₹${v.ema.toFixed(2)}); ${v.downDays} consecutive down days`,
      target1: +v.ema.toFixed(2),                                                        // exit 50% on EMA recovery
      target2: +(v.ema * (1 + tranche2AbovePct / 100)).toFixed(2),  // exit remaining when price hits EMA + tranche2% (no time stop)
      suggestedQty: qty,
      confidence: dev <= -strongBuyBelowPct ? 'high' : 'normal',
      _dev: dev,
    })
  }

  // Sort by most stretched first (most negative dev = best mean-reversion candidate)
  recs.sort((a, b) => a._dev - b._dev)
  const final: Recommendation[] = recs.slice(0, 5).map(({ _dev, ...rec }) => rec)

  return {
    mode: 'dip',
    recommendations: final,
    giftChangePct,
    counts: {
      skippedOffWatchlist: 0,
      skippedNoPrice: 0,
      skippedNoToken,
      skippedNoHistorical,
      skippedDownDays,
      skippedNotStretched: skippedNotStretched + skippedCapitulation,
      produced: final.length,
    },
    priceSource: 'kite_live',
    message: final.length === 0
      ? `No List A stocks currently meet Strategy 1 criteria (5%+ below 20-EMA & 3+ down days).`
      : undefined,
    generatedAt: now,
  }
}

// ──────── STRATEGY 1 — REACTIVE INTRADAY DIP ────────
//
// Runs every 30 min from 9:15 to 14:00 IST. Scans List A live LTPs. For any
// symbol that has dropped ≥3% from yesterday's close intraday, re-runs the
// full Strategy 1 entry check on that symbol, counting today as a down day
// (since by definition the price has already fallen ≥3%). Fires regardless
// of market mode — a single-stock capitulation is a valid signal even on a
// flat / green broader-market day.
//
// Idempotency is shared with the morning scan via the standard
// account+date+symbol ledger in preflight, so the same symbol won't fire twice.

export interface ReactiveDipResult {
  recommendations: Recommendation[]
  scanned: number
  triggered: string[]    // symbols that crossed −3% intraday
  evaluated: number      // of those, how many we ran full Strategy 1 on
  skipReason?: string
}

export async function runReactiveDipScan(strategyOverride?: Strategy): Promise<ReactiveDipResult> {
  const strategy = strategyOverride || getStrategyById('accumulator')
  const params = (strategy?.params || {}) as Record<string, any>
  const watchlistKeys = strategy?.watchlist || ['listA']
  const dropPct = params.reactiveDrop ?? (strategyCfg as any).strategy1_reactive?.dropPct ?? 3.0
  const tranche2AbovePct = params.tranche2AboveEMAPct ?? strategyCfg.targets?.strategy1_tranche2_above_ema_pct ?? 3

  const creds = await firstConnectedCreds()
  if (!creds) return { recommendations: [], scanned: 0, triggered: [], evaluated: 0, skipReason: 'No Kite account connected' }

  const wl = await getWatchlist()
  const universe: WatchlistStock[] = watchlistKeys.flatMap(k => wl.lists[k] || []) as any[]
  const symbols = universe.map(s => s.nse.toUpperCase())
  if (symbols.length === 0) return { recommendations: [], scanned: 0, triggered: [], evaluated: 0 }
  const nameBySymbol = new Map(universe.map(s => [s.nse.toUpperCase(), s.name || s.nse]))

  // 1. Batch-fetch live LTPs + yesterday's close (from ohlc.close)
  const quotes = await getQuotes(creds, symbols).catch(() => ({} as Awaited<ReturnType<typeof getQuotes>>))

  // 2. Find symbols already down ≥dropPct% intraday
  const triggered: string[] = []
  for (const sym of symbols) {
    const q: any = quotes[`NSE:${sym}`]
    const ltp = Number(q?.last_price)
    const prevClose = Number(q?.ohlc?.close)
    if (!ltp || !prevClose) continue
    const dayChgPct = ((ltp - prevClose) / prevClose) * 100
    if (dayChgPct <= -dropPct) triggered.push(sym)
  }
  if (triggered.length === 0) {
    return { recommendations: [], scanned: symbols.length, triggered: [], evaluated: 0 }
  }

  // 3. Resolve tokens for triggered symbols only (much smaller batch than morning scan)
  let tokens: Record<string, number> = {}
  try {
    tokens = await getInstrumentTokens(creds, triggered)
  } catch (err) {
    return {
      recommendations: [], scanned: symbols.length, triggered, evaluated: 0,
      skipReason: `Instrument tokens fetch failed: ${String(err).slice(0, 120)}`,
    }
  }

  // 4. For each triggered symbol, fetch historical + apply Strategy 1 entry checks.
  //    "Count today as down day" → since we already know LTP is ≥3% below prev close,
  //    we synthesise today's close = LTP and prepend it to the historical closes for
  //    the down-days count. EMA still uses only completed historical bars (excludes
  //    today's incomplete bar) so it's not polluted by intraday volatility.
  const from = ymdIST(-60)
  const to = ymdIST(-1)
  const entryBelowPct     = params.entryBelowPct      ?? strategyCfg.ema?.entryBelowPct      ?? 5
  const strongBuyBelowPct = params.strongBuyBelowPct  ?? strategyCfg.ema?.strongBuyBelowPct  ?? 8
  const minDownDays       = params.minDownDays        ?? strategyCfg.ema?.minDownDays        ?? 3
  const emaPeriod         = params.emaPeriod          ?? strategyCfg.ema?.period             ?? 20
  const capitulationFloor = params.capitulationFloorPct ?? 12

  const evaluated = await mapWithLimit(triggered, 3, async (symbol): Promise<Recommendation | null> => {
    const token = tokens[symbol]
    if (!token) return null
    try {
      const candles = await getHistoricalCandles(creds, token, from, to, 'day')
      if (candles.length < emaPeriod + 2) return null
      const closes = candles.map(c => c.close)
      const emas = computeEMA(closes, emaPeriod)
      const ema = emas[emas.length - 1]
      if (!ema || isNaN(ema)) return null

      const q: any = quotes[`NSE:${symbol}`]
      const ltp = Number(q?.last_price) || 0
      const prevClose = Number(q?.ohlc?.close) || 0
      if (!ltp || !prevClose) return null

      // Count today as a down day (we just confirmed ≥3% drop)
      const closesWithToday = [...closes, ltp]
      const downDays = consecutiveDownDays(closesWithToday)
      const dev = deviationPct(ltp, ema)

      if (dev > -entryBelowPct) return null      // not stretched enough yet
      if (dev < -capitulationFloor) return null  // past capitulation floor — panic / news, not mean-reversion
      if (downDays < minDownDays) return null    // not enough sustained down days

      const perTrade = strategyCfg.capital.perTrade
      const qty = Math.floor(perTrade / ltp)
      if (qty < 1) return null

      const dayChgPct = ((ltp - prevClose) / prevClose) * 100
      return {
        symbol,
        name: nameBySymbol.get(symbol) || symbol,
        price: ltp,
        priceSource: 'kite_live',
        dayChangePct: dayChgPct,
        action: 'BUY',
        strategy: 'accumulator',
        source: 'Reactive dip (intraday −3%+)',
        reason: `Intraday ${dayChgPct.toFixed(2)}% drop · ${Math.abs(dev).toFixed(1)}% below 20-EMA (₹${ema.toFixed(2)}) · ${downDays} consecutive down days (today counted)`,
        target1: +ema.toFixed(2),
        target2: +(ema * (1 + tranche2AbovePct / 100)).toFixed(2),
        suggestedQty: qty,
        confidence: dev <= -strongBuyBelowPct ? 'high' : 'normal',
      }
    } catch (err) {
      console.warn(`[strategy1-reactive] eval failed ${symbol}:`, String(err).slice(0, 100))
      return null
    }
  })

  const recommendations = evaluated.filter((x): x is Recommendation => !!x)
  return { recommendations, scanned: symbols.length, triggered, evaluated: triggered.length }
}
