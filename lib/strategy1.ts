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

    // Branch 2: LTP >= EMA. First time? → tranche 1 (50%). Already done tranche 1? → check 1-day hold.
    if (!pos.tranche1At) {
      const qty = Math.max(1, Math.floor(pos.remainingQty * 0.5))
      if (qty > pos.remainingQty) {
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: `Invalid qty ${qty}` })
        continue
      }
      const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: qty, pricePerShare: ltp })
      if (!pre.ok) {
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty, entryPrice: pos.entryPrice, ema: todayEMA, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
        continue
      }
      const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: qty, tag: STRATEGY_1_TRANCHE1_TAG })
      if (placed.ok && placed.data?.data?.order_id) {
        markPlaced(account, symbol, 'SELL')
        pos.tranche1At = istDateKey()
        pos.tranche1SoldQty = qty
        pos.remainingQty -= qty
        await writePositions(all)
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'tranche1_sold', qty, entryPrice: pos.entryPrice, ema: todayEMA, ltp, orderId: placed.data.data.order_id })
        sendEmail('trade_executed', {
          account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: qty, price: ltp,
          orderId: placed.data.data.order_id,
          source: 'Strategy 1 — Tranche 1 (EMA recovery)',
          reason: `Sold 50% of original ${pos.entryQty} as 20-EMA (₹${todayEMA.toFixed(2)}) recovered`,
          mode: 'auto',
        }).catch(err => console.error('[strategy1] tranche1 email failed:', err))
      } else {
        const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'failed', qty, ltp, reason: errMsg })
        sendEmail('trade_failed', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: qty, price: ltp, failedAt: 'kite', reason: errMsg, mode: 'auto' }).catch(() => {})
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
    const qty = pos.remainingQty
    const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: qty, pricePerShare: ltp })
    if (!pre.ok) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty, entryPrice: pos.entryPrice, ema: todayEMA, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
      continue
    }
    const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: qty, tag: STRATEGY_1_TRANCHE2_TAG })
    if (placed.ok && placed.data?.data?.order_id) {
      markPlaced(account, symbol, 'SELL')
      delete all[key]
      await writePositions(all)
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'tranche2_sold', qty, entryPrice: pos.entryPrice, ema: todayEMA, ltp, orderId: placed.data.data.order_id })
      sendEmail('trade_executed', {
        account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: qty, price: ltp,
        orderId: placed.data.data.order_id,
        source: `Strategy 1 — Tranche 2 (EMA +${tranche2AbovePct}% hit)`,
        reason: `Closing remaining ${qty} — LTP ₹${ltp.toFixed(2)} ≥ EMA ₹${todayEMA.toFixed(2)} + ${tranche2AbovePct}% (₹${tranche2Trigger.toFixed(2)})`,
        mode: 'auto',
      }).catch(() => {})
    } else {
      const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'failed', qty, ltp, reason: errMsg })
      sendEmail('trade_failed', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: qty, price: ltp, failedAt: 'kite', reason: errMsg, mode: 'auto' }).catch(() => {})
    }
  }

  return { account, ranAt, positionsChecked: ours.length, entries }
}

export async function monitorAllAccountsStrategy1(): Promise<Strategy1MonitorResult[]> {
  const state = await getState()
  const accounts = Object.keys(state.kiteTokens)
  return Promise.all(accounts.map(monitorAccountStrategy1))
}
