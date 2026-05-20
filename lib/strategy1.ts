// Strategy 1 — "The Oscillator" SELL engine.
//
// Unified two-tranche exit (post Phase 5 — was EMA-based, now first-BUY-based):
//   - Tranche 1: LTP ≥ firstBuyPrice × (1 + oscillator.exits.t1Pct/100) → sell 50%
//   - Tranche 2: LTP ≥ firstBuyPrice × (1 + oscillator.exits.t2Pct/100) → sell rest
//   - Jump past T2 before T1 → sell entire qty at T2
//
// "First BUY" is `pos.firstBuyPrice` from data/strategy1.json — the price at which
// the original entry was recorded. Pyramid BUYs add qty to remainingQty without
// changing entryPrice, so the exit basis stays anchored to the first entry.
//
// Positions are tracked in a JSON file alongside state.json so the monitor
// only manages OUR Strategy 1 BUYs — never the user's pre-existing holdings.

import { getState } from './state'
import { getAccountList } from './accounts'
import {
  resolveAccountCreds, getQuotes, placeKiteOrder,
  type KiteCreds,
} from './kite'
import { runPreflight, markPlaced } from './preflight'
import { sendEmail } from './email'
import { appendJournal, journalOrder, istDateString } from './journal'
import { getStrategyById, getStrategies } from './strategyConfig'
import * as positions from './positions'
import type { Position } from './positions'

export const STRATEGY_1_BUY_TAG = 'dt-s1'
export const STRATEGY_1_TRANCHE1_TAG = 'dt-s1-t1'
export const STRATEGY_1_TRANCHE2_TAG = 'dt-s1-t2'

// Storage migrated to lib/positions.ts. This file keeps the same public API
// (recordStrategy1Buy, ensureStrategy1Tracking, listStrategy1Positions, the
// monitor) so existing callers stay unchanged.

// Called after a successful Strategy 1 BUY (cron auto-buy + manual Execute path).
// Pyramid-aware via lib/positions.ts: existing position adds qty, fresh entry
// is created with strategyId='accumulator'.
export async function recordStrategy1Buy(account: string, symbol: string, qty: number, entryPrice: number): Promise<void> {
  await positions.recordBuy('accumulator', account, symbol, qty, entryPrice)
}

// Handoff entry point used by the Strategy 2 (momentum) monitor when a
// position's deliveryHandoffDays clock expires. Re-stamps the strategyId of
// the existing single position row to 'accumulator' — the firstBuyPrice /
// firstBuyAt anchors are preserved so accumulator's exits still reference the
// original entry. If no position exists, falls through to create a new one
// (rare — only matters if the handoff somehow runs without a prior BUY).
export async function ensureStrategy1Tracking(
  account: string, symbol: string, qty: number, entryPrice: number,
  source: string = 'manual',
): Promise<boolean> {
  const existing = await positions.getPosition(account, symbol)
  if (existing) {
    if (existing.strategyId === 'accumulator') return false
    await positions.setStrategyId(account, symbol, 'accumulator')
    console.log(`[strategy1] re-tagged ${account}:${symbol} → accumulator (source: ${source})`)
    return true
  }
  await positions.recordBuy('accumulator', account, symbol, qty, entryPrice)
  console.log(`[strategy1] now tracking ${account}:${symbol} × ${qty} @ ₹${entryPrice} (source: ${source})`)
  return true
}

// Used by Holdings/Engine UI to show "this is a Strategy 1 position".
// Returns positions belonging to any dip-type strategy (currently just
// accumulator, but future user-created dip strategies will appear here too).
export async function listStrategy1Positions(): Promise<Array<Position & { account: string; symbol: string }>> {
  const dipIds = new Set(getStrategies().filter(s => s.type === 'dip').map(s => s.id))
  const all = await positions.listPositions()
  return all.filter(p => dipIds.has(p.strategyId)).map(p => ({
    account: p.account,
    symbol: p.symbol,
    strategyId: p.strategyId,
    firstBuyPrice: p.firstBuyPrice,
    firstBuyAt: p.firstBuyAt,
    totalQty: p.totalQty,
    remainingQty: p.remainingQty,
    tranche1At: p.tranche1At,
    tranche1SoldQty: p.tranche1SoldQty,
  }))
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

  // All dip-type strategies use the Strategy 1 monitor (accumulator + any
  // user-created dip-type strategies). Each position's exits come from ITS
  // OWN strategyId's config (looked up per iteration below), enabling
  // differentiated exit profiles per dip strategy.
  const dipIds = new Set(getStrategies().filter(s => s.type === 'dip').map(s => s.id))
  const ours = (await positions.listPositions({ account }))
    .filter(p => dipIds.has(p.strategyId))
  if (ours.length === 0) return { account, ranAt, positionsChecked: 0, entries: [] }

  // Batch quote for all our held symbols
  const symbols = ours.map(p => p.symbol)
  let quotes: Record<string, { last_price: number }> = {}
  try {
    quotes = await getQuotes(creds, symbols) as any
  } catch (err) {
    return { account, ranAt, positionsChecked: ours.length, entries: [{ account, accountDisplayName: displayName, symbol: '—', action: 'skipped', reason: `Quote fetch failed: ${String(err).slice(0, 100)}` }] }
  }

  for (const pos of ours) {
    const symbol = pos.symbol
    // Per-position strategy config — uses pos.strategyId so each dip strategy
    // (accumulator, deep_dip, etc.) gets its own t1Pct/t2Pct.
    const ownerStrategy = getStrategyById(pos.strategyId)
    const t1Pct = ownerStrategy?.exits?.t1Pct ?? 5.0
    const t2Pct = ownerStrategy?.exits?.t2Pct ?? 8.0
    const ltp = quotes[`NSE:${symbol}`]?.last_price
    if (ltp === undefined) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'No LTP from Kite' })
      continue
    }

    const t1Trigger = pos.firstBuyPrice * (1 + t1Pct / 100)
    const t2Trigger = pos.firstBuyPrice * (1 + t2Pct / 100)
    const gainPct = ((ltp - pos.firstBuyPrice) / pos.firstBuyPrice) * 100

    // ────── DECISION ──────
    // If LTP jumped past T2 before T1 ever fired → sell entire position at T2
    if (!pos.tranche1At && ltp >= t2Trigger) {
      const intentQty = pos.remainingQty
      const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: intentQty, pricePerShare: ltp })
      if (!pre.ok) {
        if (pre.gate === 'noShort') {
          await positions.removePosition(account, symbol)
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'Position no longer held in Kite — tracking cleared' })
        } else {
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: pos.firstBuyPrice, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
        }
        continue
      }
      const actualQty = pre.adjustedQty ?? intentQty
      const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE2_TAG })
      if (placed.ok && placed.data?.data?.order_id) {
        await markPlaced(account, symbol, 'SELL', { price: ltp, manual: false })
        journalOrder({ account, symbol, side: 'SELL', qty: actualQty, price: ltp, tag: STRATEGY_1_TRANCHE2_TAG, orderId: placed.data.data.order_id })
          .catch(err => console.error('[strategy1] journalOrder failed:', err))
        await positions.removePosition(account, symbol)
        const pnlR = (ltp - pos.firstBuyPrice) * actualQty
        appendJournal({
          type: 'trade', date: istDateString(),
          account, symbol, qty: actualQty,
          entryPrice: pos.firstBuyPrice, entryTime: pos.firstBuyAt,
          exitPrice: ltp, exitTime: new Date().toISOString(),
          pnlRupees: pnlR, pnlPct: gainPct,
          dayHighAfterEntry: ltp, dayLowAfterEntry: ltp, leftOnTable: 0,
          verdict: 'correct_exit', strategy: 'accumulator',
          orderIdSell: placed.data.data.order_id,
          notes: `Tranche-skip — LTP ≥ T2 ₹${t2Trigger.toFixed(2)} before T1 fired; sold entire qty`,
        }).catch(err => console.error('[strategy1] journal write failed:', err))
        entries.push({
          account, accountDisplayName: displayName, symbol, action: 'tranche2_sold',
          qty: actualQty, entryPrice: pos.firstBuyPrice, ltp,
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
        qty: pos.remainingQty, entryPrice: pos.firstBuyPrice, ltp,
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
          await positions.removePosition(account, symbol)
          entries.push({
            account, accountDisplayName: displayName, symbol, action: 'skipped',
            reason: 'Position no longer held in Kite — Strategy 1 tracking cleared',
          })
        } else {
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: pos.firstBuyPrice, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
        }
        continue
      }
      const actualQty = pre.adjustedQty ?? intentQty
      const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE1_TAG })
      if (placed.ok && placed.data?.data?.order_id) {
        await markPlaced(account, symbol, 'SELL', { price: ltp, manual: false })
        journalOrder({ account, symbol, side: 'SELL', qty: actualQty, price: ltp, tag: STRATEGY_1_TRANCHE1_TAG, orderId: placed.data.data.order_id })
          .catch(err => console.error('[strategy1] journalOrder failed:', err))
        const adjusted = pre.adjustedQty !== undefined
        if (adjusted) {
          // Held less than intended 50% — selling what's there closes the position
          await positions.removePosition(account, symbol)
        } else {
          await positions.markTranche1Sold(account, symbol, actualQty)
        }
        // Journal — partial exit
        const pnlR = (ltp - pos.firstBuyPrice) * actualQty
        const pnlP = ((ltp - pos.firstBuyPrice) / pos.firstBuyPrice) * 100
        appendJournal({
          type: 'trade', date: istDateString(),
          account, symbol, qty: actualQty,
          entryPrice: pos.firstBuyPrice, entryTime: pos.firstBuyAt,
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
          qty: actualQty, entryPrice: pos.firstBuyPrice, ltp,
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
            : `Sold 50% of original ${pos.totalQty} as LTP reached T1 ₹${t1Trigger.toFixed(2)} (entry ₹${pos.firstBuyPrice} + ${t1Pct}%)`,
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
        qty: pos.remainingQty, entryPrice: pos.firstBuyPrice, ltp,
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
        await positions.removePosition(account, symbol)
        entries.push({
          account, accountDisplayName: displayName, symbol, action: 'skipped',
          reason: 'Position no longer held in Kite — Strategy 1 tracking cleared',
        })
      } else {
        entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: pos.firstBuyPrice, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
      }
      continue
    }
    const actualQty = pre.adjustedQty ?? intentQty
    const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE2_TAG })
    if (placed.ok && placed.data?.data?.order_id) {
      await markPlaced(account, symbol, 'SELL', { price: ltp, manual: false })
      await positions.removePosition(account, symbol)
      const adjusted = pre.adjustedQty !== undefined
      // Journal — final exit
      const pnlR2 = (ltp - pos.firstBuyPrice) * actualQty
      const pnlP2 = ((ltp - pos.firstBuyPrice) / pos.firstBuyPrice) * 100
      appendJournal({
        type: 'trade', date: istDateString(),
        account, symbol, qty: actualQty,
        entryPrice: pos.firstBuyPrice, entryTime: pos.firstBuyAt,
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
        qty: actualQty, entryPrice: pos.firstBuyPrice, ltp,
        orderId: placed.data.data.order_id,
        reason: adjusted ? `Adjusted ${intentQty} → ${actualQty} (partial manual close)` : undefined,
      })
      sendEmail('trade_executed', {
        account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp,
        orderId: placed.data.data.order_id,
        source: `Strategy 1 — Tranche 2 (entry +${t2Pct}% hit)`,
        reason: adjusted
          ? `Closing remaining ${actualQty} (clamped from ${intentQty} — partial manual close)`
          : `Closing remaining ${actualQty} — LTP ₹${ltp.toFixed(2)} ≥ T2 ₹${t2Trigger.toFixed(2)} (entry ₹${pos.firstBuyPrice} + ${t2Pct}%)`,
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
