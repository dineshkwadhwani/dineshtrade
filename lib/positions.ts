// Unified position store — Supabase-backed (`customer_positions`, one row
// per (customer_id, symbol)). Ported from the file-based `positions.json` in
// Phase 4 of the multi-tenant refactor; see docs/DALGO_REFACTOR_SPEC_v2.md
// §16 Phase 4 and scripts/migrations/2026-08-09-phase4-schema-extensions.sql
// for the two columns (`strategy_tag`, `account`) added to fit this file's
// existing shape without touching its business logic.
//
// Every position record carries a `strategyId` field, so the monitor can
// look up its parent strategy's params (T1/T2, handoff window) instead of
// falling back to a single hardcoded strategy per category. This unlocks
// per-strategy exit profiles — a "quickwin" momentum strategy can have
// 1.0%/1.2% exits separately from "catalyst" at 1.5%/2.0%.
//
// Per spec §9.3 ("What NOT to Migrate"), positions.json is NOT migrated —
// customers start with an empty customer_positions table and it's rebuilt
// fresh from live trading. The old strategy1.json/strategy2_positions.json
// legacy-file migration this module used to carry has no equivalent here.

import { getSupabaseAdmin, getCustomerId } from './supabase'
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

function makeKey(account: string, symbol: string): string {
  return `${account.toUpperCase()}:${symbol.toUpperCase()}`
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

// Returns true only if normalizing actually mutated the position (e.g. first-time
// legacy lot synthesis, or a derived field was stale). Reporting "changed" when
// nothing actually changed causes readAll() to upsert on every single read
// (listPositions/getPosition are called constantly — every page load, every
// cron tick) — which turns a plain read into a write racing against any
// concurrent recordBuy/applyLotSell, silently dropping the other write's lot.
async function normalizePosition(position: Position): Promise<boolean> {
  if (!(await isTrackedStrategyId(position.strategyId))) return false
  const before = JSON.stringify(position)
  ensureMomentumLots(position)
  summarizeMomentumPosition(position)
  return JSON.stringify(position) !== before
}

export async function listPositionLots(position: Position): Promise<PositionLot[]> {
  if (!(await isTrackedStrategyId(position.strategyId))) return []
  const lots = ensureMomentumLots(position)
  summarizeMomentumPosition(position)
  return lots.map(lot => ({ ...lot }))
}

// ─── Supabase row mapping ──────────────────────────────────────────────────

function rowToPosition(row: any): Position {
  return {
    strategyId: row.strategy_tag || '',
    account: (row.account || '').toUpperCase(),
    symbol: (row.symbol || '').toUpperCase(),
    firstBuyPrice: Number(row.first_buy_price) || 0,
    firstBuyAt: row.first_buy_at || new Date().toISOString(),
    totalQty: Number(row.total_qty) || 0,
    remainingQty: Number(row.remaining_qty) || 0,
    tranche1At: row.tranche1_at ?? null,
    tranche1SoldQty: row.tranche1_sold_qty ?? undefined,
    lots: Array.isArray(row.lots) && row.lots.length > 0 ? row.lots : undefined,
  }
}

function positionToRow(customerId: string, position: Position): Record<string, unknown> {
  return {
    customer_id: customerId,
    symbol: position.symbol.toUpperCase(),
    account: position.account.toUpperCase(),
    strategy_tag: position.strategyId,
    total_qty: position.totalQty,
    remaining_qty: position.remainingQty,
    first_buy_price: position.firstBuyPrice,
    first_buy_at: position.firstBuyAt || new Date().toISOString(),
    tranche1_at: position.tranche1At ?? null,
    tranche1_sold_qty: position.tranche1SoldQty ?? 0,
    lots: position.lots ?? [],
    status: position.remainingQty > 0 ? 'open' : 'closed',
    updated_at: new Date().toISOString(),
  }
}

async function upsertPosition(position: Position): Promise<void> {
  const admin = getSupabaseAdmin()
  const row = positionToRow(getCustomerId(), position)
  const { error } = await admin.from('customer_positions').upsert(row, { onConflict: 'customer_id,symbol' })
  if (error) throw new Error(`[positions] upsert failed for ${position.symbol}: ${error.message}`)
}

async function deletePositionRow(symbol: string): Promise<void> {
  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('customer_positions')
    .delete()
    .eq('customer_id', getCustomerId())
    .eq('symbol', symbol.toUpperCase())
  if (error) throw new Error(`[positions] delete failed for ${symbol}: ${error.message}`)
}

// Reads every position row for this customer, lazily self-healing (see
// normalizePosition) any tracked-strategy row that's missing its lot ladder.
async function readAll(): Promise<PositionsMap> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('customer_positions').select('*').eq('customer_id', getCustomerId())
  if (error) {
    // Datastore unreachable — fire critical alert then let the error propagate
    // so all callers (cron monitors, BUY/SELL engine) abort cleanly rather
    // than operating on a stale/empty snapshot.
    const { sendDatastoreAlert } = await import('./email')
    sendDatastoreAlert(`positions readAll: ${error.message}`).catch(() => {})
    throw new Error(`[positions] read failed: ${error.message}`)
  }

  const map: PositionsMap = {}
  for (const row of data || []) {
    const position = rowToPosition(row)
    if (await normalizePosition(position)) {
      await upsertPosition(position)
    }
    map[makeKey(position.account, position.symbol)] = position
  }
  return map
}

// Serializes every read-modify-write against customer_positions. All cron
// tasks + API routes run in one long-lived Node process (PM2, not
// clustered) per customer instance, so an in-process mutex is sufficient
// here — no cross-process locking needed. Without it, two BUY/SELL
// operations whose `await`s land in the same event-loop window can
// interleave: both read the same pre-mutation snapshot, and whichever
// writes last silently drops the other's lot.
let lockQueue: Promise<unknown> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lockQueue.then(fn, fn)
  lockQueue = run.then(() => undefined, () => undefined)
  return run
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
  return withLock(async () => {
    const positions = await readAll()
    const k = makeKey(account, symbol)
    // Fall back to symbol-only match — positions migrated from V1 or seeded before
    // the account field was normalised may live under a different account key.
    // We must not overwrite their strategy_tag.
    const existing = positions[k] ??
      Object.values(positions).find(p => p.symbol === symbol.toUpperCase() && (!p.account || p.account === account.toUpperCase()))
    if (existing) {
      // Self-heal the account field so future lookups use the correct key
      if (existing.account !== account.toUpperCase()) {
        existing.account = account.toUpperCase()
      }
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
      await upsertPosition(existing)
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
      console.log(`[positions] new ${strategyId} position ${k} × ${qty} @ ₹${price}`)
      await upsertPosition(next)
    }
  })
}

// Idempotent — only creates a new entry if (account, symbol) doesn't already
// have one. Used by the handoff flow (re-stamping strategyId is a separate
// op via setStrategyId). Returns true on create, false if skipped.
export async function ensureTracked(strategyId: string, account: string, symbol: string, qty: number, price: number): Promise<boolean> {
  return withLock(async () => {
    const positions = await readAll()
    const k = makeKey(account, symbol)
    if (positions[k]) return false
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
    await upsertPosition(next)
    return true
  })
}

// Seeds a missing position with an explicit BUY anchor (price + timestamp).
// Used by monitor reseed paths so restart/rebuild flows do not reset anchors
// to "now" and accidentally trigger exits from stale/incorrect prices.
export async function seedMissingPosition(strategyId: string, account: string, symbol: string, qty: number, price: number, boughtAtIso: string): Promise<boolean> {
  return withLock(async () => {
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
    await upsertPosition(next)
    return true
  })
}

// Repairs an existing single-lot position anchor (price + timestamp).
// Intended for self-healing old reseeded rows that were stamped with stale
// prices and "now" timestamps after a restart.
export async function realignPositionAnchor(account: string, symbol: string, price: number, boughtAtIso: string): Promise<boolean> {
  return withLock(async () => {
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
    await upsertPosition(p)
    return true
  })
}

export async function markTranche1Sold(account: string, symbol: string, soldQty: number): Promise<void> {
  return withLock(async () => {
    const positions = await readAll()
    const k = makeKey(account, symbol)
    const p = positions[k]
    if (!p) return
    p.tranche1At = new Date().toISOString()
    p.tranche1SoldQty = soldQty
    p.remainingQty = Math.max(0, p.remainingQty - soldQty)
    await upsertPosition(p)
  })
}

export async function applyLotSell(account: string, symbol: string, lotId: string, soldQty: number, opts?: { markTranche1?: boolean }): Promise<void> {
  return withLock(async () => {
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
      await deletePositionRow(symbol)
    } else {
      await upsertPosition(p)
    }
  })
}

export async function removePosition(account: string, symbol: string): Promise<void> {
  return withLock(async () => {
    void account   // kept for signature compatibility — deletion is keyed by (customer_id, symbol)
    await deletePositionRow(symbol)
  })
}

export async function getPosition(account: string, symbol: string): Promise<Position | null> {
  return withLock(async () => {
    const positions = await readAll()
    return positions[makeKey(account, symbol)] || null
  })
}

export async function listPositions(opts?: { account?: string; strategyId?: string }): Promise<Position[]> {
  return withLock(async () => {
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
  })
}

// Single-position strategyId setter — used by the handoff flow.
// Returns true if changed, false if the position doesn't exist or already
// has the target strategyId.
export async function setStrategyId(account: string, symbol: string, newStrategyId: string): Promise<boolean> {
  return withLock(async () => {
    const all = await readAll()
    const k = makeKey(account, symbol)
    // Fall back to symbol-only match for positions with a mismatched account field
    const p = all[k] ?? Object.values(all).find(pos => pos.symbol === symbol.toUpperCase() && (!pos.account || pos.account === account.toUpperCase()))
    if (!p || p.strategyId === newStrategyId) return false
    // Self-heal account field while we're here
    if (p.account !== account.toUpperCase()) p.account = account.toUpperCase()
    console.log(`[positions] re-stamped ${symbol}: ${p.strategyId} → ${newStrategyId}`)
    p.strategyId = newStrategyId
    await upsertPosition(p)
    return true
  })
}

// Set the strategyId for a single lot within a tracked position. Returns
// true if changed. This allows per-lot strategy ownership when a symbol has
// mixed lots from multiple strategies.
export async function setLotStrategyId(account: string, symbol: string, lotId: string, newStrategyId: string): Promise<boolean> {
  return withLock(async () => {
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
    await upsertPosition(p)
    return true
  })
}

// Re-stamp the strategyId of every position currently owned by `fromId` to
// `toId`. Used when a strategy is deactivated or deleted — all its open
// positions migrate to the accumulator's care. Returns the count migrated.
export async function migrateStrategyId(fromId: string, toId: string): Promise<number> {
  if (fromId === toId) return 0
  return withLock(async () => {
    const positions = await readAll()
    let count = 0
    for (const k of Object.keys(positions)) {
      if (positions[k].strategyId === fromId) {
        positions[k].strategyId = toId
        await upsertPosition(positions[k])
        count++
      }
    }
    if (count > 0) {
      console.log(`[positions] migrated ${count} positions: ${fromId} → ${toId}`)
    }
    return count
  })
}

// Removes all positions for the current customer. Used by the reset flow.
export async function wipeAccountPositions(): Promise<number> {
  return withLock(async () => {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('customer_positions')
      .delete()
      .eq('customer_id', getCustomerId())
      .select('symbol')
    if (error) throw new Error(`[positions] wipeAccountPositions failed: ${error.message}`)
    return (data || []).length
  })
}

// Calendar-day age of a position from its firstBuyAt. Used by the handoff
// check for momentum strategies.
export function ageInCalendarDays(firstBuyAt: string): number {
  const start = new Date(firstBuyAt).getTime()
  const now = Date.now()
  return (now - start) / (1000 * 60 * 60 * 24)
}
