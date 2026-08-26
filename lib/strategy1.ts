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
import { getBroker } from './broker'
import { sendEmail, isSkipTradeMailsEnabled } from './email'
import { appendJournal, journalOrder, istDateString, istHHMM } from './journal'
import { asDipParams, getStrategyById, getStrategies } from './strategyConfig'
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
    await positions.setStrategyId(account, symbol, 'accumulator', { restampLots: true })
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
  const broker = getBroker({ brokerName: 'zerodha', brokerCredentials: { apiKey: creds.apiKey, accessToken: creds.accessToken } })

  // All dip-type strategies use the Strategy 1 monitor (accumulator + any
  // user-created dip-type strategies). Each position's exits come from ITS
  // OWN strategyId's config (looked up per iteration below), enabling
  // differentiated exit profiles per dip strategy.
  const dipIds = new Set(getStrategies().filter(s => s.type === 'dip').map(s => s.id))
  // positions already scoped by customer_id in Supabase — account filter skipped (UUID vs broker name mismatch in V2)
  const ours = (await positions.listPositions())
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
    const ownerStrategyName = ownerStrategy?.name || pos.strategyId
    const retraceAfterHit = ownerStrategy?.type === 'dip'
      ? asDipParams(ownerStrategy).retraceAfterHit !== false
      : true
    const retractAllowedRaw = ownerStrategy?.type === 'dip'
      ? asDipParams(ownerStrategy).retractPercentAllowed
      : undefined
    const retractAllowed = (typeof retractAllowedRaw === 'number' && Number.isFinite(retractAllowedRaw) && retractAllowedRaw >= 0)
      ? retractAllowedRaw
      : null
    const t1Pct = ownerStrategy?.exits?.t1Pct ?? 5.0
    const t2Pct = ownerStrategy?.exits?.t2Pct ?? 8.0
    const ltp = quotes[`NSE:${symbol}`]?.last_price
    if (ltp === undefined) {
      entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'No LTP from Kite' })
      continue
    }

    const lots = (await positions.listPositionLots(pos)).sort((a, b) => a.boughtAt.localeCompare(b.boughtAt))
    let soldAnyLot = false

    for (const lot of lots) {
      if (lot.remainingQty < 1) continue
      const t1Trigger = lot.entryPrice * (1 + t1Pct / 100)
      const t2Trigger = lot.entryPrice * (1 + t2Pct / 100)
      const gainPct = ((ltp - lot.entryPrice) / lot.entryPrice) * 100
      const lotLabel = `${new Date(lot.boughtAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} @ ₹${lot.entryPrice.toFixed(2)}`
      const q: any = quotes[`NSE:${symbol}`] as any
      const observedHigh = Math.max(ltp, Number(q?.ohlc?.high || 0))
      const minGainAfterRetrace = (triggerPct: number): number => {
        const allowed = retractAllowed === null ? triggerPct : retractAllowed
        return Math.max(0, triggerPct - Math.max(0, allowed))
      }
      const minGainT1 = minGainAfterRetrace(t1Pct)
      const minGainT2 = minGainAfterRetrace(t2Pct)

      const t2DirectHit = !lot.tranche1At && ltp >= t2Trigger
      const t2RetraceHit = retraceAfterHit && !lot.tranche1At && observedHigh >= t2Trigger && ltp < t2Trigger && ltp > lot.entryPrice && gainPct >= minGainT2
      if (t2DirectHit || t2RetraceHit) {
        const intentQty = lot.remainingQty
        const t2Reason = t2DirectHit
          ? `Lot ${lotLabel} skipped past T1 — sold entire lot at T2`
          : `Lot ${lotLabel} hit T2 intraday at ₹${observedHigh.toFixed(2)} then retraced to ₹${ltp.toFixed(2)} — sold entire lot`
        const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: intentQty, pricePerShare: ltp, buyPricePerShare: lot.entryPrice }, broker)
        if (!pre.ok) {
          if (pre.gate === 'noLossSell') {
            appendJournal({
              type: 'signal_skipped',
              date: istDateString(),
              time: istHHMM(),
              account,
              symbol,
              signalPrice: ltp,
              reasonSkipped: `[noLossSell-exit] ${pre.reason || 'Auto mode blocked SELL at net loss'}`,
            }).catch(err => console.error('[strategy1] noLossSell journal write failed:', err))
            isSkipTradeMailsEnabled().then(enabled => {
              if (enabled) sendEmail('trade_skipped', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: intentQty, price: ltp, gate: 'noLossSell', reason: pre.reason || 'Auto mode blocked SELL at net loss' }).catch(() => {})
            }).catch(() => {})
          }
          if (pre.gate === 'noShort') {
            await positions.removePosition(account, symbol)
            entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'Position no longer held in Kite — tracking cleared' })
          } else {
            entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: lot.entryPrice, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
          }
          continue
        }
        const actualQty = pre.adjustedQty ?? intentQty
        const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE2_TAG })
        if (placed.ok && placed.data?.data?.order_id) {
          soldAnyLot = true
          await markPlaced(account, symbol, 'SELL', { price: ltp, manual: false })
          journalOrder({ account, symbol, side: 'SELL', qty: actualQty, price: ltp, tag: STRATEGY_1_TRANCHE2_TAG, orderId: placed.data.data.order_id })
            .catch(err => console.error('[strategy1] journalOrder failed:', err))
          await positions.applyLotSell(account, symbol, lot.id, actualQty)
          const pnlR = (ltp - lot.entryPrice) * actualQty
          appendJournal({
            type: 'trade', date: istDateString(),
            account, symbol, qty: actualQty,
            entryPrice: lot.entryPrice, entryTime: lot.boughtAt,
            exitPrice: ltp, exitTime: new Date().toISOString(),
            pnlRupees: pnlR, pnlPct: gainPct,
            dayHighAfterEntry: ltp, dayLowAfterEntry: ltp, leftOnTable: 0,
            verdict: 'correct_exit', strategy: pos.strategyId,
            orderIdSell: placed.data.data.order_id,
            notes: t2Reason,
          }).catch(err => console.error('[strategy1] journal write failed:', err))
          entries.push({
            account, accountDisplayName: displayName, symbol, action: 'tranche2_sold',
            qty: actualQty, entryPrice: lot.entryPrice, ltp,
            orderId: placed.data.data.order_id,
            reason: t2DirectHit
              ? `Lot ${lotLabel}: LTP ₹${ltp.toFixed(2)} ≥ T2 ₹${t2Trigger.toFixed(2)} before T1 — sold entire ${actualQty}`
              : `Lot ${lotLabel}: T2 hit intraday at ₹${observedHigh.toFixed(2)} and retraced to ₹${ltp.toFixed(2)} — sold entire ${actualQty}`,
          })
          sendEmail('trade_executed', {
            account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp,
            orderId: placed.data.data.order_id,
            source: `${ownerStrategyName} — Full exit (skipped past T1)`,
            reason: `Lot ${lotLabel} hit T2 ₹${t2Trigger.toFixed(2)} before T1 — closing entire lot`,
            mode: 'auto',
          }).catch(() => {})
        } else {
          const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'failed', qty: actualQty, ltp, reason: errMsg })
          sendEmail('trade_failed', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp, failedAt: 'kite', reason: errMsg, mode: 'auto' }).catch(() => {})
        }
        continue
      }

      const t1DirectHit = !lot.tranche1At && ltp >= t1Trigger
      const t1RetraceHit = retraceAfterHit && !lot.tranche1At && observedHigh >= t1Trigger && ltp < t1Trigger && ltp > lot.entryPrice && gainPct >= minGainT1
      if (t1DirectHit || t1RetraceHit) {
        // Ceil (not floor) so an odd remainingQty sells the extra share now
        // and a single-share lot closes here instead of leaving a 0-qty
        // remainder for T2 to chase.
        const intentQty = Math.ceil(lot.remainingQty / 2)
        const t1Reason = t1DirectHit
          ? `Lot ${lotLabel} tranche 1 hit (T1 ₹${t1Trigger.toFixed(2)})`
          : `Lot ${lotLabel} hit T1 intraday at ₹${observedHigh.toFixed(2)} then retraced to ₹${ltp.toFixed(2)} — tranche 1 sell`
        if (intentQty > lot.remainingQty) {
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: `Invalid qty ${intentQty}` })
          continue
        }
        const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: intentQty, pricePerShare: ltp, buyPricePerShare: lot.entryPrice }, broker)
        if (!pre.ok) {
          if (pre.gate === 'noLossSell') {
            appendJournal({
              type: 'signal_skipped',
              date: istDateString(),
              time: istHHMM(),
              account,
              symbol,
              signalPrice: ltp,
              reasonSkipped: `[noLossSell-exit] ${pre.reason || 'Auto mode blocked SELL at net loss'}`,
            }).catch(err => console.error('[strategy1] noLossSell journal write failed:', err))
            isSkipTradeMailsEnabled().then(enabled => {
              if (enabled) sendEmail('trade_skipped', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: intentQty, price: ltp, gate: 'noLossSell', reason: pre.reason || 'Auto mode blocked SELL at net loss' }).catch(() => {})
            }).catch(() => {})
          }
          if (pre.gate === 'noShort') {
            await positions.removePosition(account, symbol)
            entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'Position no longer held in Kite — Strategy 1 tracking cleared' })
          } else {
            entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: lot.entryPrice, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
          }
          continue
        }
        const actualQty = pre.adjustedQty ?? intentQty
        const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE1_TAG })
        if (placed.ok && placed.data?.data?.order_id) {
          soldAnyLot = true
          await markPlaced(account, symbol, 'SELL', { price: ltp, manual: false })
          journalOrder({ account, symbol, side: 'SELL', qty: actualQty, price: ltp, tag: STRATEGY_1_TRANCHE1_TAG, orderId: placed.data.data.order_id })
            .catch(err => console.error('[strategy1] journalOrder failed:', err))
          await positions.applyLotSell(account, symbol, lot.id, actualQty, { markTranche1: true })
          const pnlR = (ltp - lot.entryPrice) * actualQty
          appendJournal({
            type: 'trade', date: istDateString(),
            account, symbol, qty: actualQty,
            entryPrice: lot.entryPrice, entryTime: lot.boughtAt,
            exitPrice: ltp, exitTime: new Date().toISOString(),
            pnlRupees: pnlR, pnlPct: gainPct,
            dayHighAfterEntry: ltp, dayLowAfterEntry: ltp,
            leftOnTable: 0,
            verdict: 'correct_exit',
            strategy: pos.strategyId,
            orderIdSell: placed.data.data.order_id,
            notes: t1Reason,
          }).catch(err => console.error('[strategy1] journal write failed:', err))
          entries.push({
            account, accountDisplayName: displayName, symbol, action: 'tranche1_sold',
            qty: actualQty, entryPrice: lot.entryPrice, ltp,
            orderId: placed.data.data.order_id,
            reason: t1DirectHit
              ? `Lot ${lotLabel}: sold ${actualQty} as LTP reached T1 ₹${t1Trigger.toFixed(2)}`
              : `Lot ${lotLabel}: sold ${actualQty} as T1 hit intraday at ₹${observedHigh.toFixed(2)} and retraced to ₹${ltp.toFixed(2)}`,
          })
          sendEmail('trade_executed', {
            account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp,
            orderId: placed.data.data.order_id,
            source: `${ownerStrategyName} — Tranche 1 (entry +${t1Pct}%)`,
            reason: `Lot ${lotLabel} reached T1 ₹${t1Trigger.toFixed(2)}`,
            mode: 'auto',
          }).catch(err => console.error('[strategy1] tranche1 email failed:', err))
        } else {
          const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'failed', qty: actualQty, ltp, reason: errMsg })
          sendEmail('trade_failed', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp, failedAt: 'kite', reason: errMsg, mode: 'auto' }).catch(() => {})
        }
        continue
      }

      const t2RemainderDirectHit = !!lot.tranche1At && ltp >= t2Trigger
      const t2RemainderRetraceHit = retraceAfterHit && !!lot.tranche1At && observedHigh >= t2Trigger && ltp < t2Trigger && ltp > lot.entryPrice && gainPct >= minGainT2
      if (t2RemainderDirectHit || t2RemainderRetraceHit) {
        const intentQty = lot.remainingQty
        const t2RemainderReason = t2RemainderDirectHit
          ? `Lot ${lotLabel} tranche 2 hit (T2 ₹${t2Trigger.toFixed(2)})`
          : `Lot ${lotLabel} hit T2 intraday at ₹${observedHigh.toFixed(2)} then retraced to ₹${ltp.toFixed(2)} — closing remainder`
        const pre = await runPreflight({ account, symbol, side: 'SELL', quantity: intentQty, pricePerShare: ltp, buyPricePerShare: lot.entryPrice }, broker)
        if (!pre.ok) {
          if (pre.gate === 'noLossSell') {
            appendJournal({
              type: 'signal_skipped',
              date: istDateString(),
              time: istHHMM(),
              account,
              symbol,
              signalPrice: ltp,
              reasonSkipped: `[noLossSell-exit] ${pre.reason || 'Auto mode blocked SELL at net loss'}`,
            }).catch(err => console.error('[strategy1] noLossSell journal write failed:', err))
            isSkipTradeMailsEnabled().then(enabled => {
              if (enabled) sendEmail('trade_skipped', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: intentQty, price: ltp, gate: 'noLossSell', reason: pre.reason || 'Auto mode blocked SELL at net loss' }).catch(() => {})
            }).catch(() => {})
          }
          if (pre.gate === 'noShort') {
            await positions.removePosition(account, symbol)
            entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', reason: 'Position no longer held in Kite — Strategy 1 tracking cleared' })
          } else {
            entries.push({ account, accountDisplayName: displayName, symbol, action: 'skipped', qty: intentQty, entryPrice: lot.entryPrice, ltp, reason: `Preflight ${pre.gate}: ${pre.reason}` })
          }
          continue
        }
        const actualQty = pre.adjustedQty ?? intentQty
        const placed = await placeKiteOrder(creds, { symbol, side: 'SELL', quantity: actualQty, tag: STRATEGY_1_TRANCHE2_TAG })
        if (placed.ok && placed.data?.data?.order_id) {
          soldAnyLot = true
          await markPlaced(account, symbol, 'SELL', { price: ltp, manual: false })
          await positions.applyLotSell(account, symbol, lot.id, actualQty)
          const pnlR2 = (ltp - lot.entryPrice) * actualQty
          appendJournal({
            type: 'trade', date: istDateString(),
            account, symbol, qty: actualQty,
            entryPrice: lot.entryPrice, entryTime: lot.boughtAt,
            exitPrice: ltp, exitTime: new Date().toISOString(),
            pnlRupees: pnlR2, pnlPct: gainPct,
            dayHighAfterEntry: ltp, dayLowAfterEntry: ltp,
            leftOnTable: 0,
            verdict: 'correct_exit',
            strategy: pos.strategyId,
            orderIdSell: placed.data.data.order_id,
            notes: t2RemainderReason,
          }).catch(err => console.error('[strategy1] journal write failed:', err))
          entries.push({
            account, accountDisplayName: displayName, symbol, action: 'tranche2_sold',
            qty: actualQty, entryPrice: lot.entryPrice, ltp,
            orderId: placed.data.data.order_id,
            reason: t2RemainderDirectHit
              ? `Lot ${lotLabel}: closing remaining ${actualQty} — LTP ₹${ltp.toFixed(2)} ≥ T2 ₹${t2Trigger.toFixed(2)}`
              : `Lot ${lotLabel}: closing remaining ${actualQty} — T2 hit intraday at ₹${observedHigh.toFixed(2)} and retraced to ₹${ltp.toFixed(2)}`,
          })
          sendEmail('trade_executed', {
            account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp,
            orderId: placed.data.data.order_id,
            source: `${ownerStrategyName} — Tranche 2 (entry +${t2Pct}% hit)`,
            reason: `Lot ${lotLabel} reached T2 ₹${t2Trigger.toFixed(2)}`,
            mode: 'auto',
          }).catch(() => {})
        } else {
          const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
          entries.push({ account, accountDisplayName: displayName, symbol, action: 'failed', qty: actualQty, ltp, reason: errMsg })
          sendEmail('trade_failed', { account, accountDisplayName: displayName, symbol, side: 'SELL', quantity: actualQty, price: ltp, failedAt: 'kite', reason: errMsg, mode: 'auto' }).catch(() => {})
        }
      }
    }

    if (!soldAnyLot) {
      const nextLot = lots.find(lot => lot.remainingQty > 0)
      const holdEntryPrice = nextLot?.entryPrice ?? pos.firstBuyPrice
      const holdT1 = holdEntryPrice * (1 + t1Pct / 100)
      const holdT2 = holdEntryPrice * (1 + t2Pct / 100)
      const holdGainPct = ((ltp - holdEntryPrice) / holdEntryPrice) * 100
      entries.push({
        account, accountDisplayName: displayName, symbol, action: 'held',
        qty: pos.remainingQty, entryPrice: holdEntryPrice, ltp,
        reason: nextLot?.tranche1At
          ? `Waiting for T2 ₹${holdT2.toFixed(2)} on the next open lot — currently ₹${ltp.toFixed(2)} (${holdGainPct >= 0 ? '+' : ''}${holdGainPct.toFixed(2)}%)`
          : `Waiting for T1 ₹${holdT1.toFixed(2)} on the next open lot — currently ₹${ltp.toFixed(2)} (${holdGainPct >= 0 ? '+' : ''}${holdGainPct.toFixed(2)}%)`,
      })
    }
  }

  return { account, ranAt, positionsChecked: ours.length, entries }
}

export async function monitorAllAccountsStrategy1(): Promise<Strategy1MonitorResult[]> {
  const state = await getState()
  const accounts = Object.keys(state.kiteTokens)
  return Promise.all(accounts.map(monitorAccountStrategy1))
}
