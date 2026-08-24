// In-memory, same-process cache for Kite live quotes + intraday historical
// candles — shared across every customer's and every strategy's BUY-cron
// scan. Without this, N strategies × M customers each independently fetch
// the same NSE symbols on every tick.
//
// Cache-aside: first caller for a key fetches from Zerodha and populates the
// cache; every other caller within the TTL window gets a hit. Concurrent
// callers for the SAME historical-candle key share one in-flight request —
// no duplicate calls against Kite's ~3 req/sec historical rate limit. Only
// successful fetches are cached — a failure leaves the key empty so the next
// caller retries live instead of being served stale/empty data.
//
// Daily EOD candles are NOT handled here — those go through the Supabase-backed
// `dailyCloses.loadAndRefreshCloses()`, which is durable across restarts.
// This module is for the two things that must be cheap and fast per-tick:
// live quotes and today's intraday (5-min) candles.

import { getQuotes as kiteGetQuotes, getHistoricalCandles as kiteGetHistoricalCandles, type KiteCreds, type KiteQuoteEntry, type HistoricalCandle } from './kite'

const QUOTE_TTL_MS = Number(process.env.MARKET_DATA_QUOTE_TTL_MS) || 60_000
const CANDLE_TTL_MS = Number(process.env.MARKET_DATA_CANDLE_TTL_MS) || 60_000

interface Entry<T> { data: T; expiresAt: number }

const quoteCache = new Map<string, Entry<KiteQuoteEntry>>()
const candleCache = new Map<string, Entry<HistoricalCandle[]>>()
const candleInFlight = new Map<string, Promise<HistoricalCandle[]>>()

let quoteHits = 0, quoteMisses = 0, candleHits = 0, candleMisses = 0

export function getMarketDataCacheStats() {
  return { quoteHits, quoteMisses, candleHits, candleMisses }
}

// Kite's /quote endpoint already batches many symbols per HTTP call, so this
// is a plain TTL cache with no in-flight de-dup — worst case a few
// near-simultaneous callers each fire one extra batched call.
export async function getCachedQuotes(creds: KiteCreds, symbols: string[]): Promise<Record<string, KiteQuoteEntry>> {
  if (symbols.length === 0) return {}
  const now = Date.now()
  const result: Record<string, KiteQuoteEntry> = {}
  const missing: string[] = []
  for (const sym of symbols) {
    const key = `NSE:${sym.toUpperCase()}`
    const cached = quoteCache.get(key)
    if (cached && cached.expiresAt > now) { result[key] = cached.data; quoteHits++ }
    else missing.push(sym)
  }
  if (missing.length === 0) return result
  quoteMisses += missing.length
  try {
    const fresh = await kiteGetQuotes(creds, missing)
    for (const [key, entry] of Object.entries(fresh)) {
      quoteCache.set(key, { data: entry, expiresAt: Date.now() + QUOTE_TTL_MS })
      result[key] = entry
    }
  } catch (err) {
    console.warn('[marketDataCache] quote fetch failed (not cached, next caller retries live):', String(err).slice(0, 150))
  }
  return result
}

// Kite's historical endpoint is one HTTP call PER symbol and rate-limited —
// this is the resource that actually needed de-duping across customers and
// strategies. Cache key includes token+interval+from+to so distinct request
// shapes never collide.
export async function getCachedHistoricalCandles(
  creds: KiteCreds,
  instrumentToken: number,
  from: string,
  to: string,
  interval: 'day' | '5minute' | '15minute' | '60minute' = 'day',
): Promise<HistoricalCandle[]> {
  const key = `${instrumentToken}:${interval}:${from}:${to}`
  const now = Date.now()
  const cached = candleCache.get(key)
  if (cached && cached.expiresAt > now) { candleHits++; return cached.data }

  const inFlight = candleInFlight.get(key)
  if (inFlight) { candleHits++; return inFlight }

  candleMisses++
  const fetchPromise = kiteGetHistoricalCandles(creds, instrumentToken, from, to, interval)
    .then(candles => {
      candleCache.set(key, { data: candles, expiresAt: Date.now() + CANDLE_TTL_MS })
      return candles
    })
    .catch(err => {
      console.warn(`[marketDataCache] historical fetch failed (token=${instrumentToken} interval=${interval}):`, String(err).slice(0, 150))
      throw err
    })
    .finally(() => {
      candleInFlight.delete(key)
    })
  candleInFlight.set(key, fetchPromise)
  return fetchPromise
}
