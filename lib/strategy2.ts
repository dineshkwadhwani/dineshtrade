// Strategy 2 — "Daily Catalyst" SELL engine.
//
// Per the unified exit model:
//   - T1 trigger = firstBuyPrice × (1 + catalyst.exits.t1Pct/100) → SELL 50%
//   - T2 trigger = firstBuyPrice × (1 + catalyst.exits.t2Pct/100) → SELL remaining
//   - If LTP jumps past T2 before T1 ever fires → SELL ENTIRE qty at T2
//   - If 15 calendar days pass from firstBuyAt without full exit → HAND OFF
//     to Strategy 1 (Oscillator). Entry price preserved; Oscillator's
//     percentages then take over.
//
// Positions are tracked in data/strategy2_positions.json so first-BUY anchor
// and the 15-day clock survive PM2 restarts and span days. Pyramid BUYs add
// to the same position without resetting the anchor.
//
// Order tags: 'dt-s2' (BUY), 'dt-s2-exit' (SELL).

import {
  resolveAccountCreds, getPositions, getHoldings, getOrders, getQuotes, placeKiteOrder, getHistoricalCandles,
  type KitePosition, type KiteOrder,
} from './kite'
import { runPreflight, markPlaced } from './preflight'
import { sendEmail } from './email'
import { getAccountList } from './accounts'
import { ensureStrategy1Tracking } from './strategy1'
import { appendJournal, journalOrder, istDateString, istHHMM, classifyVerdict, readJournalRange } from './journal'
import { getStrategyById, getStrategies } from './strategyConfig'
import {
  listStrategy2Positions, removeStrategy2Position, markTranche1Sold,
  recordStrategy2Buy, ageInCalendarDays,
} from './strategy2Positions'
import { recordBuy as recordPositionBuy } from './positions'
import { getInstrumentTokens } from './instruments'

export const STRATEGY_2_BUY_TAG = 'dt-s2'
export const STRATEGY_2_SELL_TAG = 'dt-s2-exit'

const HANDOFF_DAYS_DEFAULT = 15   // calendar days from firstBuyAt

function currentIst(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

function formatKiteDateTime(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function latestCompletedFiveMinuteRange(): { from: string; to: string } {
  const probe = new Date(currentIst().getTime() - 60_000)
  probe.setSeconds(0, 0)
  probe.setMinutes(probe.getMinutes() - (probe.getMinutes() % 5))
  const from = new Date(probe.getTime() - 10 * 60_000)
  return {
    from: formatKiteDateTime(from),
    to: formatKiteDateTime(probe),
  }
}

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

// Reads the persistent S2 position store + live Kite quotes, evaluates each
// open position against T1 / T2 (first-BUY-based) and the 15-day handoff
// timer. Pyramid-aware via the store's totalQty/remainingQty fields.
export async function monitorAccount(account: string): Promise<MonitorResult> {
  const ranAt = new Date().toISOString()
  const displayName = getAccountList().find(a => a.name === account)?.displayName
  const entries: MonitorEntry[] = []

  const creds = await resolveAccountCreds(account)
  if (!creds.ok) {
    return { account, ranAt, positionsChecked: 0, entries: [{ account, accountDisplayName: displayName, symbol: '—', action: 'skipped', reason: creds.error }] }
  }

  // Per-position strategy config — looked up inside the loop now so each
  // position uses ITS OWN strategy's exits + handoff window. Default fallbacks
  // (1.5 / 2.0 / 15d) preserve catalyst-equivalent behavior for legacy rows.

  // Build liveQtyBySymbol FIRST (holdings + positions) so all seeding steps
  // can check whether a symbol is still actually held in Kite before reseeding.
  // Holdings are essential — CNC positions carried forward from prior days move
  // out of /portfolio/positions and into /portfolio/holdings overnight.
  const [[{ day, net }, holdings], orders] = await Promise.all([
    Promise.all([getPositions(creds), getHoldings(creds)]),
    getOrders(creds),
  ])
  const liveQtyBySymbol = new Map<string, number>()
  for (const p of [...day, ...net]) {
    const sym = p.tradingsymbol.toUpperCase()
    liveQtyBySymbol.set(sym, (liveQtyBySymbol.get(sym) || 0) + (p.quantity || 0))
  }
  for (const h of holdings) {
    const sym = h.tradingsymbol.toUpperCase()
    liveQtyBySymbol.set(sym, (liveQtyBySymbol.get(sym) || 0) + (h.quantity || 0))
  }

  // Seed 1: today's Kite dt-s2 BUYs (legacy tag — keeps backward compatibility).
  const todaysS2Buys = orders.filter(o => o.tag === STRATEGY_2_BUY_TAG && o.transaction_type === 'BUY' && o.status === 'COMPLETE')
  const allKnown = await listStrategy2Positions()
  const knownKeys = new Set(allKnown.filter(p => p.account.toUpperCase() === account.toUpperCase()).map(p => p.symbol.toUpperCase()))
  for (const o of todaysS2Buys) {
    const sym = o.tradingsymbol.toUpperCase()
    if (!knownKeys.has(sym) && (liveQtyBySymbol.get(sym) ?? 0) > 0) {
      const px = Number(o.average_price) || 0
      const qty = Number(o.filled_quantity || o.quantity) || 0
      if (px > 0 && qty > 0) {
        await recordStrategy2Buy(account, sym, qty, px)
        console.log(`[strategy2 monitor] seeded missing position ${account}:${sym} from today's Kite order`)
      }
    }
  }

  // Seed 2: journal BUYs — the journal is the permanent record of every auto-BUY
  // with its strategy tag. This catches positions bought on prior days that fell
  // out of the store (e.g. OOS after an overnight Kite positions→holdings move).
  // Uses the earliest BUY record per symbol as the firstBuyPrice anchor, and the
  // live Kite qty (actual shares still held) as remainingQty.
  {
    const momentumIds = new Set(getStrategies().filter(s => s.type === 'momentum').map(s => s.id))
    const lookbackYmd = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const jRecords = await readJournalRange(lookbackYmd, istDateString()).catch(() => [])
    // Earliest auto-BUY per symbol for this account on a momentum strategy
    const anchorBySymbol = new Map<string, { strategyId: string; price: number; ts: string }>()
    for (const r of jRecords) {
      if (r.type !== 'order' || r.side !== 'BUY' || r.source !== 'auto') continue
      if (r.account.toUpperCase() !== account.toUpperCase()) continue
      if (!r.strategyId || !momentumIds.has(r.strategyId)) continue
      const sym = r.symbol.toUpperCase()
      const prev = anchorBySymbol.get(sym)
      if (!prev || r.ts < prev.ts) anchorBySymbol.set(sym, { strategyId: r.strategyId, price: r.price, ts: r.ts })
    }
    // Re-read after Seed 1 to avoid double-seeding
    const afterSeed1 = await listStrategy2Positions()
    const knownAfter = new Set(afterSeed1.filter(p => p.account.toUpperCase() === account.toUpperCase()).map(p => p.symbol.toUpperCase()))
    for (const [sym, anchor] of Array.from(anchorBySymbol)) {
      if (knownAfter.has(sym)) continue
      const liveQty = liveQtyBySymbol.get(sym) ?? 0
      if (liveQty <= 0) continue
      await recordPositionBuy(anchor.strategyId, account, sym, liveQty, anchor.price)
      console.log(`[strategy2 monitor] reseeded ${account}:${sym} × ${liveQty} @ ₹${anchor.price} from journal (${anchor.strategyId})`)
    }
  }

  // Per-account positions from the store (after all seeding)
  const positions = (await listStrategy2Positions()).filter(p => p.account.toUpperCase() === account.toUpperCase())
  if (positions.length === 0) {
    return { account, ranAt, positionsChecked: 0, entries: [] }
  }

  const symbols = positions.map(p => p.symbol)
  const quotes = await getQuotes(creds, symbols)
  const instrumentTokens = await getInstrumentTokens(creds, symbols).catch(() => ({} as Record<string, number>))
  const candleWindow = latestCompletedFiveMinuteRange()

  console.log(`[strategy2 monitor] ${account}: ${positions.length} open S2 position(s) — ${symbols.join(', ')}`)

  for (const pos of positions) {
    const symbol = pos.symbol
    const quote = quotes[`NSE:${symbol}`]
    const ltp = quote?.last_price
    const liveQty = liveQtyBySymbol.get(symbol) ?? 0

    // Look up THIS position's strategy config — every dt-${id}-tagged position
    // uses its own exits + handoff window. Fallback to catalyst-equivalent
    // defaults if the strategy was deleted (which shouldn't happen because of
    // the deactivate/delete migration, but defensive).
    const ownerStrategy = getStrategyById(pos.strategyId)
    const t1Pct = ownerStrategy?.exits?.t1Pct ?? 1.5
    const t2Pct = ownerStrategy?.exits?.t2Pct ?? 2.0
    const handoffDays = (ownerStrategy?.params as any)?.deliveryHandoffDays ?? HANDOFF_DAYS_DEFAULT

    // Sold externally? Drop from store.
    if (liveQty <= 0) {
      await removeStrategy2Position(account, symbol)
      entries.push({
        account, accountDisplayName: displayName, symbol,
        action: 'skipped', entryPrice: pos.firstBuyPrice,
        reason: 'Kite qty = 0 — position closed externally; removed from store',
      })
      continue
    }

    // Age check — handoff to Accumulator if too old (skip when handoffDays=0 i.e. never hand off)
    const ageDays = ageInCalendarDays(pos.firstBuyAt)
    if (handoffDays > 0 && ageDays >= handoffDays) {
      const handedOff = await ensureStrategy1Tracking(account, symbol, pos.remainingQty, pos.firstBuyPrice, `strategy2_age_${Math.floor(ageDays)}d`)
        .catch(err => { console.error('[strategy2] handoff to s1 failed:', err); return false })
      await removeStrategy2Position(account, symbol)
      entries.push({
        account, accountDisplayName: displayName, symbol,
        action: 'delivery', quantity: pos.remainingQty, entryPrice: pos.firstBuyPrice, ltp,
        reason: handedOff
          ? `${Math.floor(ageDays)} calendar days since first BUY — handed off to Strategy 1 (Accumulator) for percentage-based exit`
          : `${Math.floor(ageDays)} days old; Strategy 1 was already tracking — removed from S2 store`,
      })
      continue
    }

    if (ltp === undefined) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', quantity: pos.remainingQty, entryPrice: pos.firstBuyPrice, reason: 'No LTP from Kite' })
      continue
    }

    const t1Price = pos.firstBuyPrice * (1 + t1Pct / 100)
    const t2Price = pos.firstBuyPrice * (1 + t2Pct / 100)
    const gainPct = ((ltp - pos.firstBuyPrice) / pos.firstBuyPrice) * 100
    const tranche1Done = !!pos.tranche1At
    let recentCompletedHigh: number | null = null

    const token = instrumentTokens[symbol]
    if (token) {
      const candles = await getHistoricalCandles(creds, token, candleWindow.from, candleWindow.to, '5minute').catch(() => [])
      const lastCandle = candles[candles.length - 1]
      recentCompletedHigh = lastCandle ? lastCandle.high : null
    }

    // Decide what to sell, if anything
    let sellQty = 0
    let sellReason = ''
    let willCompletePosition = false
    let bypassNoLossSell = false
    if (!tranche1Done && ltp >= t2Price) {
      // LTP jumped past T2 before T1 fired — sell entire position at T2
      sellQty = pos.remainingQty
      sellReason = `LTP ₹${ltp.toFixed(2)} ≥ T2 ₹${t2Price.toFixed(2)} (skipped past T1) — selling entire position`
      willCompletePosition = true
    } else if (!tranche1Done && recentCompletedHigh !== null && recentCompletedHigh >= t2Price && ltp < t2Price) {
      sellQty = pos.remainingQty
      sellReason = `T2 was hit intraday at ₹${recentCompletedHigh.toFixed(2)} but price retreated to ₹${ltp.toFixed(2)} — selling at market`
      willCompletePosition = true
      bypassNoLossSell = true
    } else if (!tranche1Done && ltp >= t1Price) {
      // Tranche 1: sell ~50%. Use Math.ceil so a qty of 1 still triggers
      // tranche1 (we never want to leave 0/1 on a tranche).
      sellQty = Math.max(1, Math.floor(pos.remainingQty / 2))
      sellReason = `LTP ₹${ltp.toFixed(2)} ≥ T1 ₹${t1Price.toFixed(2)} — tranche 1 sell (50% of ${pos.remainingQty})`
    } else if (!tranche1Done && recentCompletedHigh !== null && recentCompletedHigh >= t1Price && ltp < t1Price) {
      sellQty = Math.max(1, Math.floor(pos.remainingQty / 2))
      sellReason = `T1 was hit intraday at ₹${recentCompletedHigh.toFixed(2)} but price retreated to ₹${ltp.toFixed(2)} — selling at market`
      bypassNoLossSell = true
    } else if (tranche1Done && ltp >= t2Price) {
      sellQty = pos.remainingQty
      sellReason = `LTP ₹${ltp.toFixed(2)} ≥ T2 ₹${t2Price.toFixed(2)} — tranche 2 sell (remainder)`
      willCompletePosition = true
    } else if (tranche1Done && recentCompletedHigh !== null && recentCompletedHigh >= t2Price && ltp < t2Price) {
      sellQty = pos.remainingQty
      sellReason = `T2 was hit intraday at ₹${recentCompletedHigh.toFixed(2)} but price retreated to ₹${ltp.toFixed(2)} — selling at market`
      willCompletePosition = true
      bypassNoLossSell = true
    }

    if (sellQty === 0) {
      // Hold
      entries.push({
        account, accountDisplayName: displayName, symbol,
        action: 'held', quantity: pos.remainingQty, entryPrice: pos.firstBuyPrice, ltp, gainPct,
        reason: tranche1Done
          ? `Waiting for T2 ₹${t2Price.toFixed(2)} — currently ₹${ltp.toFixed(2)} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%)`
          : `Waiting for T1 ₹${t1Price.toFixed(2)} — currently ₹${ltp.toFixed(2)} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%)`,
      })
      continue
    }

    // Fire SELL — preflight enforces market/no-short/no-loss
    const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: sellQty, pricePerShare: ltp, bypassNoLossSell })
    if (!pre.ok) {
      entries.push({
        account, accountDisplayName: displayName, symbol,
        action: 'skipped', quantity: sellQty, entryPrice: pos.firstBuyPrice, ltp, gainPct,
        reason: pre.gate === 'noShort'
          ? 'Position no longer held in Kite (manually closed?) — skipping'
          : `Preflight ${pre.gate}: ${pre.reason}`,
      })
      continue
    }
    const actualQty = pre.adjustedQty ?? sellQty
    const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_2_SELL_TAG })
    if (placed.ok && placed.data?.data?.order_id) {
      await markPlaced(account, symbol, 'SELL', { price: ltp, manual: false })
      journalOrder({ account, symbol, side: 'SELL', qty: actualQty, price: ltp, tag: STRATEGY_2_SELL_TAG, orderId: placed.data.data.order_id })
        .catch(err => console.error('[strategy2] journalOrder failed:', err))

      // Update the position store
      if (willCompletePosition || actualQty >= pos.remainingQty) {
        await removeStrategy2Position(account, symbol)
      } else {
        await markTranche1Sold(account, symbol, actualQty)
      }

      const pnlRupees = (ltp - pos.firstBuyPrice) * actualQty
      const pnlPct = gainPct
      const dayHigh = (quote as any)?.ohlc?.high ?? ltp
      const dayLow  = (quote as any)?.ohlc?.low  ?? ltp
      appendJournal({
        type: 'trade',
        date: istDateString(),
        account, symbol,
        qty: actualQty,
        entryPrice: pos.firstBuyPrice,
        entryTime: pos.firstBuyAt,
        exitPrice: ltp,
        exitTime: new Date().toISOString(),
        pnlRupees, pnlPct,
        dayHighAfterEntry: dayHigh,
        dayLowAfterEntry: dayLow,
        leftOnTable: Math.max(0, dayHigh - ltp),
        verdict: classifyVerdict({ strategy: 'catalyst', entryPrice: pos.firstBuyPrice, exitPrice: ltp, t1TriggerPct: t1Pct }),
        strategy: 'catalyst',
        orderIdSell: placed.data.data.order_id,
        notes: sellReason,
      }).catch(err => console.error('[strategy2] journal write failed:', err))

      entries.push({
        account, accountDisplayName: displayName, symbol,
        action: 'sold', quantity: actualQty, entryPrice: pos.firstBuyPrice, ltp, gainPct,
        orderId: placed.data.data.order_id,
        reason: sellReason,
      })
      sendEmail('trade_executed', {
        account, accountDisplayName: displayName, symbol,
        side: 'SELL', quantity: actualQty, price: ltp,
        orderId: placed.data.data.order_id,
        source: `S2 auto-exit @ +${gainPct.toFixed(2)}%`,
        reason: sellReason,
        mode: 'auto',
      }).catch(err => console.error('[strategy2] sold-email failed:', err))
    } else {
      const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
      entries.push({
        account, accountDisplayName: displayName, symbol,
        action: 'sold_failed', quantity: actualQty, entryPrice: pos.firstBuyPrice, ltp, gainPct,
        reason: errMsg,
      })
      sendEmail('trade_failed', {
        account, accountDisplayName: displayName, symbol,
        side: 'SELL', quantity: actualQty, price: ltp,
        failedAt: 'kite', reason: errMsg, mode: 'auto',
      }).catch(err => console.error('[strategy2] sold-failed-email failed:', err))
    }
  }

  return { account, ranAt, positionsChecked: positions.length, entries }
}

// Run the monitor across every connected account. Used by the cron tick.
export async function monitorAllConnected(): Promise<MonitorResult[]> {
  const { getState } = await import('./state')
  const state = await getState()
  const accounts = Object.keys(state.kiteTokens)
  return Promise.all(accounts.map(monitorAccount))
}
