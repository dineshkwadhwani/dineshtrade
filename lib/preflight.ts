// Pre-flight gates that must pass before we POST an order to Kite.
// Six gates per spec (CONTEXT.md): token, market-open, day-quota, open-positions,
// funds-available, idempotency. Phase 2 will add a seed-from-Kite on cron startup.

import { getState, recordIdempotency, makeIdempotencyKey, getBuyHistory, resetBuyHistoryForSymbol } from '@/lib/state'
import { getCapital, getStrategyById } from '@/lib/strategyConfig'
import { getAccountSecrets } from '@/lib/accounts'
import { isMarketOpen } from '@/lib/market'
import { checkIntradayCircuit } from '@/lib/intradayCircuit'
import { checkPanicSell } from '@/lib/panicSell'

const KITE_BASE = 'https://api.kite.trade'

// Idempotency ledger now lives in state.json (see lib/state.ts) — persistent
// across PM2 restarts, shared by every code path. Old days are pruned by
// normalize() at read time, so we don't need an in-process prune here.

async function kiteGet<T = any>(path: string, apiKey: string, accessToken: string): Promise<T | null> {
  try {
    const res = await fetch(`${KITE_BASE}${path}`, {
      headers: { 'X-Kite-Version': '3', Authorization: `token ${apiKey}:${accessToken}` },
    })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

export interface PreflightInput {
  account: string
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  pricePerShare: number
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

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const { account, symbol, side, quantity, pricePerShare, manual } = input
  const tradeValue = pricePerShare * quantity

  // GATE 1 — token connected
  const state = await getState()
  const accessToken = state.kiteTokens[account]
  if (!accessToken) return { ok: false, gate: 'token', reason: `${account}: not connected — connect in Settings` }

  const secrets = getAccountSecrets(account)
  if (!secrets) return { ok: false, gate: 'token', reason: `${account}: API credentials missing in env` }
  const { apiKey } = secrets

  // GATE 2 — market open + not holiday
  const market = isMarketOpen()
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
    const positionsJson = await kiteGet<{ data?: { net?: any[]; day?: any[] } }>('/portfolio/positions', apiKey, accessToken)
    const holdingsJson  = await kiteGet<{ data?: any[] }>('/portfolio/holdings', apiKey, accessToken)
    let heldQty = 0
    for (const p of (positionsJson?.data?.net || [])) {
      if (p.tradingsymbol?.toUpperCase() === symbol.toUpperCase()) heldQty += (p.quantity || 0)
    }
    for (const h of (holdingsJson?.data || [])) {
      if (h.tradingsymbol?.toUpperCase() === symbol.toUpperCase()) heldQty += (h.quantity || 0)
    }
    if (heldQty <= 0) {
      // No open position — clear any stale history for this symbol
      await resetBuyHistoryForSymbol(account, symbol)
    } else {
      const fresh2 = await getState()
      const history = getBuyHistory(fresh2, account, symbol)
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
      ? (strategy.params as any).maxPerSector
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
    const ordersJson = await kiteGet<{ data?: any[] }>('/orders', apiKey, accessToken)
    if (ordersJson?.data) {
      const completed = ordersJson.data.filter(o => o.status === 'COMPLETE')
      const buys = completed.filter(o => o.transaction_type === 'BUY').length
      const sells = completed.filter(o => o.transaction_type === 'SELL').length
      const maxBuys = cap.maxBuysPerDay
      const maxSells = cap.maxSellsPerDay
      if (side === 'BUY' && buys >= maxBuys) {
        return { ok: false, gate: 'quota', reason: `${account}: already ${buys}/${maxBuys} buys today` }
      }
      if (side === 'SELL' && sells >= maxSells) {
        return { ok: false, gate: 'quota', reason: `${account}: already ${sells}/${maxSells} sells today` }
      }
    }
  }

  // GATE 6 — open positions < maxPositions (BUY only). Skipped for manual orders.
  if (!manual && side === 'BUY') {
    const [holdingsJson, positionsJson] = await Promise.all([
      kiteGet<{ data?: any[] }>('/portfolio/holdings', apiKey, accessToken),
      kiteGet<{ data?: { net?: any[] } }>('/portfolio/positions', apiKey, accessToken),
    ])
    const openSymbols = new Set<string>()
    const holdings = holdingsJson?.data || []
    const netPositions = positionsJson?.data?.net || []

    for (const h of holdings) {
      const heldQty = Number(h?.quantity || 0) + Number(h?.t1_quantity || 0)
      const symbol = String(h?.tradingsymbol || '').toUpperCase()
      if (heldQty > 0 && symbol) openSymbols.add(symbol)
    }

    for (const p of netPositions) {
      const qty = Number(p?.quantity || 0)
      const symbol = String(p?.tradingsymbol || '').toUpperCase()
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
    const marginsJson = await kiteGet<{ data?: { equity?: { available?: { live_balance?: number; cash?: number } } } }>('/user/margins', apiKey, accessToken)
    const available = marginsJson?.data?.equity?.available?.live_balance
      ?? marginsJson?.data?.equity?.available?.cash
      ?? 0
    if (available < tradeValue) {
      return { ok: false, gate: 'funds', reason: `${account}: ₹${Math.round(available)} available, need ₹${Math.round(tradeValue)}` }
    }
  }

  // GATE 8 — Short-sell guard. Applies to ALL SELLs (Auto and Manual).
  // Fetches live held quantity from Kite (holdings + day positions). Three outcomes:
  //   - held == 0    → reject with gate='noShort' (position manually closed or never held)
  //   - held < want  → ok with adjustedQty=held (caller must use this clamped quantity)
  //   - held >= want → ok, no adjustment
  let sellAdjustedQty: number | undefined = undefined
  if (side === 'SELL') {
    const [holdingsJson, positionsJson] = await Promise.all([
      kiteGet<{ data?: any[] }>('/portfolio/holdings', apiKey, accessToken),
      kiteGet<{ data?: { day?: any[]; net?: any[] } }>('/portfolio/positions', apiKey, accessToken),
    ])
    const sym = symbol.toUpperCase()
    const eq = (s: any) => String(s).toUpperCase() === sym
    const holding = (holdingsJson?.data || []).find((h: any) => eq(h.tradingsymbol))
    const dayPos  = (positionsJson?.data?.day || []).find((p: any) => eq(p.tradingsymbol))
    // Include T+1 settlement qty — stocks bought today have quantity=0 but
    // t1_quantity>0 until next trading day. Summing both gives the true held qty.
    const heldQty = Number(holding?.quantity || 0) + Number(holding?.t1_quantity || 0)
    const dayQty  = Number(dayPos?.quantity || 0)
    const available = heldQty + dayQty

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

    // GATE 9 — Auto-mode never sells at a loss. Manual mode lets you override.
    // Also skipped for explicit manual orders (user knows what they're doing).
    // Also skipped when bypassNoLossSell=true (used by squareOffEOD).
    if (state.mode === 'auto' && !manual && !input.bypassNoLossSell) {
      const avg = Number(holding?.average_price ?? dayPos?.average_price ?? dayPos?.day_buy_price ?? 0)
      const ltp = Number(holding?.last_price ?? dayPos?.last_price ?? pricePerShare ?? 0)
      if (avg > 0 && ltp > 0 && ltp < avg) {
        const lossPct = ((avg - ltp) / avg * 100).toFixed(2)
        return {
          ok: false, gate: 'noLossSell',
          reason: `${account}: ${symbol} at ₹${ltp} vs avg ₹${avg} (−${lossPct}%) — Auto mode never sells at a loss`,
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
      const { recordBuyHistory } = await import('@/lib/state')
      await recordBuyHistory(account, symbol, opts.price)
    } catch (err) {
      console.error(`[preflight] failed to record buy history for ${account} ${symbol}:`, err)
    }
  }
}
