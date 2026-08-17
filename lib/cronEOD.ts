// EOD operations for the cron subsystem.
// Handles momentum strategy square-off and the daily/monthly retrospective.

import { getState } from './state'
import { getAccountList } from './accounts'
import { sendDailyReport, sendMonthlyReport, isEmailConfigured, sendDailyReportToEmail, sendMonthlyReportToEmail } from './email'
import { getActiveStrategies, asMomentumParams } from './strategyConfig'
import { resolveAccountCreds, placeKiteOrder, getQuotes } from './kite'
import { runPreflight, markPlaced } from './preflight'
import { getBroker } from './broker'
import { istDateString, journalOrder, readJournalDay, type OrderRecord } from './journal'
import { buildDailyReport, buildMonthlyReport, isLastWeekdayOfMonth } from './retrospective'
import { listPositions, removePosition } from './positions'
import { sendEmail } from './email'
import { reconcileManualSellsEOD } from './cronReconcile'
import { estimateBacktestCharges } from './backtest'
import {
  istHHMM, istDateKey, maybeRollDay, isMarketDay,
  recordExecuted, recordFailed,
} from './cronState'

// Prevents squareOffEOD from firing twice for the same strategy on the same
// calendar day (key=strategyId, value=YYYY-MM-DD IST date key).
let eodSquareOffDone: Record<string, string> = {}

// ──────── EOD SQUARE-OFF (momentum strategies) ────────
//
// Runs inside each 5-min tick after exitSameDayTime (default 15:10 IST).
// Two modes (non-exclusive):
//   squareOffEOD=true          → sell everything regardless of P&L once per day
//                                (bypasses no-loss gate)
//   exitSameDayOnPositive=true → on every tick from exitSameDayTime onward,
//                                sell positions where estimated net P&L after
//                                charges is still positive

function estimateExitNetPnl(firstBuyAt: string, entryPrice: number, exitPrice: number, qty: number): number {
  const buyValue = entryPrice * qty
  const sellValue = exitPrice * qty
  const mode: 'intraday' | 'delivery' = firstBuyAt.slice(0, 10) === istDateString() ? 'intraday' : 'delivery'
  const estimatedCharges = estimateBacktestCharges(mode, buyValue, sellValue, sellValue > 0 ? 1 : 0)
  const grossPnl = sellValue - buyValue
  return Number((grossPnl - estimatedCharges).toFixed(2))
}

export async function runEODSquareOff(): Promise<void> {
  const t = istHHMM()
  const today = istDateKey()
  const todayYmd = istDateString()
  const state = await getState()
  if (state.mode !== 'auto') return

  // Used to recover momentum-owned intent when a same-day BUY on the same
  // symbol was later stamped under a different owner in the unified store.
  // We only consider today's BUY orders, so long-held accumulator positions
  // are unaffected.
  const todayJournal = await readJournalDay(todayYmd).catch(() => [])

  const strategies = getActiveStrategies().filter(s => s.type === 'momentum')
  for (const strategy of strategies) {
    const mParams = asMomentumParams(strategy)
    const squareOffEOD: boolean = mParams.squareOffEOD === true
    const exitOnPositive: boolean = mParams.exitSameDayOnPositive === true
    if (!squareOffEOD && !exitOnPositive) continue

    const exitTime: string = typeof mParams.exitSameDayTime === 'string' ? mParams.exitSameDayTime : '15:10'
    if (t < exitTime) continue
    if (squareOffEOD && eodSquareOffDone[strategy.id] === today) continue

    // Mark done immediately to prevent re-entry if any await below takes time.
    // Positive-only exits intentionally keep checking on each later 5-min tick.
    if (squareOffEOD) eodSquareOffDone[strategy.id] = today
    console.log(`[cron eod] ${t} IST — ${strategy.id}: running EOD square-off (squareOffEOD=${squareOffEOD}, exitOnPositive=${exitOnPositive})`)

    const accounts = getAccountList()
    const targetAccounts = Object.keys(state.kiteTokens)
    for (const account of targetAccounts) {
      const displayName = accounts.find(a => a.name === account)?.displayName
      const creds = await resolveAccountCreds(account)
      if (!creds.ok) {
        console.warn(`[cron eod] ${strategy.id} ${account}: creds not available — skipping`)
        continue
      }
      const broker = getBroker({ brokerName: 'zerodha', brokerCredentials: { apiKey: creds.apiKey, accessToken: creds.accessToken } })

      const strategyPositions = await listPositions({ account, strategyId: strategy.id })
      const accountPositions = await listPositions({ account })

      const seen = new Set(strategyPositions.map(p => p.symbol.toUpperCase()))
      const momentumBoughtToday = new Set(
        (todayJournal as Array<any>)
          .filter((r): r is OrderRecord => r?.type === 'order')
          .filter(r => r.account.toUpperCase() === account.toUpperCase())
          .filter(r => r.side === 'BUY' && r.strategyId === strategy.id)
          .map(r => r.symbol.toUpperCase())
      )

      const recovered = accountPositions.filter(p => {
        const sym = p.symbol.toUpperCase()
        if (seen.has(sym)) return false
        if (!momentumBoughtToday.has(sym)) return false
        return p.remainingQty > 0
      })

      const positions = [...strategyPositions, ...recovered]
      if (positions.length === 0) continue

      const symbols = positions.map(p => p.symbol.toUpperCase())  // getQuotes adds NSE: internally
      const quotes = await getQuotes(creds, symbols)

      for (const pos of positions) {
        const quoteKey = `NSE:${pos.symbol.toUpperCase()}`
        const ltp: number | undefined = quotes[quoteKey]?.last_price
        if (ltp === undefined) {
          console.warn(`[cron eod] ${strategy.id} ${account} ${pos.symbol}: no LTP — skipping`)
          continue
        }

        const estimatedNetPnl = estimateExitNetPnl(pos.firstBuyAt, pos.firstBuyPrice, ltp, pos.remainingQty)
        const shouldSell = squareOffEOD || (exitOnPositive && estimatedNetPnl > 0)
        if (!shouldSell) continue

        const qty = pos.remainingQty
        const pre = await runPreflight({
          account, symbol: pos.symbol, side: 'SELL',
          quantity: qty, pricePerShare: ltp,
          strategyId: strategy.id,
          bypassNoLossSell: squareOffEOD,
        }, broker)
        const sellQty = pre.adjustedQty ?? qty
        if (!pre.ok) {
          recordFailed({ time: t, account, symbol: pos.symbol, side: 'SELL', quantity: sellQty, reason: `[${pre.gate}] ${pre.reason}` })
          continue
        }

        const placed = await placeKiteOrder(creds, { symbol: pos.symbol, side: 'SELL', quantity: sellQty, tag: `dt-eod-${strategy.id}` })
        if (placed.ok && placed.data?.data?.order_id) {
          await markPlaced(account, pos.symbol, 'SELL')
          await journalOrder({
            account,
            symbol: pos.symbol,
            side: 'SELL',
            qty: sellQty,
            price: ltp,
            tag: `dt-eod-${strategy.id}`,
            strategyId: strategy.id,
            orderId: placed.data.data.order_id,
            source: 'auto',
          }).catch(err => console.error('[cron eod] journalOrder failed:', err))
          await removePosition(account, pos.symbol)
          recordExecuted({ time: t, account, symbol: pos.symbol, side: 'SELL', quantity: sellQty, price: ltp, orderId: placed.data.data.order_id, reason: squareOffEOD ? 'EOD square-off' : 'EOD exit on positive' })
          sendEmail('trade_executed', {
            account, accountDisplayName: displayName, symbol: pos.symbol,
            side: 'SELL', quantity: sellQty, price: ltp,
            orderId: placed.data.data.order_id,
            reason: squareOffEOD ? `EOD square-off (${strategy.name})` : `EOD exit on positive (${strategy.name}) · est. net ${estimatedNetPnl >= 0 ? '+' : ''}${estimatedNetPnl.toFixed(2)} after charges`,
            mode: 'auto',
          }).catch(err => console.error('[cron eod] email failed:', err))
        } else {
          const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
          recordFailed({ time: t, account, symbol: pos.symbol, side: 'SELL', quantity: sellQty, price: ltp, reason: errMsg })
        }
      }
    }
  }
}

// ──────── DAILY RETROSPECTIVE (15:35 IST) ────────
//
// Replaces the old plain-text EOD summary. Builds a journal-backed report
// (today's trades + missed signals + 30-day rolling stats + fine-tuning
// bullets), enriches with live Kite OHLC so finalDayHigh/leftOnTable reflect
// the full session, and emails it as an HTML report.
//
// Skip rules (per spec):
//   - weekend or NSE holiday        → skip
//   - no trades AND no signals      → skip ("no empty reports")
//   - SMTP not configured           → skip with warning
//
// On the last trading day of the month we additionally fire a monthly rollup.

export async function dailyRetrospective(toEmail?: string): Promise<void> {
  maybeRollDay()
  if (!(await isMarketDay())) {
    console.log('[cron retro] not a market day — skipping')
    return
  }

  // Final EOD sweep — closes any positions sold manually during the day.
  // Runs here (15:35) so closing LTPs are available as the fallback price for
  // prior-day sells where no today's order is found. Phase 5 fix (spec §10.1):
  // this synthetic-close sweep (Case 2) is now ONLY invoked from this single
  // daily call site — never from the 5-min tick — see lib/cronReconcile.ts
  // header comment for the full root-cause fix.
  try { await reconcileManualSellsEOD() } catch (err) { console.error('[cron retro] reconcile manual sells (EOD) failed:', err) }

  if (!isEmailConfigured()) {
    console.warn('[cron retro] SMTP not configured — skipping')
    return
  }

  const today = istDateString()
  try {
    const report = await buildDailyReport(today)
    // Always send on a trading day. Even with zero trades, the report acts as
    // a "daily diary": shows open positions, capital status, strategy health,
    // and confirms the engine ran (or that you stayed in manual mode all day).
    console.log(`[cron retro] ${today} — sending daily report: ${report.tradesCount} trades, ${report.missedSignals.length} missed signals to ${toEmail || 'NOTIFY_TO'}`)
    const emailResult = toEmail 
      ? await sendDailyReportToEmail(report, toEmail)
      : await sendDailyReport(report)
    if (!emailResult.ok) {
      console.error(`[cron retro] daily report email failed: ${emailResult.error || (emailResult.skipped ? 'SMTP not configured — check SMTP_USER/SMTP_PASS env vars' : 'unknown')}`)
    }
  } catch (err) {
    console.error('[cron retro] daily report failed:', err)
  }

  // Monthly rollup — fire on the last trading day of the month, even if today's
  // daily report was skipped (the month may have plenty of activity earlier).
  if (isLastWeekdayOfMonth(today)) {
    try {
      const monthly = await buildMonthlyReport(today)
      if (monthly.totalTrades === 0 && monthly.signalsMissed === 0) {
        console.log(`[cron retro] ${today} — last trading day, but month had zero activity — skipping monthly`)
      } else {
        console.log(`[cron retro] ${today} — sending monthly rollup for ${monthly.monthLabel}: ${monthly.totalTrades} trades to ${toEmail || 'NOTIFY_TO'}`)
        const monthlyResult = toEmail
          ? await sendMonthlyReportToEmail(monthly, toEmail)
          : await sendMonthlyReport(monthly)
        if (!monthlyResult.ok) {
          console.error(`[cron retro] monthly report email failed: ${monthlyResult.error}`)
        }
      }
    } catch (err) {
      console.error('[cron retro] monthly rollup failed:', err)
    }
  }
}
