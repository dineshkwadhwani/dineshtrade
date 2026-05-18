// Strategy engine — produces buy recommendations for both Strategy 1 (Oscillator)
// and Strategy 2 (Daily Catalyst). Mode is picked from GIFT Nifty change %.
//
// Used by the /api/strategy HTTP route (Manual) and the cron tick (Auto).

import watchlist from '@/config/watchlist.json'
import strategyCfg from '@/config/strategy.json'
import { getMarketBriefing } from './marketBriefing'
import { getState } from './state'
import {
  resolveAccountCreds, getQuotes, getHistoricalCandles, type KiteCreds,
} from './kite'
import { getInstrumentTokens } from './instruments'
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
  strategy: 'catalyst' | 'oscillator'
  source: string
  reason: string
  target1: number
  target2: number
  stopLoss: number
  suggestedQty: number
  confidence: 'normal' | 'high'
}

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
  const state = await getState()
  const account = Object.keys(state.kiteTokens)[0]
  if (!account) return null
  const r = await resolveAccountCreds(account)
  return r.ok ? { apiKey: r.apiKey, accessToken: r.accessToken } : null
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

async function runStrategy2(now: string, giftChangePct: number): Promise<StrategyResult> {
  const cfg = strategyCfg.strategy2_momentum ?? {
    minDayGainPct: 0.5, maxDayGainPct: 1.5, emaProximityPct: 3.0,
    consecutiveCandles: 3, scanStartHHMM: '09:30', scanEndHHMM: '14:30', volumeAvgDays: 10,
  }
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

  // 2. List A universe
  const listA: WatchlistStock[] = watchlist.listA || []
  const symbols = listA.map(s => s.nse.toUpperCase())
  const nameBySymbol = new Map(listA.map(s => [s.nse.toUpperCase(), s.name || s.nse]))

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

    const t1 = +(s.ltp * (1 + strategyCfg.targets.intraday_t1_pct / 100)).toFixed(2)
    const t2 = +(s.ltp * (1 + strategyCfg.targets.intraday_t2_pct / 100)).toFixed(2)
    const sl = +(s.ltp * 0.985).toFixed(2)

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
      stopLoss: sl,
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

  const { getInstrumentTokens } = await import('./instruments')
  const tokens = await getInstrumentTokens(creds, stale)
  const from = ymdIST(-60)
  const to = ymdIST(-1)
  const emaPeriod = strategyCfg.ema?.period ?? 20

  await mapWithLimit(stale, 3, async (symbol) => {
    const token = tokens[symbol]
    if (!token) return
    try {
      const candles = await getHistoricalCandles(creds, token, from, to, 'day')
      if (candles.length < emaPeriod + 2) return
      const closes = candles.map(c => c.close)
      const emas = computeEMA(closes, emaPeriod)
      const ema20 = emas[emas.length - 1]
      const prevClose = closes[closes.length - 1]
      const lastN = candles.slice(-volumeAvgDays)
      const avgVolume10d = lastN.reduce((sum, c) => sum + c.volume, 0) / Math.max(1, lastN.length)
      if (!ema20 || isNaN(ema20) || !prevClose) return
      dailyAggregateCache.set(symbol, { date: today, data: { ema20, avgVolume10d, prevClose } })
    } catch (err) {
      // silent — symbol skipped on next scan iteration
    }
  })
}

// ──────── STRATEGY 1 — OSCILLATOR (EMA dip) ────────

async function runStrategy1(now: string, giftChangePct: number): Promise<StrategyResult> {
  const creds = await firstConnectedCreds()
  if (!creds) {
    return {
      mode: 'dip', recommendations: [], giftChangePct,
      message: 'No Kite account connected — Login with Kite in Settings to run Strategy 1.',
      generatedAt: now,
    }
  }

  const listA: WatchlistStock[] = watchlist.listA || []
  const symbols = listA.map(s => s.nse.toUpperCase())
  const nameBySymbol = new Map(listA.map(s => [s.nse.toUpperCase(), s.name || s.nse]))

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
  const entryBelowPct = strategyCfg.ema?.entryBelowPct ?? 5
  const strongBuyBelowPct = strategyCfg.ema?.strongBuyBelowPct ?? 8
  const minDownDays = strategyCfg.ema?.minDownDays ?? 3
  const emaPeriod = strategyCfg.ema?.period ?? 20

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
  const recs: Array<Recommendation & { _dev: number }> = []

  for (const v of validHistoricals) {
    const ltp = quotes[`NSE:${v.symbol}`]?.last_price ?? v.lastClose
    const dev = deviationPct(ltp, v.ema)

    if (dev > -entryBelowPct) { skippedNotStretched++; continue }
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
      strategy: 'oscillator',
      source: 'EMA stretch signal',
      reason: `${Math.abs(dev).toFixed(1)}% below 20-EMA (₹${v.ema.toFixed(2)}); ${v.downDays} consecutive down days`,
      target1: +v.ema.toFixed(2),                                                        // exit 50% on EMA recovery
      target2: +(v.ema * (1 + (strategyCfg.targets.strategy1_tranche2_above_ema_pct ?? 3) / 100)).toFixed(2),  // exit remaining when price hits EMA + 3% (no time stop)
      stopLoss: +(ltp * 0.975).toFixed(2),                                              // -2.5% SL (wider than Strategy 2; we expect retrace)
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
      skippedNotStretched,
      produced: final.length,
    },
    priceSource: 'kite_live',
    message: final.length === 0
      ? `No List A stocks currently meet Strategy 1 criteria (5%+ below 20-EMA & 3+ down days).`
      : undefined,
    generatedAt: now,
  }
}
