// Persistent rolling cache of daily closes per symbol — Supabase-backed
// (`daily_closes`, SHARED across all customers — NSE OHLC data is identical
// for everyone, so this table is NOT scoped by customer_id). Ported in
// Phase 4 of the multi-tenant refactor from the file-based
// `~/dineshtrade/data/daily-closes.json`.
//
// Why this exists: Kite's `/instruments/historical/{token}/day` endpoint can't
// be batched (one symbol per HTTP call) and is rate-limited to ~3 req/sec.
// Fetching 60 days × N symbols every morning means at the edge of the rate
// limit on cold cache — some symbols silently fail and their EMA / tile rules
// show `—` for the whole day.
//
// Structural fix: persist closes in Supabase. Each morning fetch ONLY the
// bars missing since `lastCachedDate` (typically a single trading day). Call
// count is unchanged (Kite design — one call per symbol regardless of date
// range) but each call returns a tiny payload, completes in milliseconds,
// and the system has near-zero pressure against the rate limit.
//
// Rolling window: each symbol keeps at most MAX_KEEP (60) most-recent rows —
// older rows are pruned after every write, same bound the old file backend
// enforced by trimming the in-memory array before serialising.

import { getSupabaseAdmin } from './supabase'
import { getHistoricalCandles, type KiteCreds } from './kite'
import { getInstrumentTokens } from './instruments'

export interface DailyClose {
  date: string                    // YYYY-MM-DD
  open?: number                   // optional; old cached entries may lack this
  high?: number                   // optional; old cached entries may lack this
  low?: number                    // optional; old cached entries may lack this
  close: number
  volume: number
}

const MAX_KEEP = 60                       // rolling window size — enough for EMA + 10-day avg + buffer
const CONCURRENCY = 2                     // historical API is ~3/sec; 2 leaves headroom for retry
const RETRY_BACKOFF_MS = 500

// ─── Supabase I/O ──────────────────────────────────────────────────────────

function rowToClose(row: any): DailyClose {
  return {
    date: row.trade_date,
    open: row.open_price ?? undefined,
    high: row.high_price ?? undefined,
    low: row.low_price ?? undefined,
    close: Number(row.close_price),
    volume: Number(row.volume) || 0,
  }
}

async function loadDb(symbols?: string[]): Promise<Record<string, DailyClose[]>> {
  const admin = getSupabaseAdmin()
  let query = admin.from('daily_closes').select('*').order('trade_date', { ascending: true })
  if (symbols && symbols.length > 0) query = query.in('symbol', symbols)
  const { data, error } = await query
  if (error) throw new Error(`[dailyCloses] read failed: ${error.message}`)

  const closes: Record<string, DailyClose[]> = {}
  for (const row of data || []) {
    const list = closes[row.symbol] ?? (closes[row.symbol] = [])
    list.push(rowToClose(row))
  }
  return closes
}

async function upsertSymbolCloses(symbol: string, records: DailyClose[]): Promise<void> {
  const admin = getSupabaseAdmin()
  const trimmed = records.slice(-MAX_KEEP)
  const rows = trimmed.map(r => ({
    symbol,
    trade_date: r.date,
    open_price: r.open ?? null,
    high_price: r.high ?? null,
    low_price: r.low ?? null,
    close_price: r.close,
    volume: r.volume,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await admin.from('daily_closes').upsert(rows, { onConflict: 'symbol,trade_date' })
  if (error) throw new Error(`[dailyCloses] upsert failed for ${symbol}: ${error.message}`)

  // Prune anything older than the trimmed window — keeps the shared table
  // bounded the same way the old file backend's array-slice did.
  const oldestKept = trimmed[0]?.date
  if (oldestKept) {
    const { error: deleteError } = await admin
      .from('daily_closes')
      .delete()
      .eq('symbol', symbol)
      .lt('trade_date', oldestKept)
    if (deleteError) console.warn(`[dailyCloses] prune failed for ${symbol}: ${deleteError.message}`)
  }
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
      return candles.map(c => ({
        date: ymdOnly(c.date),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }))
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

// Loads cached closes from Supabase, fills in any missing days up to
// yesterday, persists, and returns the updated closes by symbol. Failed
// symbols are still returned with whatever cached data exists (possibly
// empty array) so callers can decide whether they have enough bars to
// compute an EMA.
export async function loadAndRefreshCloses(
  creds: KiteCreds,
  symbols: string[],
): Promise<Record<string, DailyClose[]>> {
  const closes = await loadDb(symbols)
  const yesterday = istYmd(-1)
  const fullStart = istYmd(-90)   // cold-cache window (a bit wider than MAX_KEEP for buffer)

  // Decide per-symbol what to fetch.
  type Plan = { symbol: string; from: string; to: string; mode: 'cold' | 'incremental' | 'skip' }
  const plans: Plan[] = symbols.map(sym => {
    const cached = closes[sym] || []
    if (cached.length === 0) return { symbol: sym, from: fullStart, to: yesterday, mode: 'cold' }
    const lastDate = cached[cached.length - 1].date
    if (lastDate >= yesterday) return { symbol: sym, from: '', to: '', mode: 'skip' }
    return { symbol: sym, from: nextDay(lastDate), to: yesterday, mode: 'incremental' }
  })

  const needFetch = plans.filter(p => p.mode !== 'skip')
  if (needFetch.length === 0) {
    return closes   // cache fully fresh, nothing to do
  }

  // Resolve instrument tokens (single batched call inside getInstrumentTokens)
  const tokens = await getInstrumentTokens(creds, needFetch.map(p => p.symbol))

  // Fetch in parallel with a small concurrency cap. Each call is tiny in the
  // incremental case (1–3 days of data); cold-cache symbols still take longer.
  let coldCount = 0, incCount = 0, failCount = 0
  const touchedSymbols = new Set<string>()
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
    const existing = closes[plan.symbol] || []
    const byDate = new Map<string, DailyClose>()
    for (const b of existing) byDate.set(b.date, b)
    for (const b of bars) byDate.set(b.date, b)
    const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
    closes[plan.symbol] = merged.slice(-MAX_KEEP)
    touchedSymbols.add(plan.symbol)

    if (plan.mode === 'cold') coldCount++; else incCount++
  })

  if (coldCount + incCount + failCount > 0) {
    console.log(`[dailyCloses] refresh — cold:${coldCount} incremental:${incCount} failed:${failCount} skipped:${plans.length - needFetch.length}`)
  }

  // Persist whatever we successfully accumulated. A partial failure still
  // updates the shared table for the symbols that did succeed.
  try {
    await Promise.all(Array.from(touchedSymbols).map(sym => upsertSymbolCloses(sym, closes[sym])))
  } catch (err) {
    console.warn(`[dailyCloses] Supabase save failed — ${String(err).slice(0, 160)}`)
  }
  return closes
}

// Read-only access for callers that don't want to trigger a refresh — primarily
// for diagnostics / inspection routes. Returns the shared cache as-is.
export async function readCachedCloses(): Promise<Record<string, DailyClose[]>> {
  return loadDb()
}
