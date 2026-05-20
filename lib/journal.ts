// Append-only daily trade + signal journal. One file per IST month at
// ~/dineshtrade/data/journal-YYYY-MM.jsonl. Files are never overwritten by
// deployments — they live alongside state.json and strategy1.json.
//
// Two record types:
//   - trade           : completed trade (BUY entry + SELL exit pair)
//   - signal_skipped  : Auto-mode cron tried to BUY a rec but preflight blocked

import { promises as fs } from 'fs'
import * as path from 'path'

export type TradeVerdict = 'correct_exit' | 'early_exit' | 'delivery' | 'manual'
export type StrategyTag = 'catalyst' | 'accumulator' | 'manual'

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

export type JournalRecord = TradeRecord | SignalSkippedRecord | StrategyScanRecord | OrderRecord

// Storage is anchored to the same dir as state.json. Local dev (cookie state)
// keeps it in memory only — fine since cron won't run there anyway.
const STATE_FILE_PATH = process.env.STATE_FILE_PATH || ''
const JOURNAL_DIR = STATE_FILE_PATH ? path.dirname(STATE_FILE_PATH) : ''
const useFile = !!JOURNAL_DIR
const memStore: JournalRecord[] = []

function ymKey(dateYmd: string): string { return dateYmd.slice(0, 7) }
function journalPath(yearMonth: string): string {
  return path.join(JOURNAL_DIR, `journal-${yearMonth}.jsonl`)
}

export async function appendJournal(record: JournalRecord): Promise<void> {
  if (!useFile) { memStore.push(record); return }
  await fs.mkdir(JOURNAL_DIR, { recursive: true })
  const filePath = journalPath(ymKey(record.date))
  await fs.appendFile(filePath, JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 })
}

export async function readJournalMonth(yearMonth: string): Promise<JournalRecord[]> {
  if (!useFile) return memStore.filter(r => ymKey(r.date) === yearMonth)
  try {
    const raw = await fs.readFile(journalPath(yearMonth), 'utf8')
    const out: JournalRecord[] = []
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try { out.push(JSON.parse(t) as JournalRecord) } catch { /* malformed line */ }
    }
    return out
  } catch { return [] }
}

export async function readJournalDay(dateYmd: string): Promise<JournalRecord[]> {
  const records = await readJournalMonth(ymKey(dateYmd))
  return records.filter(r => r.date === dateYmd)
}

export async function readJournalRange(startYmd: string, endYmd: string): Promise<JournalRecord[]> {
  // Collect the unique YYYY-MM months that the range spans, then filter.
  const months = new Set<string>()
  const start = new Date(startYmd + 'T00:00:00Z')
  const end = new Date(endYmd + 'T23:59:59Z')
  for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d.setMonth(d.getMonth() + 1)) {
    months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const all: JournalRecord[] = []
  for (const ym of Array.from(months)) all.push(...await readJournalMonth(ym))
  return all.filter(r => r.date >= startYmd && r.date <= endYmd)
}

// Returns the sorted list of dates for the in-app date picker (newest first).
// Now returns the UNION of:
//   - Every trading day in the last 60 calendar days (Mon-Fri, minus NSE holidays)
//   - Every date that has at least one journal record (preserves older entries)
// This way the retrospective dropdown always shows today + recent past trading
// days, even if no journal records exist yet (e.g. user has been in manual mode).
// The retrospective builder uses journaled orders for past dates and live Kite
// for today, so the dropdown entries always resolve to a renderable report.
export async function listJournalDates(): Promise<string[]> {
  const dates = new Set<string>()

  // (1) Trading-day calendar for the last 60 days, anchored to IST.
  let holidays: Set<string> = new Set()
  try {
    const mod = await import('@/config/holidays.json')
    const arr = (mod as any).default?.holidays ?? (mod as any).holidays ?? []
    holidays = new Set(Array.isArray(arr) ? arr : [])
  } catch { /* missing holidays.json = no holidays applied (weekends still excluded) */ }

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
  if (useFile) {
    try {
      const files = await fs.readdir(JOURNAL_DIR)
      const jrFiles = files.filter(f => /^journal-\d{4}-\d{2}\.jsonl$/.test(f))
      for (const f of jrFiles) {
        const ym = f.match(/^journal-(\d{4}-\d{2})\.jsonl$/)![1]
        const records = await readJournalMonth(ym)
        for (const r of records) dates.add(r.date)
      }
    } catch { /* journal dir missing or unreadable — fine, calendar dates still returned */ }
  } else {
    for (const r of memStore) dates.add(r.date)
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
  orderId?: string
}): Promise<void> {
  const tag = opts.tag || ''
  let strategyId: string | undefined
  let source: 'auto' | 'manual' = 'auto'
  if (tag === 'dt-manual') source = 'manual'
  else if (tag.startsWith('dt-')) {
    let sid = tag.slice(3).replace(/-(t1|t2|exit)$/, '')
    if (sid === 's1') sid = 'accumulator'
    else if (sid === 's2') sid = 'catalyst'
    strategyId = sid
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
