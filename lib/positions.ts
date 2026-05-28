// Unified position store. Replaces the per-strategy stores (`strategy1.json` +
// `strategy2_positions.json`) with a single file keyed by (account, symbol).
//
// The KEY change: every position record now carries a `strategyId` field, so
// the monitor can look up its parent strategy's params (T1/T2, handoff window)
// instead of falling back to a single hardcoded strategy per category. This
// unlocks per-strategy exit profiles — a "quickwin" momentum strategy can have
// 1.0%/1.2% exits separately from "catalyst" at 1.5%/2.0%.
//
// Migration: on first load after the refactor deploy, the loader reads the
// legacy files, merges them with explicit strategyId stamps, writes the new
// file, and renames the originals to `.migrated`. Self-healing — if the new
// file is corrupted, deleting it falls back to legacy on next load.

import { promises as fs } from 'fs'
import * as path from 'path'

export interface Position {
  strategyId: string          // 'accumulator', 'catalyst', or any user-created strategy id
  account: string             // uppercase
  symbol: string              // uppercase
  firstBuyPrice: number       // anchor for T1/T2 calculations (% off this number)
  firstBuyAt: string          // ISO timestamp — anchors handoff clock for momentum strategies
  totalQty: number            // cumulative across pyramid BUYs
  remainingQty: number        // after any tranche sells
  tranche1At?: string | null  // ISO when tranche 1 sold (null = not yet)
  tranche1SoldQty?: number
}

type PositionsMap = Record<string, Position>   // key: "ACCOUNT:SYMBOL"

const STATE_FILE_PATH = process.env.STATE_FILE_PATH || ''
const POS_FILE = STATE_FILE_PATH ? path.join(path.dirname(STATE_FILE_PATH), 'positions.json') : ''
const LEGACY_S1 = STATE_FILE_PATH ? path.join(path.dirname(STATE_FILE_PATH), 'strategy1.json') : ''
const LEGACY_S2 = STATE_FILE_PATH ? path.join(path.dirname(STATE_FILE_PATH), 'strategy2_positions.json') : ''
const useFile = !!POS_FILE

// In-memory fallback for local dev (no STATE_FILE_PATH set)
const memStore: PositionsMap = {}

function makeKey(account: string, symbol: string): string {
  return `${account.toUpperCase()}:${symbol.toUpperCase()}`
}

function isoFromYmd(ymd: string): string {
  // Synthesize an ISO timestamp at IST market open (09:15) for legacy strategy1
  // entries that only stored YYYY-MM-DD. Used purely to seed `firstBuyAt` so
  // the field has a meaningful value; downstream code only cares about the
  // calendar-day age, not sub-minute precision.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return new Date().toISOString()
  return `${ymd}T03:45:00.000Z`   // 09:15 IST = 03:45 UTC
}

async function readJsonSafe<T = any>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch { return null }
}

async function writeJsonAtomic(filePath: string, data: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = filePath + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, filePath)
}

// One-shot migration from legacy files. Reads strategy1.json + strategy2_positions.json,
// stamps strategyId, writes positions.json, renames legacy files to .migrated.
// Idempotent — if positions.json already exists, skips migration entirely.
async function migrateIfNeeded(): Promise<PositionsMap> {
  if (!useFile) return {}

  // Already migrated? Just read.
  const existing = await readJsonSafe<PositionsMap>(POS_FILE)
  if (existing && typeof existing === 'object') return existing

  console.log('[positions] no positions.json found — checking for legacy files to migrate')
  const unified: PositionsMap = {}

  // Migrate legacy strategy1.json (accumulator positions)
  const s1 = await readJsonSafe<Record<string, any>>(LEGACY_S1)
  if (s1 && typeof s1 === 'object') {
    for (const [k, v] of Object.entries(s1)) {
      if (!v || typeof v !== 'object') continue
      const [account, symbol] = k.split(':')
      if (!account || !symbol) continue
      unified[makeKey(account, symbol)] = {
        strategyId: 'accumulator',
        account: account.toUpperCase(),
        symbol: symbol.toUpperCase(),
        firstBuyPrice: Number(v.entryPrice) || 0,
        firstBuyAt: typeof v.boughtAt === 'string' ? isoFromYmd(v.boughtAt) : new Date().toISOString(),
        totalQty: Number(v.entryQty ?? v.remainingQty) || 0,
        remainingQty: Number(v.remainingQty) || 0,
        tranche1At: typeof v.tranche1At === 'string' ? v.tranche1At : null,
        tranche1SoldQty: Number(v.tranche1SoldQty) || undefined,
      }
    }
    console.log(`[positions] migrated ${Object.keys(s1).length} entries from strategy1.json → accumulator`)
  }

  // Migrate legacy strategy2_positions.json (catalyst positions)
  const s2 = await readJsonSafe<Record<string, any>>(LEGACY_S2)
  if (s2 && typeof s2 === 'object') {
    for (const [k, v] of Object.entries(s2)) {
      if (!v || typeof v !== 'object') continue
      const [account, symbol] = k.split(':')
      if (!account || !symbol) continue
      const unifiedKey = makeKey(account, symbol)
      // If accumulator already migrated this key (unlikely but defensive), prefer accumulator
      if (unified[unifiedKey]) {
        console.warn(`[positions] both s1 + s2 have ${unifiedKey} — keeping s1 (accumulator) record`)
        continue
      }
      unified[unifiedKey] = {
        strategyId: 'catalyst',
        account: account.toUpperCase(),
        symbol: symbol.toUpperCase(),
        firstBuyPrice: Number(v.firstBuyPrice) || 0,
        firstBuyAt: typeof v.firstBuyAt === 'string' ? v.firstBuyAt : new Date().toISOString(),
        totalQty: Number(v.totalQty) || 0,
        remainingQty: Number(v.remainingQty) || 0,
        tranche1At: typeof v.tranche1At === 'string' ? v.tranche1At : null,
        tranche1SoldQty: Number(v.tranche1SoldQty) || undefined,
      }
    }
    console.log(`[positions] migrated ${Object.keys(s2).length} entries from strategy2_positions.json → catalyst`)
  }

  // Persist new file, then rename legacy files to .migrated as a soft-delete
  // (keeps a recovery path if something looks wrong post-migration).
  await writeJsonAtomic(POS_FILE, unified)
  try { if (s1) await fs.rename(LEGACY_S1, LEGACY_S1 + '.migrated') } catch {}
  try { if (s2) await fs.rename(LEGACY_S2, LEGACY_S2 + '.migrated') } catch {}

  console.log(`[positions] migration complete — ${Object.keys(unified).length} unified entries written to positions.json`)
  return unified
}

async function readAll(): Promise<PositionsMap> {
  if (!useFile) return JSON.parse(JSON.stringify(memStore))
  return await migrateIfNeeded()
}

async function writeAll(p: PositionsMap): Promise<void> {
  if (!useFile) {
    Object.keys(memStore).forEach(k => delete memStore[k])
    Object.assign(memStore, p)
    return
  }
  await writeJsonAtomic(POS_FILE, p)
}

// ─── Public API ────────────────────────────────────────────────────────────

// Pyramid-aware BUY recorder. If a position exists for (account, symbol):
//   - keep firstBuyAt + firstBuyPrice + strategyId (anchored to original entry)
//   - add qty to totalQty + remainingQty
// Otherwise create fresh entry with the given strategyId.
export async function recordBuy(strategyId: string, account: string, symbol: string, qty: number, price: number): Promise<void> {
  const positions = await readAll()
  const k = makeKey(account, symbol)
  const existing = positions[k]
  if (existing) {
    existing.totalQty += qty
    existing.remainingQty += qty
    console.log(`[positions] pyramid BUY ${k} +${qty} @ ₹${price} (totalQty ${existing.totalQty}; anchor unchanged @ ₹${existing.firstBuyPrice}, strategyId=${existing.strategyId})`)
  } else {
    positions[k] = {
      strategyId,
      account: account.toUpperCase(),
      symbol: symbol.toUpperCase(),
      firstBuyPrice: price,
      firstBuyAt: new Date().toISOString(),
      totalQty: qty,
      remainingQty: qty,
      tranche1At: null,
    }
    console.log(`[positions] new ${strategyId} position ${k} × ${qty} @ ₹${price}`)
  }
  await writeAll(positions)
}

// Idempotent — only creates a new entry if (account, symbol) doesn't already
// have one. Used by the handoff flow (re-stamping strategyId is a separate
// op via setStrategyId). Returns true on create, false if skipped.
export async function ensureTracked(strategyId: string, account: string, symbol: string, qty: number, price: number): Promise<boolean> {
  const positions = await readAll()
  const k = makeKey(account, symbol)
  if (positions[k]) return false
  positions[k] = {
    strategyId,
    account: account.toUpperCase(),
    symbol: symbol.toUpperCase(),
    firstBuyPrice: price,
    firstBuyAt: new Date().toISOString(),
    totalQty: qty,
    remainingQty: qty,
    tranche1At: null,
  }
  await writeAll(positions)
  return true
}

export async function markTranche1Sold(account: string, symbol: string, soldQty: number): Promise<void> {
  const positions = await readAll()
  const k = makeKey(account, symbol)
  const p = positions[k]
  if (!p) return
  p.tranche1At = new Date().toISOString()
  p.tranche1SoldQty = soldQty
  p.remainingQty = Math.max(0, p.remainingQty - soldQty)
  await writeAll(positions)
}

export async function removePosition(account: string, symbol: string): Promise<void> {
  const positions = await readAll()
  const k = makeKey(account, symbol)
  if (!(k in positions)) return
  delete positions[k]
  await writeAll(positions)
}

export async function getPosition(account: string, symbol: string): Promise<Position | null> {
  const positions = await readAll()
  return positions[makeKey(account, symbol)] || null
}

export async function listPositions(opts?: { account?: string; strategyId?: string }): Promise<Position[]> {
  const positions = await readAll()
  const out: Position[] = []
  for (const v of Object.values(positions)) {
    if (opts?.account && v.account !== opts.account.toUpperCase()) continue
    if (opts?.strategyId && v.strategyId !== opts.strategyId) continue
    out.push(v)
  }
  return out
}

// Single-position strategyId setter — used by the handoff flow.
// Returns true if changed, false if the position doesn't exist or already
// has the target strategyId.
export async function setStrategyId(account: string, symbol: string, newStrategyId: string): Promise<boolean> {
  const all = await readAll()
  const k = makeKey(account, symbol)
  const p = all[k]
  if (!p || p.strategyId === newStrategyId) return false
  console.log(`[positions] re-stamped ${k}: ${p.strategyId} → ${newStrategyId}`)
  p.strategyId = newStrategyId
  await writeAll(all)
  return true
}

// Re-stamp the strategyId of every position currently owned by `fromId` to
// `toId`. Used when a strategy is deactivated or deleted — all its open
// positions migrate to the accumulator's care. Returns the count migrated.
export async function migrateStrategyId(fromId: string, toId: string): Promise<number> {
  if (fromId === toId) return 0
  const positions = await readAll()
  let count = 0
  for (const k of Object.keys(positions)) {
    if (positions[k].strategyId === fromId) {
      positions[k].strategyId = toId
      count++
    }
  }
  if (count > 0) {
    await writeAll(positions)
    console.log(`[positions] migrated ${count} positions: ${fromId} → ${toId}`)
  }
  return count
}

// Removes all positions belonging to the given account. Used by the reset flow.
export async function wipeAccountPositions(account: string): Promise<number> {
  const positions = await readAll()
  const acct = account.toUpperCase()
  let removed = 0
  for (const k of Object.keys(positions)) {
    if (positions[k].account.toUpperCase() === acct) {
      delete positions[k]
      removed++
    }
  }
  if (removed > 0) await writeAll(positions)
  return removed
}

// Calendar-day age of a position from its firstBuyAt. Used by the handoff
// check for momentum strategies.
export function ageInCalendarDays(firstBuyAt: string): number {
  const start = new Date(firstBuyAt).getTime()
  const now = Date.now()
  return (now - start) / (1000 * 60 * 60 * 24)
}
