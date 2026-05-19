// Strategy 1 — "The Oscillator" SELL engine.
//
// Two-tranche exit per spec:
//   - When LTP recovers to the 20-day EMA → sell 50% (tag dt-s1-t1)
//   - When the stock then holds ABOVE the 20-day EMA for one full day
//     (yesterday's close ≥ yesterday's EMA) → sell remaining 50% (tag dt-s1-t2)
//
// Positions are tracked in a JSON file alongside state.json so the monitor
// only manages OUR Strategy 1 BUYs — never the user's pre-existing holdings.

import { promises as fs } from 'fs'
import * as path from 'path'
import strategyCfg from '@/config/strategy.json'
import { getState } from './state'
import { getAccountList } from './accounts'
import {
  resolveAccountCreds, getQuotes, getHistoricalCandles, placeKiteOrder,
  type KiteCreds,
} from './kite'
import { getInstrumentToken } from './instruments'
import { computeEMA } from './ema'
import { runPreflight, markPlaced } from './preflight'
import { sendEmail } from './email'
import { appendJournal, istDateString } from './journal'

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
// Overwrites any existing entry for this (account, symbol).
export async function recordStrategy1Buy(account: string, symbol: string, qty: number, entryPrice: number): Promise<void> {
  const positions = await readPositions()
  const key = `${account}:${symbol.toUpperCase()}`
  positions[key] = {
    boughtAt: istDateKey(),
    entryQty: qty,
    remainingQty: qty,
    entryPrice,
    tranche1At: null,
  }
  await writePositions(positions)
  console.log(`[strategy1] recorded BUY ${key} × ${qty} @ ₹${entryPrice}`)
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

  const from = istDateKey(-60)
  const to = istDateKey(-1)
  const emaPeriod = strategyCfg.ema?.period ?? 20

  for (const [key, pos] of ours) {
    const symbol = key.split(':')[1]
    const ltp = quotes[`NSE:${symbol}`]?.last_price
    if (ltp === undefined) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'No LTP from Kite' })
      continue
    }

    // Need instrument token + historical
    let token: number | null = null
    try { token = await getInstrumentToken(creds, symbol) } catch { /* ignore */ }
    if (!token) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'No instrument token' })
      continue
    }

    let candles
    try {
      candles = await getHistoricalCandles(creds, token, from, to, 'day')
    } catch (err) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: `Historical: ${String(err).slice(0, 80)}` })
      continue
    }
    if (candles.length < emaPeriod + 2) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'Insufficient candles' })
      continue
    }
    const closes = candles.map(c => c.close)
    const emas = computeEMA(closes, emaPeriod)
    const todayEMA = emas[emas.length - 1]      // EMA as of yesterday's close (latest closed bar)

    if (!todayEMA || isNaN(todayEMA)) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'EMA NaN' })
      continue
    }

    const tranche2AbovePct = strategyCfg.targets?.strategy1_tranche2_above_ema_pct ?? 3
    const tranche2Trigger = todayEMA * (1 + tranche2AbovePct / 100)

    // ────── DECISION ──────
    // Branch 1: LTP still below EMA → hold, wait
    if (ltp < todayEMA) {
      entries.push({
        account, accountDisplayName: displayName, symbol, action: 'held',
        qty: pos.remainingQty, entryPrice: pos.entryPrice, ema: todayEMA, ltp,
        reason: `Below 20-EMA (₹${todayEMA.toFixed(2)}) — waiting for recovery`,
      })
      continue
    }

    // Branch 2: LTP >= EMA. First time? → tranche 1 (50%). Already done tranche 1? → check EMA + 3%.
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
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: pos.entryPrice, ema: todayEMA, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
        }
        continue
      }
      const actualQty = pre.adjustedQty ?? intentQty
      const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE1_TAG })
      if (placed.ok && placed.data?.data?.order_id) {
        await markPlaced(account, symbol, 'SELL')
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
          strategy: 'oscillator',
          orderIdSell: placed.data.data.order_id,
          notes: `Tranche 1 (50% at EMA ₹${todayEMA.toFixed(2)})`,
        }).catch(err => console.error('[strategy1] journal write failed:', err))
        entries.push({
          account, accountDisplayName: displayName, symbol, action: 'tranche1_sold',
          qty: actualQty, entryPrice: pos.entryPrice, ema: todayEMA, ltp,
          orderId: placed.data.data.order_id,
          reason: adjusted ? `Adjusted ${intentQty} → ${actualQty} (partial manual close); position cleared` : undefined,
        })
        sendEmail('trade_executed', {
          account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp,
          orderId: placed.data.data.order_id,
          source: adjusted
            ? `Strategy 1 — Final exit (clamped from ${intentQty})`
            : 'Strategy 1 — Tranche 1 (EMA recovery)',
          reason: adjusted
            ? `Held qty (${actualQty}) less than tranche-1 intent (${intentQty}) — sold remaining and closed position`
            : `Sold 50% of original ${pos.entryQty} as 20-EMA (₹${todayEMA.toFixed(2)}) recovered`,
          mode: 'auto',
        }).catch(err => console.error('[strategy1] tranche1 email failed:', err))
      } else {
        const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'failed', qty: actualQty, ltp, reason: errMsg })
        sendEmail('trade_failed', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp, failedAt: 'kite', reason: errMsg, mode: 'auto' }).catch(() => {})
      }
      continue
    }

    // Tranche 1 already done. Tranche 2 fires when LTP reaches EMA + 3% (no time stop).
    if (ltp < tranche2Trigger) {
      entries.push({
        account, accountDisplayName: displayName, symbol, action: 'held',
        qty: pos.remainingQty, entryPrice: pos.entryPrice, ema: todayEMA, ltp,
        reason: `Tranche 1 sold; waiting for ₹${tranche2Trigger.toFixed(2)} (EMA +${tranche2AbovePct}%)`,
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
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: pos.entryPrice, ema: todayEMA, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
      }
      continue
    }
    const actualQty = pre.adjustedQty ?? intentQty
    const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE2_TAG })
    if (placed.ok && placed.data?.data?.order_id) {
      await markPlaced(account, symbol, 'SELL')
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
        strategy: 'oscillator',
        orderIdSell: placed.data.data.order_id,
        notes: `Tranche 2 (EMA + ${tranche2AbovePct}%)`,
      }).catch(err => console.error('[strategy1] journal write failed:', err))
      entries.push({
        account, accountDisplayName: displayName, symbol, action: 'tranche2_sold',
        qty: actualQty, entryPrice: pos.entryPrice, ema: todayEMA, ltp,
        orderId: placed.data.data.order_id,
        reason: adjusted ? `Adjusted ${intentQty} → ${actualQty} (partial manual close)` : undefined,
      })
      sendEmail('trade_executed', {
        account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp,
        orderId: placed.data.data.order_id,
        source: `Strategy 1 — Tranche 2 (EMA +${tranche2AbovePct}% hit)`,
        reason: adjusted
          ? `Closing remaining ${actualQty} (clamped from ${intentQty} — partial manual close)`
          : `Closing remaining ${actualQty} — LTP ₹${ltp.toFixed(2)} ≥ EMA ₹${todayEMA.toFixed(2)} + ${tranche2AbovePct}% (₹${tranche2Trigger.toFixed(2)})`,
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
