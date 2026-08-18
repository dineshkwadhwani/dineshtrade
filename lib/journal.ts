// Trade + signal journal — Supabase-backed, lean design per
// docs/DALGO_REFACTOR_SPEC_v2.md §8.2. Ported in Phase 4 of the multi-tenant
// refactor from the append-only `journal-YYYY-MM.jsonl` files.
//
// Storage routing by record type:
//   - order            → `orders` table (always on)
//   - trade            → `trades` table (always on)
//   - signal_skipped   → `signals_skipped` table (always on)
//   - strategy_scan    → `strategy_scans` table, only when the
//                        STRATEGY_SCAN_DB_ENABLED platform_config flag is
//                        'true' (read once, cached — see isStrategyScanDbEnabled)
//   - exit_monitor     → dropped. Written by strategy2.ts but never read back
//                        anywhere in the app; no table in the lean schema.
//   - monitor_heartbeat→ dropped entirely per spec §8.2 (never written to DB).
//
// `orders`/`trades`/`signals_skipped`/`strategy_scans` don't have columns
// for everything the existing record shapes carry (the legacy `account`
// identity, the string `strategyId` tag, trade report fields, Kite broker
// order-id strings). Those columns were added in Phase 4 — see
// scripts/migrations/2026-08-09-phase4-schema-extensions.sql.

import { getSupabaseAdmin, getCustomerId } from './supabase'
import { getNseHolidays } from './market'

export type TradeVerdict = 'correct_exit' | 'early_exit' | 'delivery' | 'manual'
// Stored strategy owner for a completed trade. Historically this was limited
// to catalyst / accumulator / manual; it now tracks the active strategyId so
// switched positions and user-created strategies journal correctly.
export type StrategyTag = string

export interface TradeRecord {
  type: 'trade'
  date: string                  // YYYY-MM-DD IST
  account: string
  symbol: string
  qty: number
  entryPrice: number
  entryTime: string             // ISO from Kite order_timestamp (or our trigger time)
  exitPrice: number
  exitTime: string
  pnlRupees: number
  pnlPct: number
  dayHighAfterEntry: number     // recorded at SELL time; report enriches with final EoD high
  dayLowAfterEntry: number
  leftOnTable: number
  verdict: TradeVerdict
  strategy: StrategyTag
  orderIdBuy?: string
  orderIdSell?: string
  notes?: string
}

export interface SignalSkippedRecord {
  type: 'signal_skipped'
  date: string
  time: string                  // HH:MM IST when skipped
  account: string
  symbol: string
  signalPrice: number
  reasonSkipped: string         // gate name + human reason
}

export interface ExitMonitorRecord {
  type: 'exit_monitor'
  date: string
  ts: string                    // ISO timestamp
  account: string
  symbol: string
  strategyId?: string
  status: 'skipped' | 'failed'
  quantity: number
  price: number
  reason: string
}

export interface MonitorHeartbeatRecord {
  type: 'monitor_heartbeat'
  date: string
  ts: string
  source: 'cron' | 'manual'
  accountsChecked: number
  positionsChecked: number
}

// One record per strategy scan tick. Lets the retrospective answer:
//   "When did strategy X last produce a signal?"
//   "How many scans did X run today / in the last 30 days?"
//   "How many of those signals actually became BUYs?"
// Critical for diagnosing strategies that have gone silent (e.g. config too tight).
export interface StrategyScanRecord {
  type: 'strategy_scan'
  date: string                  // YYYY-MM-DD IST
  ts: string                    // ISO timestamp
  strategyId: string
  strategyName: string
  recs: number                  // signals produced this scan (rec count)
  executed: number              // signals that resulted in successful auto-BUY
  symbols?: string[]            // signal symbols (optional, for debugging)
  skipReason?: string           // when the scan didn't run (e.g. GIFT Nifty gate blocked)
}

// Single-leg Kite order placement (manual or auto, BUY or SELL). Distinct from
// `trade` which captures a completed BUY+SELL pair. Lets the retrospective
// show "Activity Today" for any past date without depending on Kite's session-
// scoped /orders endpoint (which only returns the current trading session).
export interface OrderRecord {
  type: 'order'
  date: string                  // YYYY-MM-DD IST
  ts: string                    // ISO timestamp (Kite confirmation time)
  account: string
  symbol: string
  side: 'BUY' | 'SELL'
  qty: number
  price: number
  tag?: string                  // raw Kite tag (e.g. 'dt-catalyst', 'dt-manual')
  strategyId?: string           // derived from tag for fast filtering
  source: 'auto' | 'manual'
  orderId?: string
}

export type JournalRecord = TradeRecord | SignalSkippedRecord | ExitMonitorRecord | MonitorHeartbeatRecord | StrategyScanRecord | OrderRecord

// ─── platform_config cache (STRATEGY_SCAN_DB_ENABLED) ──────────────────────
// Cached 60s (Phase 5 Task 5.7) — long enough to avoid a Supabase read on
// every single journal write/read, short enough that a SuperAdmin flipping
// this flag in platform_config takes effect without a process restart.

const STRATEGY_SCAN_FLAG_TTL_MS = 60 * 1000
let strategyScanDbEnabledCache: boolean | null = null
let strategyScanDbEnabledCachedAt = 0

async function isStrategyScanDbEnabled(): Promise<boolean> {
  const now = Date.now()
  if (strategyScanDbEnabledCache !== null && now - strategyScanDbEnabledCachedAt < STRATEGY_SCAN_FLAG_TTL_MS) {
    return strategyScanDbEnabledCache
  }
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('platform_config')
      .select('value')
      .eq('key', 'STRATEGY_SCAN_DB_ENABLED')
      .maybeSingle()
    if (error) throw error
    strategyScanDbEnabledCache = data?.value === 'true'
  } catch (err) {
    console.warn('[journal] failed to read STRATEGY_SCAN_DB_ENABLED, defaulting to false:', String(err).slice(0, 200))
    strategyScanDbEnabledCache = false
  }
  strategyScanDbEnabledCachedAt = Date.now()
  return strategyScanDbEnabledCache
}

// ─── Row ⇄ record mapping ───────────────────────────────────────────────────

function rowToOrderRecord(row: any): OrderRecord {
  return {
    type: 'order',
    date: row.trade_date,
    ts: row.created_at,
    account: row.account || '',
    symbol: row.symbol,
    side: row.side,
    qty: row.qty,
    price: Number(row.price),
    tag: row.tag ?? undefined,
    strategyId: row.strategy_tag ?? undefined,
    source: row.source,
    orderId: row.broker_order_id ?? undefined,
  }
}

function rowToTradeRecord(row: any): TradeRecord {
  return {
    type: 'trade',
    date: row.trade_date,
    account: row.account || '',
    symbol: row.symbol,
    qty: row.qty,
    entryPrice: Number(row.entry_price),
    entryTime: row.entry_time,
    exitPrice: Number(row.exit_price),
    exitTime: row.exit_time,
    pnlRupees: Number(row.pnl_rupees),
    pnlPct: Number(row.pnl_pct),
    dayHighAfterEntry: Number(row.day_high_after_entry) || 0,
    dayLowAfterEntry: Number(row.day_low_after_entry) || 0,
    leftOnTable: Number(row.left_on_table) || 0,
    verdict: row.verdict,
    strategy: row.strategy_tag || '',
    orderIdBuy: row.buy_order_broker_id ?? undefined,
    orderIdSell: row.sell_order_broker_id ?? undefined,
    notes: row.notes ?? undefined,
  }
}

function rowToSignalSkippedRecord(row: any): SignalSkippedRecord {
  return {
    type: 'signal_skipped',
    date: row.signal_date,
    time: row.signal_time || '',
    account: row.account || '',
    symbol: row.symbol,
    signalPrice: Number(row.signal_price) || 0,
    reasonSkipped: row.reason,
  }
}

function rowToStrategyScanRecord(row: any): StrategyScanRecord {
  return {
    type: 'strategy_scan',
    date: row.scan_date,
    ts: row.scanned_at,
    strategyId: row.strategy_tag || '',
    strategyName: row.strategy_name || '',
    recs: row.recs ?? 0,
    executed: row.executed ?? 0,
    symbols: Array.isArray(row.symbols) ? row.symbols : undefined,
    skipReason: row.skip_reason ?? undefined,
  }
}

// gate/reason split: today's callers always pass one free-form string
// (sometimes prefixed `[gateName] ...`). `reason` keeps the full original
// text so the round trip through reasonSkipped is lossless; `gate` is a
// best-effort short label derived from the prefix, purely for the (not-null)
// column and any future gate-level filtering.
function splitGateReason(reasonSkipped: string): { gate: string; reason: string } {
  const m = reasonSkipped.match(/^\[([^\]]+)\]/)
  return { gate: m ? m[1] : 'signal_skipped', reason: reasonSkipped }
}

// ─── Writers ────────────────────────────────────────────────────────────────

async function insertOrderRow(record: OrderRecord): Promise<void> {
  const admin = getSupabaseAdmin()
  const row = {
    customer_id: getCustomerId(),
    account: record.account.toUpperCase(),
    strategy_tag: record.strategyId ?? null,
    symbol: record.symbol.toUpperCase(),
    side: record.side,
    qty: record.qty,
    price: record.price,
    broker_order_id: record.orderId ?? null,
    tag: record.tag ?? null,
    status: 'COMPLETE',     // journalOrder()/appendJournal({type:'order'}) is only ever called post-fill
    source: record.source,
    trade_date: record.date,
    created_at: record.ts,
  }
  const { error } = await admin.from('orders').insert(row)
  if (error) throw new Error(`[journal] insert order failed: ${error.message}`)
}

async function insertTradeRow(record: TradeRecord): Promise<void> {
  const admin = getSupabaseAdmin()
  const row = {
    customer_id: getCustomerId(),
    account: record.account.toUpperCase(),
    strategy_tag: record.strategy,
    symbol: record.symbol.toUpperCase(),
    qty: record.qty,
    entry_price: record.entryPrice,
    entry_time: record.entryTime,
    exit_price: record.exitPrice,
    exit_time: record.exitTime,
    pnl_rupees: record.pnlRupees,
    pnl_pct: record.pnlPct,
    day_high_after_entry: record.dayHighAfterEntry,
    day_low_after_entry: record.dayLowAfterEntry,
    left_on_table: record.leftOnTable,
    verdict: record.verdict,
    buy_order_broker_id: record.orderIdBuy ?? null,
    sell_order_broker_id: record.orderIdSell ?? null,
    notes: record.notes ?? null,
    trade_date: record.date,
  }
  const { error } = await admin.from('trades').insert(row)
  if (error) throw new Error(`[journal] insert trade failed: ${error.message}`)
}

async function insertSignalSkippedRow(record: SignalSkippedRecord): Promise<void> {
  const admin = getSupabaseAdmin()
  const { gate, reason } = splitGateReason(record.reasonSkipped)
  const row = {
    customer_id: getCustomerId(),
    account: record.account.toUpperCase(),
    symbol: record.symbol.toUpperCase(),
    signal_price: record.signalPrice,
    gate,
    reason,
    signal_date: record.date,
    signal_time: record.time,
  }
  const { error } = await admin.from('signals_skipped').insert(row)
  if (error) throw new Error(`[journal] insert signal_skipped failed: ${error.message}`)
}

async function insertStrategyScanRow(record: StrategyScanRecord): Promise<void> {
  const admin = getSupabaseAdmin()
  const row = {
    customer_id: getCustomerId(),
    strategy_tag: record.strategyId,
    strategy_name: record.strategyName,
    recs: record.recs,
    executed: record.executed,
    symbols: record.symbols ?? null,
    skip_reason: record.skipReason ?? null,
    scanned_at: record.ts,
    scan_date: record.date,
  }
  const { error } = await admin.from('strategy_scans').insert(row)
  if (error) throw new Error(`[journal] insert strategy_scan failed: ${error.message}`)
}

export async function appendJournal(record: JournalRecord): Promise<void> {
  switch (record.type) {
    case 'order': return insertOrderRow(record)
    case 'trade': return insertTradeRow(record)
    case 'signal_skipped': return insertSignalSkippedRow(record)
    case 'strategy_scan':
      if (!(await isStrategyScanDbEnabled())) return
      return insertStrategyScanRow(record)
    case 'exit_monitor':
    case 'monitor_heartbeat':
      // Lean journal design (spec §8.2) — never persisted. exit_monitor is
      // written by strategy2.ts but nothing reads it back; monitor_heartbeat
      // is dropped explicitly by the spec.
      return
  }
}

// ─── Readers ────────────────────────────────────────────────────────────────

async function fetchRange<T>(
  table: string,
  dateColumn: string,
  startYmd: string,
  endYmd: string,
  mapRow: (row: any) => T,
): Promise<T[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from(table)
    .select('*')
    .eq('customer_id', getCustomerId())
    .gte(dateColumn, startYmd)
    .lte(dateColumn, endYmd)
  if (error) throw new Error(`[journal] read ${table} failed: ${error.message}`)
  return (data || []).map(mapRow)
}

function sortByDateThenTs(a: JournalRecord, b: JournalRecord): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  const aTs = 'ts' in a ? a.ts : ('time' in a ? a.time : '')
  const bTs = 'ts' in b ? b.ts : ('time' in b ? b.time : '')
  return aTs < bTs ? -1 : aTs > bTs ? 1 : 0
}

export async function readJournalRange(startYmd: string, endYmd: string): Promise<JournalRecord[]> {
  const [orders, trades, signals, scans] = await Promise.all([
    fetchRange('orders', 'trade_date', startYmd, endYmd, rowToOrderRecord),
    fetchRange('trades', 'trade_date', startYmd, endYmd, rowToTradeRecord),
    fetchRange('signals_skipped', 'signal_date', startYmd, endYmd, rowToSignalSkippedRecord),
    (await isStrategyScanDbEnabled())
      ? fetchRange('strategy_scans', 'scan_date', startYmd, endYmd, rowToStrategyScanRecord)
      : Promise.resolve([] as StrategyScanRecord[]),
  ])
  const all: JournalRecord[] = [...orders, ...trades, ...signals, ...scans]
  return all.sort(sortByDateThenTs)
}

export async function readJournalMonth(yearMonth: string): Promise<JournalRecord[]> {
  const [y, m] = yearMonth.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const start = `${yearMonth}-01`
  const end = `${yearMonth}-${String(lastDay).padStart(2, '0')}`
  return readJournalRange(start, end)
}

export async function readJournalDay(dateYmd: string): Promise<JournalRecord[]> {
  return readJournalRange(dateYmd, dateYmd)
}

// Returns the sorted list of dates for the in-app date picker (newest first).
// Returns the UNION of:
//   - Every trading day in the last 60 calendar days (Mon-Fri, minus NSE holidays)
//   - Every date that has at least one journal record (preserves older entries)
// This way the retrospective dropdown always shows today + recent past trading
// days, even if no journal records exist yet (e.g. user has been in manual mode).
export async function listJournalDates(): Promise<string[]> {
  const dates = new Set<string>()

  // (1) Trading-day calendar for the last 60 days, anchored to IST.
  let holidays: Set<string> = new Set()
  try {
    holidays = new Set(await getNseHolidays())
  } catch { /* best-effort: if holiday lookup fails, weekends still excluded */ }

  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  for (let i = 0; i < 60; i++) {
    const d = new Date(ist)
    d.setDate(d.getDate() - i)
    const dow = d.getDay()   // 0 = Sun, 6 = Sat
    if (dow === 0 || dow === 6) continue
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (holidays.has(ymd)) continue
    dates.add(ymd)
  }

  // (2) All journal-record dates (preserves anything older than 60 days too).
  try {
    const admin = getSupabaseAdmin()
    const customerId = getCustomerId()
    const [ordersRes, tradesRes, signalsRes] = await Promise.all([
      admin.from('orders').select('trade_date').eq('customer_id', customerId),
      admin.from('trades').select('trade_date').eq('customer_id', customerId),
      admin.from('signals_skipped').select('signal_date').eq('customer_id', customerId),
    ])
    for (const row of ordersRes.data || []) dates.add(row.trade_date)
    for (const row of tradesRes.data || []) dates.add(row.trade_date)
    for (const row of signalsRes.data || []) dates.add(row.signal_date)
  } catch (err) {
    console.warn('[journal] listJournalDates: record-date lookup failed:', String(err).slice(0, 200))
  }

  return Array.from(dates).sort().reverse()
}

// Helpers used at journal-write time

export function istDateString(dateOverride?: Date): string {
  const d = dateOverride ?? new Date()
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`
}

export function istHHMM(dateOverride?: Date): string {
  const d = dateOverride ?? new Date()
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${String(ist.getHours()).padStart(2, '0')}:${String(ist.getMinutes()).padStart(2, '0')}`
}

// Convenience writer for OrderRecord. Derives strategyId from the Kite tag
// (`dt-${id}`). Use this from every order success path so the retrospective
// has a complete history of placements.
export async function journalOrder(opts: {
  account: string
  symbol: string
  side: 'BUY' | 'SELL'
  qty: number
  price: number
  tag?: string
  strategyId?: string   // explicit override — bypasses tag-derived value
  source?: 'auto' | 'manual'  // explicit override
  orderId?: string
}): Promise<void> {
  const tag = opts.tag || ''
  let strategyId: string | undefined = opts.strategyId
  let source: 'auto' | 'manual' = opts.source ?? 'auto'
  if (!strategyId) {
    if (tag === 'dt-manual') source = 'manual'
    else if (tag.startsWith('dt-')) {
      let sid = tag.slice(3).replace(/-(t1|t2|exit)$/, '')
      if (sid === 's1') sid = 'accumulator'
      else if (sid === 's2') sid = 'catalyst'
      strategyId = sid
    }
  }
  await appendJournal({
    type: 'order',
    date: istDateString(),
    ts: new Date().toISOString(),
    account: opts.account.toUpperCase(),
    symbol: opts.symbol.toUpperCase(),
    side: opts.side,
    qty: opts.qty,
    price: opts.price,
    tag: opts.tag,
    strategyId,
    source,
    orderId: opts.orderId,
  })
}

export async function journalExitMonitor(opts: {
  account: string
  symbol: string
  quantity: number
  price: number
  reason: string
  status: 'skipped' | 'failed'
  strategyId?: string
}): Promise<void> {
  await appendJournal({
    type: 'exit_monitor',
    date: istDateString(),
    ts: new Date().toISOString(),
    account: opts.account.toUpperCase(),
    symbol: opts.symbol.toUpperCase(),
    strategyId: opts.strategyId,
    status: opts.status,
    quantity: opts.quantity,
    price: opts.price,
    reason: opts.reason,
  })
}

export async function journalMonitorHeartbeat(opts: {
  source: 'cron' | 'manual'
  accountsChecked: number
  positionsChecked: number
}): Promise<void> {
  await appendJournal({
    type: 'monitor_heartbeat',
    date: istDateString(),
    ts: new Date().toISOString(),
    source: opts.source,
    accountsChecked: opts.accountsChecked,
    positionsChecked: opts.positionsChecked,
  })
}

// Hard-wipes all journal entries for the current customer across
// orders/trades/signals_skipped. strategy_scans is intentionally untouched —
// StrategyScanRecord (and its `strategy_scans` row) has no account field, so
// the original file-based implementation never matched (and thus never
// removed) scan records here either.
// Returns counts so the caller can confirm what was removed. `filesModified`
// is repurposed from "monthly journal files touched" to "tables touched" —
// closest equivalent now that storage isn't file-based.
export async function wipeAccountJournal(): Promise<{ filesModified: number; recordsRemoved: number }> {
  const admin = getSupabaseAdmin()
  const customerId = getCustomerId()
  let filesModified = 0
  let recordsRemoved = 0
  for (const table of ['orders', 'trades', 'signals_skipped'] as const) {
    const { data, error } = await admin
      .from(table)
      .delete()
      .eq('customer_id', customerId)
      .select('id')
    if (error) {
      console.error(`[journal] wipeAccountJournal(${table}) error:`, error)
      continue
    }
    const removed = (data || []).length
    if (removed > 0) {
      filesModified++
      recordsRemoved += removed
    }
  }
  return { filesModified, recordsRemoved }
}

// Returns Map<"SYMBOL", strategyId> for the most recent strategy-owned BUY per
// symbol for the given account within the last 30 days. Used as a fallback tag
// source when a symbol has been sold and removed from the positions store.
// excludeSymbols: set of already-known SYMBOL keys (store wins — skip those).
export async function getJournalStrategyFallback(
  account: string,
  excludeSymbols: Set<string> = new Set(),
): Promise<Map<string, string>> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const journal = await readJournalRange(thirtyDaysAgo, istDateString()).catch(() => [] as JournalRecord[])
  const latest = new Map<string, { strategyId: string; ts: string }>()
  for (const r of journal) {
    if (r.type !== 'order') continue
    const o = r as OrderRecord
    if (o.side !== 'BUY' || !o.strategyId) continue
    if (o.account.toUpperCase() !== account.toUpperCase()) continue
    const sym = o.symbol.toUpperCase()
    if (excludeSymbols.has(sym)) continue
    const prev = latest.get(sym)
    if (!prev || o.ts > prev.ts) latest.set(sym, { strategyId: o.strategyId, ts: o.ts })
  }
  const result = new Map<string, string>()
  for (const [sym, { strategyId }] of Array.from(latest)) result.set(sym, strategyId)
  return result
}

export function classifyVerdict(opts: {
  strategy: StrategyTag
  entryPrice: number
  exitPrice: number
  t1TriggerPct: number       // typically 1.5 for Strategy 2
  isDelivery?: boolean
}): TradeVerdict {
  if (opts.isDelivery) return 'delivery'
  if (opts.strategy === 'manual') return 'manual'
  const gainPct = ((opts.exitPrice - opts.entryPrice) / opts.entryPrice) * 100
  if (gainPct >= opts.t1TriggerPct - 0.05) return 'correct_exit'   // tiny tolerance for fill slippage
  return 'early_exit'
}
