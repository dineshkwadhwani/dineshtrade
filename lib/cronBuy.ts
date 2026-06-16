// Auto-buy engine for the cron subsystem.
// Handles the per-recommendation BUY placement and per-strategy scan task body.

import { getBackendInfo, getState } from './state'
import { isMarketOpen } from './market'
import { getAccountList } from './accounts'
import { sendEmail, type EODLineItem } from './email'
import { runStrategyScan, runReactiveDipScan, type Recommendation } from './strategyEngine'
import { getCapital, type Strategy } from './strategyConfig'
import { resolveAccountCreds, placeKiteOrder } from './kite'
import { runPreflight, markPlaced } from './preflight'
import { appendJournal, istDateString } from './journal'
import {
  istHHMM, maybeRollDay,
  getInProcessBuyCount, getInProcessNewPositionCount,
  incrementInProcessBuy, registerInProcessNewSymbol,
  dayStats, strategyLastRunAt,
  recordExecuted, recordFailed, recordSkipped,
} from './cronState'

function recordAutoBuySkip(args: {
  account: string
  accountDisplayName?: string
  symbol: string
  quantity: number
  price: number
  reason: string
  gate?: string
}) {
  const { account, accountDisplayName, symbol, quantity, price, reason, gate } = args
  recordSkipped({
    time: istHHMM(),
    account,
    symbol,
    side: 'BUY',
    quantity,
    reason,
  })
  appendJournal({
    type: 'signal_skipped',
    date: istDateString(),
    time: istHHMM(),
    account,
    symbol,
    signalPrice: price,
    reasonSkipped: reason,
  }).catch(err => console.error('[cron] journal signal_skipped failed:', err))
  sendEmail('trade_failed', {
    account,
    accountDisplayName,
    symbol,
    side: 'BUY',
    quantity,
    price,
    failedAt: 'preflight',
    gate,
    reason,
    mode: 'auto',
  }).catch(err => console.error('[cron autoBuy] skipped-email failed:', err))
}

export async function autoBuyOnAccount(account: string, accountDisplayName: string | undefined, recs: Recommendation[]) {
  const creds = await resolveAccountCreds(account)
  if (!creds.ok) {
    recordSkipped({ time: istHHMM(), account, symbol: '—', side: 'BUY', quantity: 0, reason: creds.error })
    return
  }
  // Read the capital config once for the in-process quota check
  const cap = getCapital()
  for (const rec of recs) {
    // In-process quota guard — prevents two concurrent strategy cron tasks from
    // both passing the Kite quota gate before each other's order shows COMPLETE.
    const inProcessCount = getInProcessBuyCount(account)
    if (inProcessCount >= cap.maxBuysPerDay) {
      recordAutoBuySkip({
        account,
        accountDisplayName,
        symbol: rec.symbol,
        quantity: rec.suggestedQty,
        price: rec.price,
        gate: 'inProcessQuota',
        reason: `[inProcessQuota] already ${inProcessCount}/${cap.maxBuysPerDay} in-process buys today`,
      })
      continue
    }

    // In-process positions guard — prevents two concurrent strategy tasks from
    // both passing Gate 6 (positions cap) before each other's order shows in
    // Kite's /portfolio/positions. We track NEW symbols committed in-process
    // today (symbols that will add 1 to the open-position count when settled).
    // Gate 6 in preflight is still the authoritative check (reads live Kite
    // data); this fast pre-check closes the same-process race condition.
    const inProcessNewPos = getInProcessNewPositionCount(account)
    // Conservative: estimate existing positions = positions already in the
    // positions store for this account (includes reset-seeded holdings).
    const existingStorePositions = (await import('./positions'))
      .listPositions({ account }).then(ps => ps.length).catch(() => 0)
    const estimatedTotal = (await existingStorePositions) + inProcessNewPos
    if (estimatedTotal >= cap.maxPositions) {
      recordAutoBuySkip({
        account,
        accountDisplayName,
        symbol: rec.symbol,
        quantity: rec.suggestedQty,
        price: rec.price,
        gate: 'inProcessPositions',
        reason: `[inProcessPositions] estimated ${estimatedTotal}/${cap.maxPositions} open positions (including ${inProcessNewPos} in-process today)`,
      })
      continue
    }
    const pre = await runPreflight({
      account, symbol: rec.symbol, side: 'BUY',
      quantity: rec.suggestedQty, pricePerShare: rec.price,
      strategyId: rec.strategy,
    })
    if (!pre.ok) {
      recordAutoBuySkip({
        account,
        accountDisplayName,
        symbol: rec.symbol,
        quantity: rec.suggestedQty,
        price: rec.price,
        gate: pre.gate,
        reason: `[${pre.gate}] ${pre.reason || 'Unknown'}`.trim(),
      })
      continue
    }
    // Tag carries the strategy id directly — unified store + per-strategy params.
    const tag = `dt-${rec.strategy}`
    const placed = await placeKiteOrder(creds, {
      symbol: rec.symbol, side: 'BUY', quantity: rec.suggestedQty, tag,
    })
    if (placed.ok && placed.data?.data?.order_id) {
      // Increment in-process counters immediately so sibling strategy tasks see them
      incrementInProcessBuy(account)
      registerInProcessNewSymbol(account, rec.symbol)
      // Persist BEFORE doing anything else — critical for preventing duplicate
      // BUYs on the next cron tick if this function were to crash partway.
      await markPlaced(account, rec.symbol, 'BUY', { price: rec.price, manual: false })
      // Single store, single call — strategyId on the row drives monitor ownership.
      const { recordBuy } = await import('./positions')
      recordBuy(rec.strategy, account, rec.symbol, rec.suggestedQty, rec.price)
        .catch(err => console.error('[cron autoBuy] position record failed:', err))
      // Journal the order so historical retrospectives can show today's auto BUYs
      // without depending on Kite's session-scoped /orders endpoint.
      const { journalOrder } = await import('./journal')
      journalOrder({
        account, symbol: rec.symbol, side: 'BUY',
        qty: rec.suggestedQty, price: rec.price,
        tag, orderId: placed.data.data.order_id,
      }).catch(err => console.error('[cron autoBuy] journalOrder failed:', err))
      recordExecuted({
        time: istHHMM(), account, symbol: rec.symbol, side: 'BUY',
        quantity: rec.suggestedQty, price: rec.price, orderId: placed.data.data.order_id,
      })
      sendEmail('trade_executed', {
        account, accountDisplayName, symbol: rec.symbol, symbolName: rec.name,
        side: 'BUY', quantity: rec.suggestedQty, price: rec.price,
        target1: rec.target1, target2: rec.target2,
        orderId: placed.data.data.order_id, source: rec.source, reason: rec.reason,
        mode: 'auto',
      }).catch(err => console.error('[cron autoBuy] executed-email failed:', err))
    } else {
      const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
      recordFailed({
        time: istHHMM(), account, symbol: rec.symbol, side: 'BUY',
        quantity: rec.suggestedQty, price: rec.price, reason: errMsg,
      })
      sendEmail('trade_failed', {
        account, accountDisplayName, symbol: rec.symbol, side: 'BUY',
        quantity: rec.suggestedQty, price: rec.price,
        failedAt: 'kite', reason: errMsg, mode: 'auto',
      }).catch(err => console.error('[cron autoBuy] failed-email failed:', err))
    }
  }
}

// Per-strategy task body. Runs the strategy's scanner with its own params
// and watchlist, then auto-BUYs the resulting recommendations on every
// selected account. Idempotency in preflight prevents duplicates across
// strategies (one BUY per symbol per account per day).
export async function runStrategyTaskBody(strategy: Strategy): Promise<void> {
  maybeRollDay()
  const backend = getBackendInfo()
  console.log(`[cron strategy:${strategy.id}] entered task body · backend=${backend.backend}${backend.path ? ` path=${backend.path}` : ''}`)
  const market = isMarketOpen()
  if (!market.open) {
    console.log(`[cron strategy:${strategy.id}] skipped — market closed (${market.status})`)
    return
  }
  const state = await getState()
  console.log(`[cron strategy:${strategy.id}] loaded state · mode=${state.mode} · selected=${state.selectedAccounts.length} · tokens=${Object.keys(state.kiteTokens).length}`)
  if (state.mode !== 'auto') {
    console.log(`[cron strategy:${strategy.id}] skipped — mode=${state.mode}`)
    return
  }
  if (Object.keys(state.kiteTokens).length === 0) {
    console.log(`[cron strategy:${strategy.id}] skipped — no Kite tokens in state`)
    return
  }

  const t = istHHMM()
  strategyLastRunAt[strategy.id] = new Date().toISOString()
  console.log(`[cron strategy:${strategy.id}] ${t} IST — scan firing (every ${strategy.scanIntervalMin} min)`)

  let recsCount = 0
  let executedCount = 0
  let scanSymbols: string[] = []
  let skipReason: string | undefined

  try {
    const result = await runStrategyScan(strategy)
    recsCount = result.recommendations.length
    scanSymbols = result.recommendations.map(r => r.symbol)
    if (recsCount === 0) {
      skipReason = result.message
      if (result.message) console.log(`[cron strategy:${strategy.id}] 0 recs: ${result.message}`)
    } else {
      const accounts = getAccountList()
      const targetAccounts = state.selectedAccounts.filter(a => !!state.kiteTokens[a])
      if (targetAccounts.length === 0) {
        console.log(`[cron strategy:${strategy.id}] no selectedAccounts with tokens`)
        skipReason = 'No selectedAccounts with valid tokens'
      } else {
        console.log(`[cron strategy:${strategy.id}] ${recsCount} rec(s) → ${targetAccounts.length} account(s)`)
        for (const account of targetAccounts) {
          const display = accounts.find(a => a.name === account)?.displayName
          const beforeExec = dayStats.executed.length
          await autoBuyOnAccount(account, display, result.recommendations)
          executedCount += (dayStats.executed.length - beforeExec)
        }
      }
    }
  } catch (err) {
    console.error(`[cron strategy:${strategy.id}] scan failed:`, err)
    skipReason = `Scan crashed: ${String(err).slice(0, 120)}`
  }

  // Journal this scan tick so the daily retrospective can compute per-strategy
  // health: scans/signals/executions counts + last-signal-date. Fire-and-forget.
  const { appendJournal: aj, istDateString: ids } = await import('./journal')
  aj({
    type: 'strategy_scan',
    date: ids(),
    ts: new Date().toISOString(),
    strategyId: strategy.id,
    strategyName: strategy.name,
    recs: recsCount,
    executed: executedCount,
    symbols: scanSymbols.length > 0 ? scanSymbols : undefined,
    skipReason,
  }).catch(err => console.error(`[cron strategy:${strategy.id}] journal scan failed:`, err))
}
