// Strategy 2 — "Daily Catalyst" SELL engine.
//
// Polls today's open BUY positions and decides per-rule whether to:
//   - SELL (LTP hit +1.5% target — exit immediately, book profit)
//   - HOLD (still within targets, market still open)
//   - DELIVERY (3 PM IST reached without target hit — hand off to Strategy 1)
//
// Per spec exit rules:
//   "If stock hits +1.5% from entry → sell immediately, book profit"
//   "If stock hits +2% from entry → sell immediately if still holding"
//   "If neither hit by 3:00 PM → don't sell, take to delivery"
//
// We tag our orders 'dt-s2' (BUY) and 'dt-s2-exit' (SELL) so we only manage
// positions we placed, never the user's manual trades.

import strategyCfg from '@/config/strategy.json'
import {
  resolveAccountCreds, getPositions, getOrders, getQuotes, placeKiteOrder,
  type KitePosition, type KiteOrder,
} from './kite'
import { runPreflight, markPlaced } from './preflight'
import { sendEmail } from './email'
import { getAccountList } from './accounts'

export const STRATEGY_2_BUY_TAG = 'dt-s2'
export const STRATEGY_2_SELL_TAG = 'dt-s2-exit'

const T1_TRIGGER = 1 + strategyCfg.targets.intraday_t1_pct / 100  // 1.015
const DELIVERY_HOUR_IST = 15                                       // 15:00 IST — past this, no more SELL attempts

export type MonitorAction = 'sold' | 'sold_failed' | 'held' | 'delivery' | 'skipped'

export interface MonitorEntry {
  account: string
  accountDisplayName?: string
  symbol: string
  action: MonitorAction
  quantity?: number
  entryPrice?: number
  ltp?: number
  gainPct?: number
  orderId?: string
  reason?: string
}

export interface MonitorResult {
  account: string
  ranAt: string  // ISO timestamp
  positionsChecked: number
  entries: MonitorEntry[]
}

function istHour(): number {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return ist.getHours()
}

// For each account's open day positions whose original BUY came from us (tag === dt-s2),
// poll LTP and decide SELL / HOLD / DELIVERY.
export async function monitorAccount(account: string): Promise<MonitorResult> {
  const ranAt = new Date().toISOString()
  const displayName = getAccountList().find(a => a.name === account)?.displayName
  const entries: MonitorEntry[] = []

  const creds = await resolveAccountCreds(account)
  if (!creds.ok) {
    return { account, ranAt, positionsChecked: 0, entries: [{ account, accountDisplayName: displayName, symbol: '—', action: 'skipped', reason: creds.error }] }
  }

  // 1. Find today's BUYs we placed (tag === dt-s2) that are still open in the day book.
  const orders = await getOrders(creds)
  const ourTodayBuys = orders.filter(o =>
    o.tag === STRATEGY_2_BUY_TAG &&
    o.transaction_type === 'BUY' &&
    o.status === 'COMPLETE'
  )
  // Symbol → entry price (use first fill — most accurate for sizing)
  const entryBySymbol = new Map<string, number>()
  for (const o of ourTodayBuys) {
    const sym = o.tradingsymbol.toUpperCase()
    if (!entryBySymbol.has(sym)) entryBySymbol.set(sym, Number(o.average_price) || 0)
  }
  if (entryBySymbol.size === 0) {
    return { account, ranAt, positionsChecked: 0, entries: [] }
  }

  // 2. Get positions to know what's still held intraday.
  const { day, net } = await getPositions(creds)
  const positionBySymbol = new Map<string, KitePosition>()
  for (const p of [...day, ...net]) {
    if (p.quantity > 0) positionBySymbol.set(p.tradingsymbol.toUpperCase(), p)
  }

  // 3. Quote all symbols in one batch.
  const symbols = Array.from(entryBySymbol.keys())
  const quotes = await getQuotes(creds, symbols)

  // 4. Decide per symbol.
  const pastDeliveryCutoff = istHour() >= DELIVERY_HOUR_IST

  for (const symbol of symbols) {
    const entry = entryBySymbol.get(symbol)!
    const pos = positionBySymbol.get(symbol)
    const qty = pos?.quantity ?? 0
    const quote = quotes[`NSE:${symbol}`]
    const ltp = quote?.last_price

    if (qty <= 0) {
      // Already sold (either by us in a prior tick, or by the user). Nothing to do.
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', entryPrice: entry, reason: 'No open quantity — already exited' })
      continue
    }

    if (ltp === undefined) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', quantity: qty, entryPrice: entry, reason: 'No LTP from Kite' })
      continue
    }

    const gainPct = ((ltp - entry) / entry) * 100
    const targetHit = ltp >= entry * T1_TRIGGER

    if (targetHit) {
      // Fire SELL — re-run preflight first so we honor market/quota/idempotency gates.
      const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: qty, pricePerShare: ltp })
      if (!pre.ok) {
        entries.push({
          account, accountDisplayName: displayName, symbol,
          action: 'skipped', quantity: qty, entryPrice: entry, ltp, gainPct,
          reason: `Preflight ${pre.gate}: ${pre.reason}`,
        })
        continue
      }
      const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: qty, tag: STRATEGY_2_SELL_TAG })
      if (placed.ok && placed.data?.data?.order_id) {
        markPlaced(account, symbol, 'SELL')
        entries.push({
          account, accountDisplayName: displayName, symbol,
          action: 'sold', quantity: qty, entryPrice: entry, ltp, gainPct,
          orderId: placed.data.data.order_id,
        })
        // Notification — fire-and-forget.
        sendEmail('trade_executed', {
          account,
          accountDisplayName: displayName,
          symbol,
          side: 'SELL',
          quantity: qty,
          price: ltp,
          orderId: placed.data.data.order_id,
          source: `Auto-exit @ +${gainPct.toFixed(2)}%`,
          reason: `Strategy 2 target hit (≥+${strategyCfg.targets.intraday_t1_pct}%)`,
          mode: 'auto',
        }).catch(err => console.error('[strategy2] sold-email failed:', err))
      } else {
        const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
        entries.push({
          account, accountDisplayName: displayName, symbol,
          action: 'sold_failed', quantity: qty, entryPrice: entry, ltp, gainPct,
          reason: errMsg,
        })
        sendEmail('trade_failed', {
          account, accountDisplayName: displayName,
          symbol, side: 'SELL', quantity: qty, price: ltp,
          failedAt: 'kite', reason: errMsg, mode: 'auto',
        }).catch(err => console.error('[strategy2] sold-failed-email failed:', err))
      }
      continue
    }

    if (pastDeliveryCutoff) {
      // 3 PM IST cutoff reached — leave as delivery. Strategy 1 (EMA-based, days/weeks)
      // takes over from tomorrow. No SELL, no email per spec ("don't panic-sell").
      entries.push({
        account, accountDisplayName: displayName, symbol,
        action: 'delivery', quantity: qty, entryPrice: entry, ltp, gainPct,
        reason: `Past 15:00 IST without hitting +${strategyCfg.targets.intraday_t1_pct}% — held for delivery`,
      })
      continue
    }

    // Default: still in monitoring window, target not yet hit.
    entries.push({
      account, accountDisplayName: displayName, symbol,
      action: 'held', quantity: qty, entryPrice: entry, ltp, gainPct,
      reason: `Waiting for +${strategyCfg.targets.intraday_t1_pct}% — currently ${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%`,
    })
  }

  return { account, ranAt, positionsChecked: symbols.length, entries }
}

// Run the monitor across every connected account. Used by the cron tick.
export async function monitorAllConnected(): Promise<MonitorResult[]> {
  const { getState } = await import('./state')
  const state = await getState()
  const accounts = Object.keys(state.kiteTokens)
  return Promise.all(accounts.map(monitorAccount))
}
