// Persistent S2 (Catalyst) position registry. Tracks open Catalyst BUYs
// across days, anchored to the FIRST BUY date so the 15-day → Oscillator
// handoff clock survives PM2 restarts. Pyramid-aware: subsequent BUYs add to
// `totalQty`/`remainingQty` without overwriting `firstBuyPrice` / `firstBuyAt`.
//
// Lives next to strategy1.json so the data dir is one consistent location.

import { promises as fs } from 'fs'
import * as path from 'path'

export interface S2Position {
  firstBuyAt: string          // ISO timestamp of the FIRST BUY (anchors 15-day clock + T1/T2 basis)
  firstBuyPrice: number       // T1/T2 trigger reference
  totalQty: number            // cumulative qty across pyramid BUYs
  remainingQty: number        // current open qty after any tranche sells
  tranche1At?: string | null  // ISO when tranche 1 sold (null = not yet)
  tranche1SoldQty?: number    // qty sold at tranche 1
}

type Positions = Record<string, S2Position>   // key: "ACCOUNT:SYMBOL"

const STATE_FILE_PATH = process.env.STATE_FILE_PATH || ''
const POS_FILE = STATE_FILE_PATH
  ? path.join(path.dirname(STATE_FILE_PATH), 'strategy2_positions.json')
  : ''
const useFile = !!POS_FILE
const memStore: Positions = {}

async function readPositions(): Promise<Positions> {
  if (!useFile) return JSON.parse(JSON.stringify(memStore))
  try {
    const raw = await fs.readFile(POS_FILE, 'utf8')
    return JSON.parse(raw) as Positions
  } catch {
    return {}
  }
}

async function writePositions(p: Positions): Promise<void> {
  if (!useFile) {
    Object.keys(memStore).forEach(k => delete memStore[k])
    Object.assign(memStore, p)
    return
  }
  await fs.mkdir(path.dirname(POS_FILE), { recursive: true })
  const tmp = POS_FILE + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(p, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, POS_FILE)
}

function key(account: string, symbol: string): string {
  return `${account.toUpperCase()}:${symbol.toUpperCase()}`
}

// Pyramid-aware. If a position already exists for this (account,symbol):
//   - keep firstBuyAt + firstBuyPrice (anchored to the very first entry)
//   - add qty to totalQty + remainingQty
// Otherwise create a new entry.
export async function recordStrategy2Buy(account: string, symbol: string, qty: number, price: number): Promise<void> {
  const positions = await readPositions()
  const k = key(account, symbol)
  const existing = positions[k]
  if (existing) {
    existing.totalQty += qty
    existing.remainingQty += qty
    console.log(`[strategy2pos] pyramid BUY ${k} +${qty} @ ₹${price} (totalQty now ${existing.totalQty}; first BUY anchor unchanged @ ₹${existing.firstBuyPrice})`)
  } else {
    positions[k] = {
      firstBuyAt: new Date().toISOString(),
      firstBuyPrice: price,
      totalQty: qty,
      remainingQty: qty,
      tranche1At: null,
    }
    console.log(`[strategy2pos] new position ${k} × ${qty} @ ₹${price}`)
  }
  await writePositions(positions)
}

export async function markTranche1Sold(account: string, symbol: string, soldQty: number): Promise<void> {
  const positions = await readPositions()
  const k = key(account, symbol)
  const p = positions[k]
  if (!p) return
  p.tranche1At = new Date().toISOString()
  p.tranche1SoldQty = soldQty
  p.remainingQty = Math.max(0, p.remainingQty - soldQty)
  await writePositions(positions)
}

export async function removeStrategy2Position(account: string, symbol: string): Promise<void> {
  const positions = await readPositions()
  const k = key(account, symbol)
  if (!(k in positions)) return
  delete positions[k]
  await writePositions(positions)
}

export interface S2PositionWithKey extends S2Position {
  account: string
  symbol: string
}

export async function listStrategy2Positions(): Promise<S2PositionWithKey[]> {
  const positions = await readPositions()
  const out: S2PositionWithKey[] = []
  for (const [k, v] of Object.entries(positions)) {
    const [account, symbol] = k.split(':')
    out.push({ account, symbol, ...v })
  }
  return out
}

// Calendar-day age of the position from the first BUY. Used for the
// S2 → S1 handoff trigger (default threshold 15 calendar days).
export function ageInCalendarDays(firstBuyAt: string): number {
  const start = new Date(firstBuyAt).getTime()
  const now = Date.now()
  return (now - start) / (1000 * 60 * 60 * 24)
}
