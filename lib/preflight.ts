// Pre-flight gates that must pass before we POST an order to Kite.
// Six gates per spec (CONTEXT.md): token, market-open, day-quota, open-positions,
// funds-available, idempotency. Phase 2 will add a seed-from-Kite on cron startup.

import { getState, recordIdempotency, makeIdempotencyKey, getBuyHistory, resetBuyHistoryForSymbol, recordBuyHistory, setBuyHistoryForSymbol } from '@/lib/state'
import { getCapital, getStrategyById, asDipParams } from '@/lib/strategyConfig'
import { resolveAccountCreds } from '@/lib/kite'
import { istDateString, readJournalRange, type JournalRecord } from '@/lib/journal'
import { isMarketOpen } from '@/lib/market'
import { checkIntradayCircuit } from '@/lib/intradayCircuit'
import { checkPanicSell } from '@/lib/panicSell'
import { getFixedRules } from '@/lib/fixedRules'
import type { IBroker, BrokerHolding, BrokerOrder, BrokerPositions } from '@/lib/broker'

// Idempotency ledger now lives in state.json (see lib/state.ts) — persistent
// across PM2 restarts, shared by every code path. Old days are pruned by
// normalize() at read time, so we don't need an in-process prune here.

async function recoverBuyHistoryFromJournal(account: string, symbol: string, heldQty: number): Promise<Array<{ price: number; ts: string }>> {
  if (heldQty <= 0) return []

  const lookbackStart = new Date()
  lookbackStart.setDate(lookbackStart.getDate() - 120)

  const records = await readJournalRange(istDateString(lookbackStart), istDateString()).catch(() => [] as JournalRecord[])
  const relevant = records
    .filter((record): record is Extract<JournalRecord, { type: 'order' }> => record.type === 'order')
    .filter(record => record.account.toUpperCase() === account.toUpperCase())
    .filter(record => record.symbol.toUpperCase() === symbol.toUpperCase())
    .sort((a, b) => a.ts.localeCompare(b.ts))

  let qtyToExplain = heldQty
  const recovered: Array<{ price: number; ts: string }> = []

  for (let index = relevant.length - 1; index >= 0 && qtyToExplain > 0; index -= 1) {
    const record = relevant[index]
    if (record.side === 'SELL') {
      qtyToExplain += record.qty
      continue
    }
    if (record.source !== 'auto') continue
    recovered.push({ price: record.price, ts: record.ts })
    qtyToExplain -= record.qty
  }

  return qtyToExplain > 0 ? [] : recovered.reverse()
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}

function estimateExitCharges(mode: 'intraday' | 'delivery', buyValue: number, sellValue: number): number {
  const cap = getCapital()
  const turnover = buyValue + sellValue
  const brokerage = mode === 'intraday'
    ? Math.min(20, buyValue * 0.0003) + (sellValue > 0 ? Math.min(20, sellValue * 0.0003) : 0)
    : 0
  const stt = mode === 'intraday'
    ? sellValue * 0.00025
    : sellValue * 0.001
  const exchange = turnover * 0.0000297
  const sebi = turnover * 0.000001
  const gst = (brokerage + exchange + sebi) * 0.18
  const stamp = buyValue * (mode === 'intraday' ? 0.00003 : 0.00015)
  const dp = mode === 'delivery' && sellValue > 0 ? cap.deliveryDpCharge : 0
  return round2(brokerage + stt + exchange + sebi + gst + stamp + dp)
}

export interface PreflightInput {
  account: string
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  pricePerShare: number
  // Optional lot-level buy price for SELL preflight. When provided, the no-loss
  // gate evaluates P&L against this basis instead of Kite's average held price.
  buyPricePerShare?: number
  // Strategy id — used by the sector concentration gate. Optional; absent means
  // skip sector gate (e.g. manual orders, legacy callers).
  strategyId?: string
  // When true, user is placing an explicit manual order via the UI. Skip the
  // rate-limit gates (per-trade cap, idempotency, day quota, position cap,
  // no-loss-sell). Only the essential safety gates apply:
  //   - token connected
  //   - market open
  //   - BUY: funds available
  //   - SELL: noShort (with qty clamping)
  manual?: boolean
  // When true, GATE 9 (no-loss sell) is skipped even in auto mode. Used by
  // squareOffEOD — it must sell regardless of P&L at end of day.
  bypassNoLossSell?: boolean
  // Explicit audited reasons for bypassing the no-loss gate. Prefer this over
  // the raw boolean for new flows so callers state why the override exists.
  bypassNoLossSellReason?: 'squareOffEOD' | 'pivotalStopLoss'
}

export interface PreflightResult {
  ok: boolean
  reason?: string
  gate?: string
  // SELL only — when set, caller MUST use this quantity instead of the originally
  // requested one (held quantity in Kite is less than requested, so we clamp down
  // to avoid short-selling). null if no adjustment needed.
  adjustedQty?: number
}

export async function runPreflight(input: PreflightInput, broker: IBroker): Promise<PreflightResult> {
  const { account, symbol, side, quantity, pricePerShare, manual } = input
  const tradeValue = pricePerShare * quantity

  // GATE 1 — token connected (V1 env-named accounts + V2 broker_accounts/DB accounts)
  const creds = await resolveAccountCreds(account)
  if (!creds.ok) return { ok: false, gate: 'token', reason: creds.error }
  const { apiKey, accessToken } = creds
  const state = await getState()

  // GATE 2 — market open + not holiday
  const market = await isMarketOpen()
  if (!market.open) return { ok: false, gate: 'market', reason: `Market closed: ${market.status}` }

  // Capital config from the RUNTIME overlay (data/strategy.json) — user edits
  // in Settings → Strategies land here. Never read from `strategyCfg.*` for
  // any field the user can edit; that's the bundled config-on-disk and ignores
  // overlays.
  const cap = getCapital()

  // GATE 2b — intraday circuit (auto BUYs only). Live NIFTY 50 vs today's open,
  // hysteresis trip/resume. Skipped for SELLs (you want exits even on a crash)
  // and manual orders (your judgement).
  if (!manual && side === 'BUY') {
    const ic = await checkIntradayCircuit()
    if (ic.enabled && ic.tripped) {
      return { ok: false, gate: 'intradayCircuit', reason: ic.reason || 'Intraday circuit tripped' }
    }
  }

  // GATE 3 — per-trade cap (BUY only). Skipped for explicit manual orders.
  if (!manual && side === 'BUY' && tradeValue > cap.perTrade) {
    return { ok: false, gate: 'perTrade', reason: `Trade value ₹${Math.round(tradeValue)} exceeds per-trade cap ₹${cap.perTrade}` }
  }

  // GATE 4 — idempotency for BUYs only. Prevents double-buying the same symbol
  // across multiple cron ticks. SELLs are NOT idempotent — Strategy 1 deliberately
  // sells in two tranches (potentially same day), and the noShort gate below
  // prevents accidental over-sells. Skipped for explicit manual orders.
  //
  // Reads from state.json (persistent, survives PM2 restarts). The key is
  // uppercased so 'itc' and 'ITC' match. Re-fetching state INSIDE this gate
  // (not relying on the older 'state' variable above) ensures we see the
  // most recent ledger write — important when two cron ticks fire back-to-back.
  if (!manual && side === 'BUY') {
    const fresh = await getState()
    const key = makeIdempotencyKey(account, symbol, 'BUY')
    if (fresh.idempotencyLedger[key]) {
      return { ok: false, gate: 'idempotency', reason: `${account}: already bought ${symbol} earlier today` }
    }
  }

  // GATE 4b — panic-sell: catch news-driven free-falls before the pyramid
  // gate's expensive Kite calls. Sticky for the day — once a symbol is
  // detected as panic-selling, all subsequent auto-BUY attempts on it skip
  // until the next IST day. Skipped for manual orders (your judgement).
  if (!manual && side === 'BUY') {
    const ps = await checkPanicSell({ apiKey, accessToken }, symbol, pricePerShare)
    if (ps.panic) {
      return { ok: false, gate: 'panicSell', reason: ps.reason || `${symbol}: panic-sell detected` }
    }
  }

  // GATE 4c — pyramid: limits averaging-down behaviour in auto mode.
  //   Max N BUYs per symbol (default 3); each subsequent BUY requires LTP to
  //   be at least `minDropBetweenBuysPct`% below the previous BUY price.
  // The buy-history is auto-reset for a symbol when Kite shows zero qty (the
  // previous position has been fully exited) — so once you sell out, the
  // pyramid starts fresh on the next entry. Persists across days.
  // Skipped for manual orders.
  if (!manual && side === 'BUY') {
    const maxBuys = cap.maxBuysPerSymbol
    const minDropPct = cap.minDropBetweenBuysPct
    // Check current held qty in Kite. If 0, reset the history before reading.
    const pyramidPositions = await broker.getPositions().catch(() => ({ net: [], day: [] }) as BrokerPositions)
    const pyramidHoldings  = await broker.getHoldings().catch(() => [] as BrokerHolding[])
    let heldQty = 0
    for (const p of pyramidPositions.net) {
      if (p.symbol.toUpperCase() === symbol.toUpperCase()) heldQty += (p.quantity || 0)
    }
    for (const h of pyramidHoldings) {
      if (h.symbol.toUpperCase() === symbol.toUpperCase()) heldQty += (h.quantity || 0) + (h.t1Quantity || 0)
    }
    if (heldQty <= 0) {
      // No open position — clear any stale history for this symbol
      await resetBuyHistoryForSymbol(account, symbol)
    } else {
      const fresh2 = await getState()
      let history = getBuyHistory(fresh2, account, symbol)
      try {
        // Keep pyramid history aligned with the tagged open position. This
        // avoids stale anchors when a symbol is re-seeded/re-tagged (for
        // example after manual lifecycle transitions).
        const { getPosition, listPositionLots } = await import('@/lib/positions')
        const pos = await getPosition(account, symbol)
        if (pos) {
          let canonical: Array<{ price: number; ts: string }> = []
          const lots = await listPositionLots(pos).catch(() => [])
          const openLots = lots
            .filter(lot => (lot.remainingQty || 0) > 0)
            .sort((a, b) => a.boughtAt.localeCompare(b.boughtAt))
          if (openLots.length > 0) {
            canonical = openLots.map(lot => ({ price: lot.entryPrice, ts: lot.boughtAt }))
          } else if (pos.firstBuyPrice > 0) {
            canonical = [{ price: pos.firstBuyPrice, ts: pos.firstBuyAt || new Date().toISOString() }]
          }

          const sameAsCanonical =
            canonical.length === history.length &&
            canonical.every((entry, i) => Math.abs((history[i]?.price || 0) - entry.price) < 0.0001)

          if (canonical.length > 0 && !sameAsCanonical) {
            await setBuyHistoryForSymbol(account, symbol, canonical)
            history = getBuyHistory(await getState(), account, symbol)
          }
        }
      } catch {
        // Non-fatal; fall back to existing history/journal recovery path.
      }

      if (history.length === 0) {
        const recovered = await recoverBuyHistoryFromJournal(account, symbol, heldQty)
        if (recovered.length > 0) {
          for (const entry of recovered) {
            await recordBuyHistory(account, symbol, entry.price)
          }
          history = getBuyHistory(await getState(), account, symbol)
        }
      }
      if (history.length >= maxBuys) {
        return { ok: false, gate: 'pyramid', reason: `${account}: already ${history.length} BUYs of ${symbol} on the current position (cap ${maxBuys})` }
      }
      if (history.length > 0) {
        const lastPrice = history[history.length - 1].price
        const requiredCeiling = lastPrice * (1 - minDropPct / 100)
        if (pricePerShare > requiredCeiling) {
          return {
            ok: false, gate: 'pyramid',
            reason: `${account}: ${symbol} at ₹${pricePerShare.toFixed(2)} — must be ≤ ₹${requiredCeiling.toFixed(2)} (${minDropPct}% below previous BUY @ ₹${lastPrice.toFixed(2)})`,
          }
        }
      }
    }
  }

  // GATE 4d — sector concentration (auto BUYs with a strategyId only).
  // Blocks new BUYs when DineshTrade-tracked open positions in the same sector
  // already reach the strategy's maxPerSector cap. Gate is skipped when:
  //   - manual order
  //   - no strategyId provided
  //   - strategy is not type 'dip' or has no maxPerSector set
  //   - symbol's sector is unknown in the watchlist
  if (!manual && side === 'BUY' && input.strategyId) {
    const strategy = getStrategyById(input.strategyId)
    const maxPerSector = strategy?.type === 'dip'
      ? asDipParams(strategy).maxPerSector
      : undefined
    if (typeof maxPerSector === 'number' && maxPerSector > 0) {
      const { getWatchlist } = await import('@/lib/watchlistStore')
      const wl = await getWatchlist()
      const symbolSectors = new Map<string, string>()
      for (const entries of Object.values(wl.lists)) {
        for (const e of entries) {
          if (e.sector) symbolSectors.set(e.nse.toUpperCase(), e.sector)
        }
      }
      const thisSector = symbolSectors.get(symbol.toUpperCase())
      if (thisSector) {
        const { listPositions } = await import('@/lib/positions')
        const positions = await listPositions()
        const sectorCount = positions.filter(
          p => p.account === account && symbolSectors.get(p.symbol.toUpperCase()) === thisSector
        ).length
        if (sectorCount >= maxPerSector) {
          return {
            ok: false, gate: 'sectorConcentration',
            reason: `${account}: already ${sectorCount}/${maxPerSector} positions in sector "${thisSector}" (${symbol})`,
          }
        }
      }
    }
  }

  // GATE 5 — day buy/sell quota (via getOrders). Skipped for explicit manual orders.
  if (!manual) {
    // null (not []) means the broker call itself failed — gate is skipped in
    // that case, matching the old kiteGet()-returns-null behaviour. A
    // successful empty order list still runs the quota check below.
    let orders: BrokerOrder[] | null = null
    try { orders = await broker.getOrders() } catch { orders = null }
    if (orders) {
      const completed = orders.filter(o => o.status === 'COMPLETE')
      const buys = completed.filter(o => o.side === 'BUY').length
      const sells = completed.filter(o => o.side === 'SELL').length
      const maxBuys = cap.maxBuysPerDay
      const maxSells = cap.maxSellsPerDay
      const netBuys = buys - sells  // sells free up a slot — keeps open positions in check
      if (side === 'BUY' && netBuys >= maxBuys) {
        return { ok: false, gate: 'quota', reason: `${account}: net buys today ${netBuys}/${maxBuys} (${buys} buys − ${sells} sells)` }
      }
      if (side === 'SELL' && sells >= maxSells) {
        return { ok: false, gate: 'quota', reason: `${account}: already ${sells}/${maxSells} sells today` }
      }
    }
  }

  // GATE 6 — open positions < maxPositions (BUY only). Skipped for manual orders.
  if (!manual && side === 'BUY') {
    const [holdings, positions] = await Promise.all([
      broker.getHoldings().catch(() => [] as BrokerHolding[]),
      broker.getPositions().catch(() => ({ net: [], day: [] }) as BrokerPositions),
    ])
    const openSymbols = new Set<string>()

    for (const h of holdings) {
      const heldQty = Number(h?.quantity || 0) + Number(h?.t1Quantity || 0)
      const symbol = String(h?.symbol || '').toUpperCase()
      if (heldQty > 0 && symbol) openSymbols.add(symbol)
    }

    for (const p of positions.net) {
      const qty = Number(p?.quantity || 0)
      const symbol = String(p?.symbol || '').toUpperCase()
      if (qty !== 0 && symbol) openSymbols.add(symbol)
    }

    const totalOpen = openSymbols.size
    const maxOpen = cap.maxPositions
    if (totalOpen >= maxOpen) {
      return { ok: false, gate: 'positions', reason: `${account}: ${totalOpen}/${maxOpen} positions already open` }
    }
  }

  // GATE 7 — funds available (BUY only)
  if (side === 'BUY') {
    const margins = await broker.getMargins().catch(() => ({ available: 0, used: 0 }))
    const available = margins.available
    if (available < tradeValue) {
      return { ok: false, gate: 'funds', reason: `${account}: ₹${Math.round(available)} available, need ₹${Math.round(tradeValue)}` }
    }
  }

  // GATE 8 — Short-sell guard. Applies to ALL SELLs (Auto and Manual), unless
  // the SuperAdmin has disabled it platform-wide via Fixed Rules
  // (no_short_selling — spec §7.8). Fetches live held quantity from Kite
  // (holdings + day positions). Three outcomes when enabled:
  //   - held == 0    → reject with gate='noShort' (position manually closed or never held)
  //   - held < want  → ok with adjustedQty=held (caller must use this clamped quantity)
  //   - held >= want → ok, no adjustment
  const fixedRules = await getFixedRules()
  let sellAdjustedQty: number | undefined = undefined
  if (side === 'SELL') {
    const [holdings, positions] = await Promise.all([
      broker.getHoldings().catch(() => [] as BrokerHolding[]),
      broker.getPositions().catch(() => ({ net: [], day: [] }) as BrokerPositions),
    ])
    const sym = symbol.toUpperCase()
    const eq = (s: string | undefined) => String(s).toUpperCase() === sym
    const holding = holdings.find(h => eq(h.symbol))
    const dayPos  = positions.day.find(p => eq(p.symbol))
    // Holdings already reflect the REMAINING delivery quantity after any same-day
    // CNC sells. Day positions can simultaneously show a negative quantity for the
    // sold leg; subtracting that from holdings turns a real remaining holding into
    // a phantom zero and blocks the second exit leg. Only positive day qty adds
    // extra sellable stock beyond holdings (e.g. same-day T0 long buys).
    const heldQty = Number(holding?.quantity || 0) + Number(holding?.t1Quantity || 0)
    const dayQty  = Number(dayPos?.quantity || 0)
    const available = heldQty + Math.max(0, dayQty)

    if (fixedRules.noShortSelling) {
      if (available <= 0) {
        return {
          ok: false, gate: 'noShort',
          reason: `${account}: not holding ${symbol} — short selling blocked (position may have been closed manually in Kite)`,
        }
      }
      if (quantity > available) {
        sellAdjustedQty = available
        console.warn(`[preflight] ${account} ${symbol}: clamping SELL ${quantity} → ${available} (live held)`)
      }
    }

    // GATE 9 — Auto-mode never sells at a net loss after estimated charges
    // (Fixed Rule no_loss_sell_auto — spec §7.8; SuperAdmin-configurable).
    // Manual mode lets you override.
    // Also skipped for explicit manual orders (user knows what they're doing).
    // Also skipped when bypassNoLossSell=true (used by squareOffEOD).
    if (fixedRules.noLossSellAuto && state.mode === 'auto' && !manual && !input.bypassNoLossSell && !input.bypassNoLossSellReason) {
      const avgCandidates = [holding?.averagePrice, dayPos?.averagePrice, dayPos?.dayBuyPrice]
        .map(v => Number(v))
        .filter(v => Number.isFinite(v) && v > 0)
      const ltpCandidates = [holding?.lastPrice, dayPos?.lastPrice, pricePerShare]
        .map(v => Number(v))
        .filter(v => Number.isFinite(v) && v > 0)
      const avg = avgCandidates[0] ?? 0
      const ltp = ltpCandidates[0] ?? 0
      const basis = input.buyPricePerShare && input.buyPricePerShare > 0 ? input.buyPricePerShare : avg
      const basisLabel = input.buyPricePerShare ? 'basis' : 'avg'
      const evalQty = Math.max(1, Math.floor(sellAdjustedQty ?? quantity))
      if (basis <= 0 || ltp <= 0) {
        return {
          ok: false,
          gate: 'noLossSell',
          reason: `${account}: ${symbol} — unable to verify no-loss exit (${basisLabel}=${basis}, ltp=${ltp}); blocking auto SELL`,
        }
      }
      if (basis > 0 && ltp > 0 && evalQty > 0) {
        const model: 'intraday' | 'delivery' = heldQty > 0 ? 'delivery' : 'intraday'
        const buyValue = basis * evalQty
        const sellValue = ltp * evalQty
        const grossPnl = sellValue - buyValue
        const estimatedCharges = estimateExitCharges(model, buyValue, sellValue)
        const netPnl = round2(grossPnl - estimatedCharges)
        if (netPnl < 0) {
          const lossPct = ((basis - ltp) / basis * 100).toFixed(2)
          const netLoss = Math.abs(netPnl).toFixed(2)
          const gross = round2(grossPnl).toFixed(2)
          const charges = estimatedCharges.toFixed(2)
          return {
            ok: false,
            gate: 'noLossSell',
            reason: `${account}: ${symbol} at ₹${ltp.toFixed(2)} vs ${basisLabel} ₹${basis.toFixed(2)} (${lossPct.startsWith('-') ? '' : ltp >= basis ? '+' : '−'}${Math.abs(Number(lossPct)).toFixed(2)}%) — estimated ${model} net P&L is -₹${netLoss} (gross ₹${gross}, charges ₹${charges})`,
          }
        }
      }

      if (basis > 0 && ltp > 0 && ltp < basis) {
        const lossPct = ((basis - ltp) / basis * 100).toFixed(2)
        return {
          ok: false, gate: 'noLossSell',
          reason: `${account}: ${symbol} at ₹${ltp} vs ${basisLabel} ₹${basis} (−${lossPct}%) — Auto mode never sells at a loss`,
        }
      }
    }
  }

  return { ok: true, adjustedQty: sellAdjustedQty }
}

// Called after a successful place_order to record the trade in the persistent
// ledger so the next scan/click — even after a PM2 restart — won't duplicate
// it. ALWAYS await this from the calling code so the write completes before
// the next cron tick fires.
//
// For auto-mode BUYs, also appends the fill price to the per-symbol buy
// history (pyramid gate). Manual orders are excluded so pyramid bookkeeping
// only reflects the auto engine's accumulating decisions.
export async function markPlaced(
  account: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  opts?: { price?: number; manual?: boolean },
): Promise<void> {
  try {
    await recordIdempotency(account, symbol, side)
  } catch (err) {
    console.error(`[preflight] CRITICAL: failed to persist idempotency for ${account} ${symbol} ${side}:`, err)
  }
  if (side === 'BUY' && !opts?.manual && typeof opts?.price === 'number' && opts.price > 0) {
    try {
      await recordBuyHistory(account, symbol, opts.price)
    } catch (err) {
      console.error(`[preflight] failed to record buy history for ${account} ${symbol}:`, err)
    }
  }
}
