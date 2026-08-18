// POST /api/dalgo/customer/reset
//
// V2 equivalent of /api/settings/reset. Fetches open positions/holdings from
// Zerodha and re-seeds them as Accumulator BUY entries in customer_positions
// and the orders journal, then resets the cron idempotency + buy-history state.
//
// Guards:
//   - Requires a valid DAlgo session (dalgo_access_token JWT).
//   - Requires { confirm: 'RESET' } in the request body.
//   - Requires cron mode to be 'manual' — a reset while auto is live would
//     race the trading engine over the exact rows being wiped/re-seeded.
//   - Admins/account managers may pass targetCustomerId to reset on behalf of
//     a customer; otherwise the reset is scoped to the session user.

import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin, withCustomer } from '@/lib/supabase'
import { loadBrokerAccountCreds } from '@/lib/kite'
import { getPositions, getHoldings } from '@/lib/kite'
import { getState, resetAccountCronState, recordBuyHistory } from '@/lib/state'
import { wipeAccountPositions, recordBuy } from '@/lib/positions'
import { istDateString, journalOrder } from '@/lib/journal'
import { recordResetTimestamp } from '@/lib/instanceStatus'
import { rehydrateForCustomer } from '@/lib/strategyConfigStore'

export const dynamic = 'force-dynamic'

// Prevents concurrent reset calls from racing and creating duplicate journal entries.
const resetInProgress = new Set<string>()

export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }

  if (body.confirm !== 'RESET') {
    return NextResponse.json({ error: 'confirm must be "RESET"' }, { status: 400 })
  }

  // Admins may target any customer; regular customers are restricted to themselves.
  const isPrivileged = (profile.role === 'superadmin' || profile.role === 'account_manager')
  const targetCustomerId = isPrivileged && typeof body.targetCustomerId === 'string'
    ? body.targetCustomerId
    : profile.id

  return withCustomer(targetCustomerId, async () => {
    await rehydrateForCustomer()

    if (resetInProgress.has(targetCustomerId)) {
      return NextResponse.json({ error: 'A reset is already in progress for this account. Please wait.' }, { status: 409 })
    }

    const state = await getState()
    if (state.mode !== 'manual') {
      return NextResponse.json(
        { error: 'Switch to Manual mode before resetting — a reset while Auto is live could race the trading engine.' },
        { status: 400 },
      )
    }

    // Resolve Kite credentials from broker_accounts (V2 OAuth flow).
    const creds = await loadBrokerAccountCreds(targetCustomerId)
    if (!creds) {
      return NextResponse.json(
        { error: 'No active Kite token found. Please reconnect via Settings → Connection.' },
        { status: 400 },
      )
    }

    // Derive the account label the cron uses for this instance — must match
    // positions created by the trading engine.
    const env = process.env.ZERODHA_ENVIRONMENT === 'PROD' ? 'PROD' : 'TEST'
    const account = (process.env[`${env}_ZERODHA_ACCOUNT1`] || 'DINESH').toUpperCase()

    // ── FETCH from Zerodha ─────────────────────────────────────────────────

    const [{ day, net }, holdings] = await Promise.all([
      getPositions(creds).catch(() => ({ day: [], net: [] })),
      getHoldings(creds).catch(() => [] as Awaited<ReturnType<typeof getHoldings>>),
    ])

    // Build de-duplicated seed list: holdings (CNC/delivery) take precedence
    // over net positions for the same symbol; day positions fill any gaps.
    const seedMap = new Map<string, { symbol: string; qty: number; avgPrice: number }>()

    for (const h of holdings) {
      const sym = h.tradingsymbol.toUpperCase()
      const qty = (h.quantity || 0) + (h.t1_quantity || 0)
      const avg = Number(h.average_price) || 0
      if (qty > 0 && avg > 0) seedMap.set(sym, { symbol: sym, qty, avgPrice: avg })
    }
    for (const p of net) {
      const sym = p.tradingsymbol.toUpperCase()
      if (seedMap.has(sym)) continue
      const qty = p.quantity || 0
      const avg = Number(p.average_price) || 0
      if (qty > 0 && avg > 0) seedMap.set(sym, { symbol: sym, qty, avgPrice: avg })
    }
    for (const p of day) {
      const sym = p.tradingsymbol.toUpperCase()
      if (seedMap.has(sym)) continue
      const qty = p.quantity || 0
      const avg = Number(p.average_price) || 0
      if (qty > 0 && avg > 0) seedMap.set(sym, { symbol: sym, qty, avgPrice: avg })
    }

    const seeds = Array.from(seedMap.values())

    // ── WIPE + RE-SEED (guarded against concurrent calls) ─────────────────

    resetInProgress.add(targetCustomerId)
    try {
    // Delete ALL positions for this customer (not account-filtered) so no
    // stale rows from any previous account-label survive the reset.
    const admin = getSupabaseAdmin()
    const { data: deletedPositions } = await admin
      .from('customer_positions')
      .delete()
      .eq('customer_id', targetCustomerId)
      .select('symbol')
    const positionsRemoved = (deletedPositions || []).length

    // Wipe all journal orders + trades for this customer.
    const [journalResult] = await Promise.all([
      import('@/lib/journal').then(m => m.wipeAccountJournal()),
    ])

    await resetAccountCronState(account)

    // ── RE-SEED ───────────────────────────────────────────────────────────

    const today = istDateString()
    const seeded: Array<{ symbol: string; qty: number; avgPrice: number }> = []

    for (const { symbol, qty, avgPrice } of seeds) {
      await recordBuy('accumulator', account, symbol, qty, avgPrice)
      await journalOrder({
        account,
        symbol,
        side: 'BUY',
        qty,
        price: avgPrice,
        tag: 'dt-accumulator',
        source: 'manual',
      })
      // Seed buy history so the pyramid gate knows there's already one buy at
      // this price — prevents the cron from re-buying immediately after reset.
      await recordBuyHistory(account, symbol, avgPrice)
      seeded.push({ symbol, qty, avgPrice })
    }

    console.log(
      `[reset v2] customer=${targetCustomerId} account=${account}: ` +
      `${positionsRemoved} positions cleared, ${journalResult.recordsRemoved} journal records removed, ` +
      `${seeded.length} positions re-seeded as Accumulator`,
    )

    await recordResetTimestamp().catch(err =>
      console.error('[reset v2] recordResetTimestamp failed (non-fatal):', err),
    )

    return NextResponse.json({
      ok: true,
      account,
      positionsRemoved,
      journalRecordsRemoved: journalResult.recordsRemoved,
      seeded,
    })
    } finally {
      resetInProgress.delete(targetCustomerId)
    }
  })
}
