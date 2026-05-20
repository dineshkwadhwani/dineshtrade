// Panic-sell detector. Catches news-driven free-falls so the strategies don't
// catch a falling knife. Distinct from the pyramid gate (which limits stacking
// into an open position) and the intraday circuit (which gates on Nifty index).
//
// Detection: max HIGH in the last N 5-min candles vs current LTP. A 3% drop
// over 15 minutes (3 × 5-min bars) is a typical panic signature — distinct
// from a slow morning bleed that mean-reversion strategies legitimately enter.
//
// Once a symbol trips, it's added to state.panicSkipList for the rest of the
// IST day. The skip list survives PM2 restarts via state.json persistence.
//
// Failure mode: if we can't fetch candles (no token, Kite error, cold cache),
// we ALLOW the trade and log a warning. The gate is a safety override, not a
// primary check — measurement failure shouldn't silently block all trades.

import { getHistoricalCandles, type KiteCreds } from './kite'
import { getInstrumentToken } from './instruments'
import { addPanicSkip, isPanicSkipped, getState } from './state'
import { getCapital } from './strategyConfig'
import { istDateString } from './journal'

export interface PanicCheckResult {
  panic: boolean              // true = symbol is in panic (gate should reject)
  reason?: string             // populated when panic === true OR measurement failed
  dropPct?: number            // measured drop, if available
  windowHigh?: number         // peak HIGH in the window
  ltp?: number                // the current LTP used for comparison
}

// Window must be a positive multiple of 5 minutes (matches the 5-min candle
// granularity we use everywhere). 5, 10, 15, 20, 25, 30 are the practical
// values; anything else gets rounded up to the next multiple of 5.
function candlesNeeded(panicWindowMin: number): number {
  const m = Math.max(5, Math.ceil(panicWindowMin / 5) * 5)
  return Math.max(1, Math.floor(m / 5))
}

export async function checkPanicSell(
  creds: KiteCreds,
  symbol: string,
  ltp: number,
): Promise<PanicCheckResult> {
  const cap = getCapital()
  const dropPctThreshold = cap.panicDropPct ?? 0
  const windowMin = cap.panicWindowMin ?? 0

  // Feature disabled
  if (dropPctThreshold <= 0 || windowMin <= 0) return { panic: false }

  // Already on today's skip list? Fast-path, no Kite call.
  const state = await getState()
  if (isPanicSkipped(state, symbol)) {
    return {
      panic: true,
      reason: `${symbol} is on today's panic-sell skip list (detected earlier)`,
    }
  }

  const n = candlesNeeded(windowMin)

  // Fetch the last N candles of today's 5-min stream
  let candles
  try {
    const token = await getInstrumentToken(creds, symbol)
    if (!token) {
      console.warn(`[panicSell] ${symbol}: no instrument token — allowing trade`)
      return { panic: false, reason: 'no instrument token' }
    }
    const from = `${istDateString()} 09:15:00`
    const to = `${istDateString()} 15:30:00`
    candles = await getHistoricalCandles(creds, token, from, to, '5minute')
  } catch (err) {
    console.warn(`[panicSell] ${symbol}: candle fetch failed — allowing trade. ${String(err).slice(0, 200)}`)
    return { panic: false, reason: 'candle fetch failed' }
  }

  if (!candles || candles.length === 0) {
    // Pre-9:15 or cold-cache — no panic data, allow.
    return { panic: false, reason: 'no candle data yet' }
  }

  // Take the last N candles (may be fewer if we're early in the session)
  const window = candles.slice(-n)
  const peak = window.reduce((max, c) => Math.max(max, c.high), 0)
  if (peak <= 0) return { panic: false, reason: 'invalid candle data' }

  const dropPct = ((peak - ltp) / peak) * 100

  if (dropPct >= dropPctThreshold) {
    // Panic detected — add to sticky skip list for the rest of the day.
    await addPanicSkip(symbol)
    console.warn(`[panicSell] ${symbol} TRIPPED: dropped ${dropPct.toFixed(2)}% from ₹${peak.toFixed(2)} → ₹${ltp.toFixed(2)} in last ${window.length * 5}min`)
    return {
      panic: true,
      dropPct,
      windowHigh: peak,
      ltp,
      reason: `${symbol} dropped ${dropPct.toFixed(2)}% (peak ₹${peak.toFixed(2)} → ₹${ltp.toFixed(2)}) in last ${window.length * 5}min — looks like a news-driven panic-sell. Skipped for the rest of today.`,
    }
  }

  return { panic: false, dropPct, windowHigh: peak, ltp }
}
