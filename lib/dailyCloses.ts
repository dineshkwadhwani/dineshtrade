// Persistent rolling cache of daily closes per symbol. Replaces the old
// "fetch 60 days of historical for every List A symbol, every morning" pattern.
//
// Why this exists: Kite's `/instruments/historical/{token}/day` endpoint can't
// be batched (one symbol per HTTP call) and is rate-limited to ~3 req/sec.
// Fetching 60 days × N symbols every morning means at the edge of the rate
// limit on cold cache — some symbols silently fail and their EMA / tile rules
// show `—` for the whole day.
//
// Structural fix: persist closes on disk. Each morning fetch ONLY the bars
// missing since `lastCachedDate` (typically a single trading day). Call count
// is unchanged (Kite design — one call per symbol regardless of date range)
// but each call returns a tiny payload, completes in milliseconds, and the
// system has near-zero pressure against the rate limit.
//
// File format: `~/dineshtrade/data/daily-closes.json`. Same dir as state +
// journal, mode 0o600, written atomically via temp + rename. Self-healing:
// if the file is missing or corrupted, the next call rebuilds from scratch
// (full 60-day fetch, matching pre-cache behavior).

import { promises as fs } from 'fs'
import * as path from 'path'
import { getHistoricalCandles, type KiteCreds } from './kite'
import { getInstrumentTokens } from './instruments'

export interface DailyClose {
  date: string                    // YYYY-MM-DD
  close: number
  volume: number
}

interface DiskShape {
  schema: number
  updatedAt: string
  closes: Record<string, DailyClose[]>   // symbol → ascending-date array, trimmed to last MAX_KEEP
}

const SCHEMA_VERSION = 1
const MAX_KEEP = 60                       // rolling window size — enough for EMA + 10-day avg + buffer
const CONCURRENCY = 2                     // historical API is ~3/sec; 2 leaves headroom for retry
const RETRY_BACKOFF_MS = 500

const STATE_FILE_PATH = process.env.STATE_FILE_PATH || ''
const CACHE_PATH = STATE_FILE_PATH ? path.join(path.dirname(STATE_FILE_PATH), 'daily-closes.json') : ''

// ─── Disk I/O ──────────────────────────────────────────────────────────────

async function loadDisk(): Promise<DiskShape> {
  if (!CACHE_PATH) return emptyDisk()
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.closes && typeof parsed.closes === 'object') {
      return { schema: parsed.schema ?? 1, updatedAt: parsed.updatedAt ?? '', closes: parsed.closes }
    }
  } catch { /* missing or corrupted — self-heal by returning empty */ }
  return emptyDisk()
}

async function saveDisk(disk: DiskShape): Promise<void> {
  if (!CACHE_PATH) return
  const dir = path.dirname(CACHE_PATH)
  await fs.mkdir(dir, { recursive: true })
  const payload: DiskShape = { schema: SCHEMA_VERSION, updatedAt: new Date().toISOString(), closes: disk.closes }
  const tmp = CACHE_PATH + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, CACHE_PATH)
}

function emptyDisk(): DiskShape {
  return { schema: SCHEMA_VERSION, updatedAt: '', closes: {} }
}

// ─── Date helpers ──────────────────────────────────────────────────────────

function istYmd(daysOffset = 0): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  ist.setDate(ist.getDate() + daysOffset)
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

// Kite's historical endpoint returns the candle's date as either a YYYY-MM-DD
// string or an ISO string depending on instrument/interval. Normalise to date-only.
function ymdOnly(s: string): string { return s.slice(0, 10) }

// ─── Concurrency primitive (small re-implementation; avoids cross-module import) ───

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

// ─── Fetch with one retry ──────────────────────────────────────────────────

async function fetchSymbolBars(
  creds: KiteCreds,
  symbol: string,
  token: number,
  from: string,
  to: string,
): Promise<DailyClose[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const candles = await getHistoricalCandles(creds, token, from, to, 'day')
      return candles.map(c => ({ date: ymdOnly(c.date), close: c.close, volume: c.volume }))
    } catch (err) {
      if (attempt === 0) {
        await new Promise(res => setTimeout(res, RETRY_BACKOFF_MS))
        continue
      }
      console.warn(`[dailyCloses] ${symbol}: historical fetch failed after retry — ${String(err).slice(0, 160)}`)
      return null
    }
  }
  return null
}

// ─── Public API ────────────────────────────────────────────────────────────

// Loads cached closes from disk, fills in any missing days up to yesterday,
// persists, and returns the updated closes by symbol. Failed symbols are still
// returned with whatever cached data exists (possibly empty array) so callers
// can decide whether they have enough bars to compute an EMA.
export async function loadAndRefreshCloses(
  creds: KiteCreds,
  symbols: string[],
): Promise<Record<string, DailyClose[]>> {
  const disk = await loadDisk()
  const yesterday = istYmd(-1)
  const fullStart = istYmd(-90)   // cold-cache window (a bit wider than MAX_KEEP for buffer)

  // Decide per-symbol what to fetch.
  type Plan = { symbol: string; from: string; to: string; mode: 'cold' | 'incremental' | 'skip' }
  const plans: Plan[] = symbols.map(sym => {
    const cached = disk.closes[sym] || []
    if (cached.length === 0) return { symbol: sym, from: fullStart, to: yesterday, mode: 'cold' }
    const lastDate = cached[cached.length - 1].date
    if (lastDate >= yesterday) return { symbol: sym, from: '', to: '', mode: 'skip' }
    return { symbol: sym, from: nextDay(lastDate), to: yesterday, mode: 'incremental' }
  })

  const needFetch = plans.filter(p => p.mode !== 'skip')
  if (needFetch.length === 0) {
    return disk.closes   // cache fully fresh, nothing to do
  }

  // Resolve instrument tokens (single batched call inside getInstrumentTokens)
  const tokens = await getInstrumentTokens(creds, needFetch.map(p => p.symbol))

  // Fetch in parallel with a small concurrency cap. Each call is tiny in the
  // incremental case (1–3 days of data); cold-cache symbols still take longer.
  let coldCount = 0, incCount = 0, failCount = 0
  await mapWithLimit(needFetch, CONCURRENCY, async (plan) => {
    const token = tokens[plan.symbol]
    if (!token) {
      console.warn(`[dailyCloses] ${plan.symbol}: no instrument token — skipping`)
      failCount++
      return
    }
    const bars = await fetchSymbolBars(creds, plan.symbol, token, plan.from, plan.to)
    if (!bars) { failCount++; return }

    // Merge: cache up to lastDate + new bars, dedup by date, sort ascending, trim.
    const existing = disk.closes[plan.symbol] || []
    const byDate = new Map<string, DailyClose>()
    for (const b of existing) byDate.set(b.date, b)
    for (const b of bars) byDate.set(b.date, b)
    const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
    disk.closes[plan.symbol] = merged.slice(-MAX_KEEP)

    if (plan.mode === 'cold') coldCount++; else incCount++
  })

  if (coldCount + incCount + failCount > 0) {
    console.log(`[dailyCloses] refresh — cold:${coldCount} incremental:${incCount} failed:${failCount} skipped:${plans.length - needFetch.length}`)
  }

  // Persist whatever we successfully accumulated. A partial failure still
  // updates disk for the symbols that did succeed.
  try {
    await saveDisk(disk)
  } catch (err) {
    console.warn(`[dailyCloses] disk save failed — ${String(err).slice(0, 160)}`)
  }
  return disk.closes
}

// Read-only access for callers that don't want to trigger a refresh — primarily
// for diagnostics / inspection routes. Returns the on-disk view.
export async function readCachedCloses(): Promise<Record<string, DailyClose[]>> {
  const disk = await loadDisk()
  return disk.closes
}
