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

export interface PositionLot {
  id: string
  boughtAt: string
  entryPrice: number
  originalQty: number
  remainingQty: number
  tranche1At?: string | null
  tranche1SoldQty?: number
  strategyId?: string       // source strategy that bought this lot (optional for backward compat)
}

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
  lots?: PositionLot[]        // momentum strategies can carry per-buy exit ladders
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

function round2(value: number): number {
  return Number(value.toFixed(2))
}

function makeLotId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeLot(qty: number, price: number, boughtAt = new Date().toISOString(), strategyId?: string): PositionLot {
  return {
    id: makeLotId(),
    boughtAt,
    entryPrice: price,
    originalQty: qty,
    remainingQty: qty,
    tranche1At: null,
    strategyId,
  }
}

async function isTrackedStrategyId(strategyId: string): Promise<boolean> {
  try {
    const { getStrategyById } = await import('./strategyConfig')
    return !!getStrategyById(strategyId)
  } catch {
    return false
  }
}

function getActiveLots(position: Position): PositionLot[] {
  return (position.lots || []).filter(lot => lot.remainingQty > 0)
}

function synthesizeLegacyLot(position: Position): PositionLot {
  return {
    id: makeLotId(),
    boughtAt: position.firstBuyAt || new Date().toISOString(),
    entryPrice: position.firstBuyPrice,
    originalQty: position.totalQty || position.remainingQty,
    remainingQty: position.remainingQty,
    tranche1At: position.tranche1At ?? null,
    tranche1SoldQty: position.tranche1SoldQty,
    strategyId: position.strategyId,  // legacy lot inherits position's strategy
  }
}

function summarizeMomentumPosition(position: Position): void {
  const activeLots = getActiveLots(position)
  const basisLots = activeLots.length > 0 ? activeLots : (position.lots || [])
  if (basisLots.length === 0) {
    position.totalQty = 0
    position.remainingQty = 0
    position.firstBuyPrice = 0
    position.firstBuyAt = ''
    position.tranche1At = null
    position.tranche1SoldQty = 0
    return
  }

  const remainingQty = activeLots.reduce((sum, lot) => sum + lot.remainingQty, 0)
  const weightedRemainingNotional = activeLots.reduce((sum, lot) => sum + (lot.remainingQty * lot.entryPrice), 0)
  position.totalQty = basisLots.reduce((sum, lot) => sum + lot.originalQty, 0)
  position.remainingQty = remainingQty
  position.firstBuyAt = basisLots.reduce((earliest, lot) => earliest && earliest < lot.boughtAt ? earliest : lot.boughtAt, basisLots[0].boughtAt)
  position.firstBuyPrice = remainingQty > 0
    ? round2(weightedRemainingNotional / remainingQty)
    : round2(basisLots.reduce((sum, lot) => sum + (lot.originalQty * lot.entryPrice), 0) / Math.max(1, basisLots.reduce((sum, lot) => sum + lot.originalQty, 0)))
  position.tranche1At = activeLots.every(lot => !!lot.tranche1At)
    ? activeLots.reduce<string | null>((latest, lot) => {
        const value = lot.tranche1At || null
        if (!value) return latest
        return !latest || value > latest ? value : latest
      }, null)
    : null
  position.tranche1SoldQty = activeLots.reduce((sum, lot) => sum + (lot.tranche1SoldQty || 0), 0)
}

function ensureMomentumLots(position: Position): PositionLot[] {
  if (!position.lots || position.lots.length === 0) {
    position.lots = [synthesizeLegacyLot(position)]
  }
  return position.lots
}

async function normalizePosition(position: Position): Promise<boolean> {
  if (!(await isTrackedStrategyId(position.strategyId))) return false
  ensureMomentumLots(position)
  summarizeMomentumPosition(position)
  return true
}

export async function listPositionLots(position: Position): Promise<PositionLot[]> {
  if (!(await isTrackedStrategyId(position.strategyId))) return []
  const lots = ensureMomentumLots(position)
  summarizeMomentumPosition(position)
  return lots.map(lot => ({ ...lot }))
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
  if (existing && typeof existing === 'object') {
    let changed = false
    for (const position of Object.values(existing)) {
      if (await normalizePosition(position)) changed = true
    }
    if (changed) await writeJsonAtomic(POS_FILE, existing)
    return existing
  }

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
//   - keep the existing strategy owner on the row
//   - preserve the incoming fill as its own lot whenever the row is tracked
// This matters when a symbol was re-tagged (for example catalyst -> accumulator)
// and later receives another BUY. Aggregating into the old anchor price would
// erase lot-level exits; we need the new fill to remain independently sellable.
// Otherwise create fresh entry with the given strategyId.
export async function recordBuy(strategyId: string, account: string, symbol: string, qty: number, price: number): Promise<void> {
  const positions = await readAll()
  const k = makeKey(account, symbol)
  const existing = positions[k]
  if (existing) {
    const existingTracked = await isTrackedStrategyId(existing.strategyId)
    const incomingTracked = await isTrackedStrategyId(strategyId)
    if (existingTracked || incomingTracked) {
      const lots = ensureMomentumLots(existing)
      lots.push(makeLot(qty, price, new Date().toISOString(), strategyId))
      summarizeMomentumPosition(existing)
      if (existing.strategyId !== strategyId) {
        console.log(`[positions] lot BUY ${k} +${qty} @ ₹${price} (owner stays ${existing.strategyId}; source strategy ${strategyId}; lots ${lots.length}; avg ₹${existing.firstBuyPrice}, remaining ${existing.remainingQty})`)
      } else {
        console.log(`[positions] lot BUY ${k} +${qty} @ ₹${price} (lots ${lots.length}; avg ₹${existing.firstBuyPrice}, remaining ${existing.remainingQty}, strategyId=${existing.strategyId})`)
      }
    } else {
      existing.totalQty += qty
      existing.remainingQty += qty
      console.log(`[positions] pyramid BUY ${k} +${qty} @ ₹${price} (totalQty ${existing.totalQty}; anchor unchanged @ ₹${existing.firstBuyPrice}, strategyId=${existing.strategyId})`)
    }
  } else {
    const next: Position = {
      strategyId,
      account: account.toUpperCase(),
      symbol: symbol.toUpperCase(),
      firstBuyPrice: price,
      firstBuyAt: new Date().toISOString(),
      totalQty: qty,
      remainingQty: qty,
      tranche1At: null,
    }
    if (await isTrackedStrategyId(strategyId)) {
      next.lots = [makeLot(qty, price, next.firstBuyAt, strategyId)]
      summarizeMomentumPosition(next)
    }
    positions[k] = next
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

// Seeds a missing position with an explicit BUY anchor (price + timestamp).
// Used by monitor reseed paths so restart/rebuild flows do not reset anchors
// to "now" and accidentally trigger exits from stale/incorrect prices.
export async function seedMissingPosition(strategyId: string, account: string, symbol: string, qty: number, price: number, boughtAtIso: string): Promise<boolean> {
  const positions = await readAll()
  const k = makeKey(account, symbol)
  if (positions[k]) return false

  const safeBoughtAt = Number.isFinite(new Date(boughtAtIso).getTime()) ? boughtAtIso : new Date().toISOString()
  const next: Position = {
    strategyId,
    account: account.toUpperCase(),
    symbol: symbol.toUpperCase(),
    firstBuyPrice: price,
    firstBuyAt: safeBoughtAt,
    totalQty: qty,
    remainingQty: qty,
    tranche1At: null,
  }
  if (await isTrackedStrategyId(strategyId)) {
    next.lots = [makeLot(qty, price, safeBoughtAt, strategyId)]
    summarizeMomentumPosition(next)
  }
  positions[k] = next
  await writeAll(positions)
  return true
}

// Repairs an existing single-lot position anchor (price + timestamp).
// Intended for self-healing old reseeded rows that were stamped with stale
// prices and "now" timestamps after a restart.
export async function realignPositionAnchor(account: string, symbol: string, price: number, boughtAtIso: string): Promise<boolean> {
  const positions = await readAll()
  const k = makeKey(account, symbol)
  const p = positions[k]
  if (!p) return false

  const safeBoughtAt = Number.isFinite(new Date(boughtAtIso).getTime()) ? boughtAtIso : p.firstBuyAt
  p.firstBuyPrice = price
  p.firstBuyAt = safeBoughtAt

  if (p.lots && p.lots.length === 1) {
    p.lots[0].entryPrice = price
    p.lots[0].boughtAt = safeBoughtAt
  }

  if (p.lots && p.lots.length > 0) summarizeMomentumPosition(p)
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

export async function applyLotSell(account: string, symbol: string, lotId: string, soldQty: number, opts?: { markTranche1?: boolean }): Promise<void> {
  const positions = await readAll()
  const k = makeKey(account, symbol)
  const p = positions[k]
  if (!p || !p.lots || soldQty <= 0) return
  const lot = p.lots.find(item => item.id === lotId)
  if (!lot || lot.remainingQty <= 0) return
  const executedQty = Math.min(soldQty, lot.remainingQty)
  if (opts?.markTranche1) {
    lot.tranche1At = new Date().toISOString()
    lot.tranche1SoldQty = (lot.tranche1SoldQty || 0) + executedQty
  }
  lot.remainingQty = Math.max(0, lot.remainingQty - executedQty)
  summarizeMomentumPosition(p)
  if (p.remainingQty <= 0) {
    delete positions[k]
  }
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
    // Refresh weighted average price for momentum strategies with lots
    if (v.lots && v.lots.length > 0) {
      summarizeMomentumPosition(v)
    }
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

// Set the strategyId for a single lot within a tracked position. Returns
// true if changed. This allows per-lot strategy ownership when a symbol has
// mixed lots from multiple strategies.
export async function setLotStrategyId(account: string, symbol: string, lotId: string, newStrategyId: string): Promise<boolean> {
  const all = await readAll()
  const k = makeKey(account, symbol)
  const p = all[k]
  if (!p || !p.lots || p.lots.length === 0) return false
  const lot = p.lots.find(l => l.id === lotId)
  if (!lot) return false
  if (lot.strategyId === newStrategyId) return false
  lot.strategyId = newStrategyId
  console.log(`[positions] re-stamped lot ${k}#${lotId}: → ${newStrategyId}`)
  // Recompute position summary if needed
  if (p.lots && p.lots.length > 0) summarizeMomentumPosition(p)
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
