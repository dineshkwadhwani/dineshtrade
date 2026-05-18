// Pre-flight gates that must pass before we POST an order to Kite.
// Six gates per spec (CONTEXT.md): token, market-open, day-quota, open-positions,
// funds-available, idempotency. Phase 2 will add a seed-from-Kite on cron startup.

import { getState } from '@/lib/state'
import { getAccountSecrets } from '@/lib/accounts'
import { isMarketOpen } from '@/lib/market'
import strategyCfg from '@/config/strategy.json'

const KITE_BASE = 'https://api.kite.trade'

// In-process idempotency ledger: account+date → set of `${symbol}:${side}` strings.
// Phase 1 (Vercel serverless) — lost on cold start, accepted.
// Phase 2 (EC2 PM2) — persists across requests; seed from Kite orders-today on boot.
const idempotencyLedger = new Map<string, Set<string>>()

function istDateKey(): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${ist.getFullYear()}-${String(ist.getMonth()+1).padStart(2,'0')}-${String(ist.getDate()).padStart(2,'0')}`
}

function ledgerKey(account: string): string {
  return `${account}:${istDateKey()}`
}

function pruneOldLedger() {
  const today = istDateKey()
  Array.from(idempotencyLedger.keys()).forEach(k => {
    if (!k.endsWith(`:${today}`)) idempotencyLedger.delete(k)
  })
}

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
}

export interface PreflightResult {
  ok: boolean
  reason?: string
  gate?: string
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const { account, symbol, side, quantity, pricePerShare } = input
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

  // GATE 3 — per-trade cap (BUY only — SELL is disposing capital, not deploying)
  if (side === 'BUY' && tradeValue > strategyCfg.capital.perTrade) {
    return { ok: false, gate: 'perTrade', reason: `Trade value ₹${Math.round(tradeValue)} exceeds per-trade cap ₹${strategyCfg.capital.perTrade}` }
  }

  // GATE 4 — idempotency (already done this symbol+side today on this account?)
  pruneOldLedger()
  const ledgerSet = idempotencyLedger.get(ledgerKey(account))
  if (ledgerSet?.has(`${symbol}:${side}`)) {
    return { ok: false, gate: 'idempotency', reason: `${account}: already ${side} ${symbol} earlier today` }
  }

  // GATE 5 — day buy/sell quota (via getOrders)
  const ordersJson = await kiteGet<{ data?: any[] }>('/orders', apiKey, accessToken)
  if (ordersJson?.data) {
    const completed = ordersJson.data.filter(o => o.status === 'COMPLETE')
    const buys = completed.filter(o => o.transaction_type === 'BUY').length
    const sells = completed.filter(o => o.transaction_type === 'SELL').length
    const maxBuys = strategyCfg.limits.maxBuysPerDay
    const maxSells = strategyCfg.limits.maxSellsPerDay
    if (side === 'BUY' && buys >= maxBuys) {
      return { ok: false, gate: 'quota', reason: `${account}: already ${buys}/${maxBuys} buys today` }
    }
    if (side === 'SELL' && sells >= maxSells) {
      return { ok: false, gate: 'quota', reason: `${account}: already ${sells}/${maxSells} sells today` }
    }
  }

  // GATE 6 — open positions < maxPositions (only enforced on BUY)
  if (side === 'BUY') {
    const [holdingsJson, positionsJson] = await Promise.all([
      kiteGet<{ data?: any[] }>('/portfolio/holdings', apiKey, accessToken),
      kiteGet<{ data?: { net?: any[] } }>('/portfolio/positions', apiKey, accessToken),
    ])
    const holdingsCount = holdingsJson?.data?.length || 0
    const netPositions = positionsJson?.data?.net?.filter((p: any) => p.quantity !== 0).length || 0
    const totalOpen = holdingsCount + netPositions
    const maxOpen = strategyCfg.capital.maxPositions
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

  // GATE 8 — Auto-mode never sells at a loss.
  // Manual mode lets the trader override (they can sell at a loss deliberately);
  // Auto mode must respect the "never sell at a loss" philosophy.
  if (side === 'SELL' && state.mode === 'auto') {
    const holdingsJson = await kiteGet<{ data?: any[] }>('/portfolio/holdings', apiKey, accessToken)
    const holding = (holdingsJson?.data || []).find((h: any) =>
      String(h.tradingsymbol).toUpperCase() === symbol.toUpperCase()
    )
    if (!holding) {
      return { ok: false, gate: 'noHolding', reason: `${account}: not currently holding ${symbol}` }
    }
    const avg = Number(holding.average_price) || 0
    const ltp = Number(holding.last_price) || 0
    if (ltp < avg) {
      const lossPct = avg > 0 ? ((avg - ltp) / avg * 100).toFixed(2) : '?'
      return {
        ok: false,
        gate: 'noLossSell',
        reason: `${account}: ${symbol} at ₹${ltp} vs avg ₹${avg} (−${lossPct}%) — Auto mode never sells at a loss`,
      }
    }
  }

  return { ok: true }
}

// Called after a successful place_order to record the trade in the ledger
// so a subsequent scan/click doesn't duplicate it.
export function markPlaced(account: string, symbol: string, side: 'BUY' | 'SELL') {
  pruneOldLedger()
  const key = ledgerKey(account)
  if (!idempotencyLedger.has(key)) idempotencyLedger.set(key, new Set())
  idempotencyLedger.get(key)!.add(`${symbol}:${side}`)
}
