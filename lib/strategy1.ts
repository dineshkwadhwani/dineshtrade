// Strategy 1 — "The Oscillator" SELL engine.
//
// Unified two-tranche exit (post Phase 5 — was EMA-based, now first-BUY-based):
//   - Tranche 1: LTP ≥ firstBuyPrice × (1 + oscillator.exits.t1Pct/100) → sell 50%
//   - Tranche 2: LTP ≥ firstBuyPrice × (1 + oscillator.exits.t2Pct/100) → sell rest
//   - Jump past T2 before T1 → sell entire qty at T2
//
// "First BUY" is `pos.entryPrice` from data/strategy1.json — the price at which
// the original entry was recorded. Pyramid BUYs add qty to remainingQty without
// changing entryPrice, so the exit basis stays anchored to the first entry.
//
// Positions are tracked in a JSON file alongside state.json so the monitor
// only manages OUR Strategy 1 BUYs — never the user's pre-existing holdings.

import { promises as fs } from 'fs'
import * as path from 'path'
import { getState } from './state'
import { getAccountList } from './accounts'
import {
  resolveAccountCreds, getQuotes, placeKiteOrder,
  type KiteCreds,
} from './kite'
import { runPreflight, markPlaced } from './preflight'
import { sendEmail } from './email'
import { appendJournal, istDateString } from './journal'
import { getStrategyById } from './strategyConfig'

export const STRATEGY_1_BUY_TAG = 'dt-s1'
export const STRATEGY_1_TRANCHE1_TAG = 'dt-s1-t1'
export const STRATEGY_1_TRANCHE2_TAG = 'dt-s1-t2'

interface Position {
  boughtAt: string          // YYYY-MM-DD IST
  entryQty: number
  remainingQty: number
  entryPrice: number
  tranche1At?: string | null
  tranche1SoldQty?: number
}

type Positions = Record<string, Position>   // key: "ACCOUNT:SYMBOL"

const STATE_FILE_PATH = process.env.STATE_FILE_PATH || ''
const POS_FILE = STATE_FILE_PATH
  ? path.join(path.dirname(STATE_FILE_PATH), 'strategy1.json')
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

function istDateKey(daysOffset = 0): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  ist.setDate(ist.getDate() + daysOffset)
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`
}

// Called after a successful Strategy 1 BUY (cron auto-buy + manual Execute path).
// Pyramid-aware: if a position already exists for (account, symbol), this is a
// pyramid BUY — add qty to entryQty + remainingQty but DO NOT change the
// entryPrice anchor (T1/T2 exits stay tied to the original first BUY).
// Only a fresh entry (post-sellout) resets entryPrice + boughtAt.
export async function recordStrategy1Buy(account: string, symbol: string, qty: number, entryPrice: number): Promise<void> {
  const positions = await readPositions()
  const key = `${account}:${symbol.toUpperCase()}`
  const existing = positions[key]
  if (existing) {
    existing.entryQty += qty
    existing.remainingQty += qty
    console.log(`[strategy1] pyramid BUY ${key} +${qty} (totalQty now ${existing.entryQty}; entryPrice anchor unchanged @ ₹${existing.entryPrice})`)
  } else {
    positions[key] = {
      boughtAt: istDateKey(),
      entryQty: qty,
      remainingQty: qty,
      entryPrice,
      tranche1At: null,
    }
    console.log(`[strategy1] new position ${key} × ${qty} @ ₹${entryPrice}`)
  }
  await writePositions(positions)
}

// Idempotent — adds a position to Strategy 1 tracking only if not already present.
// Used by the Strategy 2 → Strategy 1 delivery handoff at 15:00 IST so unexited
// dt-s2 positions get managed by EMA-based exits from the next trading day.
// Returns true if a new entry was created, false if one already existed.
export async function ensureStrategy1Tracking(
  account: string, symbol: string, qty: number, entryPrice: number,
  source: string = 'manual',
): Promise<boolean> {
  const positions = await readPositions()
  const key = `${account}:${symbol.toUpperCase()}`
  if (positions[key]) return false
  positions[key] = {
    boughtAt: istDateKey(),
    entryQty: qty,
    remainingQty: qty,
    entryPrice,
    tranche1At: null,
  }
  await writePositions(positions)
  console.log(`[strategy1] now tracking ${key} × ${qty} @ ₹${entryPrice} (source: ${source})`)
  return true
}

// Used by the Holdings/Engine UI later to show "this is a Strategy 1 position".
export async function listStrategy1Positions(): Promise<Array<Position & { account: string; symbol: string }>> {
  const positions = await readPositions()
  return Object.entries(positions).map(([key, p]) => {
    const [account, symbol] = key.split(':')
    return { account, symbol, ...p }
  })
}

export type Strategy1Action = 'tranche1_sold' | 'tranche2_sold' | 'failed' | 'held' | 'skipped'

export interface Strategy1Entry {
  account: string
  accountDisplayName?: string
  symbol: string
  action: Strategy1Action
  qty?: number
  entryPrice?: number
  ema?: number
  ltp?: number
  orderId?: string
  reason?: string
}

export interface Strategy1MonitorResult {
  account: string
  ranAt: string
  positionsChecked: number
  entries: Strategy1Entry[]
}

export async function monitorAccountStrategy1(account: string): Promise<Strategy1MonitorResult> {
  const ranAt = new Date().toISOString()
  const displayName = getAccountList().find(a => a.name === account)?.displayName
  const entries: Strategy1Entry[] = []

  const cr = await resolveAccountCreds(account)
  if (!cr.ok) {
    return { account, ranAt, positionsChecked: 0, entries: [{ account, accountDisplayName: displayName, symbol: '—', action: 'skipped', reason: cr.error }] }
  }
  const creds: KiteCreds = { apiKey: cr.apiKey, accessToken: cr.accessToken }

  const all = await readPositions()
  const ours = Object.entries(all).filter(([k]) => k.startsWith(`${account}:`))
  if (ours.length === 0) return { account, ranAt, positionsChecked: 0, entries: [] }

  // Batch quote for all our held symbols
  const symbols = ours.map(([k]) => k.split(':')[1])
  let quotes: Record<string, { last_price: number }> = {}
  try {
    quotes = await getQuotes(creds, symbols) as any
  } catch (err) {
    return { account, ranAt, positionsChecked: ours.length, entries: [{ account, accountDisplayName: displayName, symbol: '—', action: 'skipped', reason: `Quote fetch failed: ${String(err).slice(0, 100)}` }] }
  }

  // Exit percentages come from the live Oscillator strategy config (so an edit
  // in Settings takes effect on the next monitor tick without a restart).
  const oscillator = getStrategyById('accumulator')
  const t1Pct = oscillator?.exits?.t1Pct ?? 5.0
  const t2Pct = oscillator?.exits?.t2Pct ?? 8.0

  for (const [key, pos] of ours) {
    const symbol = key.split(':')[1]
    const ltp = quotes[`NSE:${symbol}`]?.last_price
    if (ltp === undefined) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'No LTP from Kite' })
      continue
    }

    const t1Trigger = pos.entryPrice * (1 + t1Pct / 100)
    const t2Trigger = pos.entryPrice * (1 + t2Pct / 100)
    const gainPct = ((ltp - pos.entryPrice) / pos.entryPrice) * 100

    // ────── DECISION ──────
    // If LTP jumped past T2 before T1 ever fired → sell entire position at T2
    if (!pos.tranche1At && ltp >= t2Trigger) {
      const intentQty = pos.remainingQty
      const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: intentQty, pricePerShare: ltp })
      if (!pre.ok) {
        if (pre.gate === 'noShort') {
          delete all[key]
          await writePositions(all)
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'Position no longer held in Kite — tracking cleared' })
        } else {
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: pos.entryPrice, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
        }
        continue
      }
      const actualQty = pre.adjustedQty ?? intentQty
      const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE2_TAG })
      if (placed.ok && placed.data?.data?.order_id) {
        await markPlaced(account, symbol, 'SELL', { price: ltp, manual: false })
        delete all[key]
        await writePositions(all)
        const pnlR = (ltp - pos.entryPrice) * actualQty
        appendJournal({
          type: 'trade', date: istDateString(),
          account, symbol, qty: actualQty,
          entryPrice: pos.entryPrice, entryTime: pos.boughtAt,
          exitPrice: ltp, exitTime: new Date().toISOString(),
          pnlRupees: pnlR, pnlPct: gainPct,
          dayHighAfterEntry: ltp, dayLowAfterEntry: ltp, leftOnTable: 0,
          verdict: 'correct_exit', strategy: 'accumulator',
          orderIdSell: placed.data.data.order_id,
          notes: `Tranche-skip — LTP ≥ T2 ₹${t2Trigger.toFixed(2)} before T1 fired; sold entire qty`,
        }).catch(err => console.error('[strategy1] journal write failed:', err))
        entries.push({
          account, accountDisplayName: displayName, symbol, action: 'tranche2_sold',
          qty: actualQty, entryPrice: pos.entryPrice, ltp,
          orderId: placed.data.data.order_id,
          reason: `LTP ₹${ltp.toFixed(2)} ≥ T2 ₹${t2Trigger.toFixed(2)} before T1 — sold entire ${actualQty}`,
        })
        sendEmail('trade_executed', {
          account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp,
          orderId: placed.data.data.order_id,
          source: `Strategy 1 — Full exit (skipped past T1)`,
          reason: `LTP hit T2 ₹${t2Trigger.toFixed(2)} before T1 — closing entire position`,
          mode: 'auto',
        }).catch(() => {})
      } else {
        const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'failed', qty: actualQty, ltp, reason: errMsg })
        sendEmail('trade_failed', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp, failedAt: 'kite', reason: errMsg, mode: 'auto' }).catch(() => {})
      }
      continue
    }

    // Hold if below T1 (tranche 1 not yet fired) or below T2 (tranche 1 done)
    if (!pos.tranche1At && ltp < t1Trigger) {
      entries.push({
        account, accountDisplayName: displayName, symbol, action: 'held',
        qty: pos.remainingQty, entryPrice: pos.entryPrice, ltp,
        reason: `Waiting for T1 ₹${t1Trigger.toFixed(2)} (entry +${t1Pct}%) — currently ₹${ltp.toFixed(2)} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%)`,
      })
      continue
    }

    // Tranche 1 fires (LTP ≥ T1 but < T2 OR T2 was just-too-high)
    if (!pos.tranche1At) {
      const intentQty = Math.max(1, Math.floor(pos.remainingQty * 0.5))
      if (intentQty > pos.remainingQty) {
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: `Invalid qty ${intentQty}` })
        continue
      }
      const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: intentQty, pricePerShare: ltp })
      if (!pre.ok) {
        if (pre.gate === 'noShort') {
          // Position fully closed manually in Kite — clean up our tracking
          delete all[key]
          await writePositions(all)
          entries.push({
            account, accountDisplayName: displayName, symbol, action: 'skipped',
            reason: 'Position no longer held in Kite — Strategy 1 tracking cleared',
          })
        } else {
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: pos.entryPrice, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
        }
        continue
      }
      const actualQty = pre.adjustedQty ?? intentQty
      const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE1_TAG })
      if (placed.ok && placed.data?.data?.order_id) {
        await markPlaced(account, symbol, 'SELL', { price: ltp, manual: false })
        const adjusted = pre.adjustedQty !== undefined
        if (adjusted) {
          // Held less than intended 50% — selling what's there closes the position
          delete all[key]
        } else {
          pos.tranche1At = istDateKey()
          pos.tranche1SoldQty = actualQty
          pos.remainingQty -= actualQty
        }
        await writePositions(all)
        // Journal — partial exit
        const pnlR = (ltp - pos.entryPrice) * actualQty
        const pnlP = ((ltp - pos.entryPrice) / pos.entryPrice) * 100
        appendJournal({
          type: 'trade', date: istDateString(),
          account, symbol, qty: actualQty,
          entryPrice: pos.entryPrice, entryTime: pos.boughtAt,
          exitPrice: ltp, exitTime: new Date().toISOString(),
          pnlRupees: pnlR, pnlPct: pnlP,
          dayHighAfterEntry: ltp, dayLowAfterEntry: ltp,
          leftOnTable: 0,
          verdict: 'correct_exit',
          strategy: 'accumulator',
          orderIdSell: placed.data.data.order_id,
          notes: `Tranche 1 (50% at T1 ₹${t1Trigger.toFixed(2)} = entry +${t1Pct}%)`,
        }).catch(err => console.error('[strategy1] journal write failed:', err))
        entries.push({
          account, accountDisplayName: displayName, symbol, action: 'tranche1_sold',
          qty: actualQty, entryPrice: pos.entryPrice, ltp,
          orderId: placed.data.data.order_id,
          reason: adjusted ? `Adjusted ${intentQty} → ${actualQty} (partial manual close); position cleared` : undefined,
        })
        sendEmail('trade_executed', {
          account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp,
          orderId: placed.data.data.order_id,
          source: adjusted
            ? `Strategy 1 — Final exit (clamped from ${intentQty})`
            : `Strategy 1 — Tranche 1 (entry +${t1Pct}%)`,
          reason: adjusted
            ? `Held qty (${actualQty}) less than tranche-1 intent (${intentQty}) — sold remaining and closed position`
            : `Sold 50% of original ${pos.entryQty} as LTP reached T1 ₹${t1Trigger.toFixed(2)} (entry ₹${pos.entryPrice} + ${t1Pct}%)`,
          mode: 'auto',
        }).catch(err => console.error('[strategy1] tranche1 email failed:', err))
      } else {
        const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'failed', qty: actualQty, ltp, reason: errMsg })
        sendEmail('trade_failed', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp, failedAt: 'kite', reason: errMsg, mode: 'auto' }).catch(() => {})
      }
      continue
    }

    // Tranche 1 already done. Tranche 2 fires when LTP reaches firstBuy × (1 + t2Pct/100).
    if (ltp < t2Trigger) {
      entries.push({
        account, accountDisplayName: displayName, symbol, action: 'held',
        qty: pos.remainingQty, entryPrice: pos.entryPrice, ltp,
        reason: `Tranche 1 sold; waiting for T2 ₹${t2Trigger.toFixed(2)} (entry +${t2Pct}%) — currently ${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%`,
      })
      continue
    }

    // Tranche 2 fires — sell the rest
    const intentQty = pos.remainingQty
    const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: intentQty, pricePerShare: ltp })
    if (!pre.ok) {
      if (pre.gate === 'noShort') {
        // Position fully closed manually — clean up
        delete all[key]
        await writePositions(all)
        entries.push({
          account, accountDisplayName: displayName, symbol, action: 'skipped',
          reason: 'Position no longer held in Kite — Strategy 1 tracking cleared',
        })
      } else {
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: pos.entryPrice, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
      }
      continue
    }
    const actualQty = pre.adjustedQty ?? intentQty
    const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE2_TAG })
    if (placed.ok && placed.data?.data?.order_id) {
      await markPlaced(account, symbol, 'SELL', { price: ltp, manual: false })
      delete all[key]
      await writePositions(all)
      const adjusted = pre.adjustedQty !== undefined
      // Journal — final exit
      const pnlR2 = (ltp - pos.entryPrice) * actualQty
      const pnlP2 = ((ltp - pos.entryPrice) / pos.entryPrice) * 100
      appendJournal({
        type: 'trade', date: istDateString(),
        account, symbol, qty: actualQty,
        entryPrice: pos.entryPrice, entryTime: pos.boughtAt,
        exitPrice: ltp, exitTime: new Date().toISOString(),
        pnlRupees: pnlR2, pnlPct: pnlP2,
        dayHighAfterEntry: ltp, dayLowAfterEntry: ltp,
        leftOnTable: 0,
        verdict: 'correct_exit',
        strategy: 'accumulator',
        orderIdSell: placed.data.data.order_id,
        notes: `Tranche 2 (entry +${t2Pct}% = ₹${t2Trigger.toFixed(2)})`,
      }).catch(err => console.error('[strategy1] journal write failed:', err))
      entries.push({
        account, accountDisplayName: displayName, symbol, action: 'tranche2_sold',
        qty: actualQty, entryPrice: pos.entryPrice, ltp,
        orderId: placed.data.data.order_id,
        reason: adjusted ? `Adjusted ${intentQty} → ${actualQty} (partial manual close)` : undefined,
      })
      sendEmail('trade_executed', {
        account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp,
        orderId: placed.data.data.order_id,
        source: `Strategy 1 — Tranche 2 (entry +${t2Pct}% hit)`,
        reason: adjusted
          ? `Closing remaining ${actualQty} (clamped from ${intentQty} — partial manual close)`
          : `Closing remaining ${actualQty} — LTP ₹${ltp.toFixed(2)} ≥ T2 ₹${t2Trigger.toFixed(2)} (entry ₹${pos.entryPrice} + ${t2Pct}%)`,
        mode: 'auto',
      }).catch(() => {})
    } else {
      const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'failed', qty: actualQty, ltp, reason: errMsg })
      sendEmail('trade_failed', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp, failedAt: 'kite', reason: errMsg, mode: 'auto' }).catch(() => {})
    }
  }

  return { account, ranAt, positionsChecked: ours.length, entries }
}

export async function monitorAllAccountsStrategy1(): Promise<Strategy1MonitorResult[]> {
  const state = await getState()
  const accounts = Object.keys(state.kiteTokens)
  return Promise.all(accounts.map(monitorAccountStrategy1))
}
