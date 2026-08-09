// POST /api/settings/reset
//
// Hard-resets a single Kite account's data:
//   1. Wipes all journal records for the account
//   2. Clears the positions store for the account
//   3. Clears idempotency + buy-history cron state for the account
//   4. Re-seeds current Kite holdings + net positions as Accumulator BUY entries
//      in both the positions store and the journal
//
// Phase 5 Task 5.10 — multi-tenant isolation notes:
//   - Every store call below (wipeAccountJournal/wipeAccountPositions/
//     resetAccountCronState/recordBuy/journalOrder/recordBuyHistory) is
//     ALREADY hard-scoped to this process's single CUSTOMER_ID internally
//     (getCustomerId() in lib/supabase.ts, wired through every Phase 4
//     Supabase-backed store) — `account` here is only the legacy V1
//     multi-account label used WITHIN this one customer's data (see
//     lib/state.ts header comment), never a cross-tenant selector. There is
//     no code path in this route that can touch another customer's rows.
//   - Added: cron must be in Manual mode before a reset is allowed (a reset
//     while Auto is live would race the trading engine over the exact rows
//     being wiped/re-seeded).
//   - Added: customer_instances.last_reset_at is stamped after a successful
//     reset (Task 5.10), independent of the HEARTBEAT_DB_ENABLED flag — see
//     lib/instanceStatus.ts's recordResetTimestamp().

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getState, resetAccountCronState, recordBuyHistory } from '@/lib/state'
import { resolveAccountCreds, getPositions, getHoldings } from '@/lib/kite'
import { wipeAccountJournal, journalOrder, istDateString } from '@/lib/journal'
import { wipeAccountPositions, recordBuy } from '@/lib/positions'
import { recordResetTimestamp } from '@/lib/instanceStatus'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const t = cookies().get('dt_session')?.value
  if (!t || !(await verifySession(t))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { account, confirm } = body as { account?: string; confirm?: string }

  if (!account || typeof account !== 'string') {
    return NextResponse.json({ error: 'account is required' }, { status: 400 })
  }
  if (confirm !== 'RESET') {
    return NextResponse.json({ error: 'confirm must be "RESET"' }, { status: 400 })
  }

  // Verify account is connected
  const state = await getState()
  if (!state.kiteTokens[account]) {
    return NextResponse.json({ error: `Account "${account}" is not connected — connect it in Settings first` }, { status: 400 })
  }

  // Task 5.10 — cron must be in Manual mode. A reset wipes + re-seeds the
  // exact same rows (positions, idempotency ledger, buy history) the Auto
  // engine reads/writes on every tick; allowing a reset while Auto is live
  // risks the engine acting on a half-wiped store mid-request.
  if (state.mode !== 'manual') {
    return NextResponse.json(
      { error: 'Switch to Manual mode before resetting account data — a reset while Auto is live could race the trading engine.' },
      { status: 400 },
    )
  }

  const creds = await resolveAccountCreds(account)
  if (!creds.ok) {
    return NextResponse.json({ error: `Cannot resolve Kite credentials for "${account}": ${creds.error}` }, { status: 400 })
  }

  // Fetch current Kite holdings and positions before wiping anything
  const [{ day, net }, holdings] = await Promise.all([
    getPositions(creds).catch(() => ({ day: [], net: [] })),
    getHoldings(creds).catch(() => [] as Awaited<ReturnType<typeof getHoldings>>),
  ])

  // Build de-duplicated position seed list from holdings + net positions.
  // Holdings = delivery/CNC carried across days. Net = today's intraday positions.
  // Prefer holdings (has t1_quantity for T+1 settlement) over net for the same symbol.
  const seedMap = new Map<string, { symbol: string; qty: number; avgPrice: number }>()

  for (const h of holdings) {
    const sym = h.tradingsymbol.toUpperCase()
    const qty = (h.quantity || 0) + (h.t1_quantity || 0)
    const avgPrice = Number(h.average_price) || 0
    if (qty > 0 && avgPrice > 0) seedMap.set(sym, { symbol: sym, qty, avgPrice })
  }
  for (const p of net) {
    const sym = p.tradingsymbol.toUpperCase()
    if (seedMap.has(sym)) continue  // holdings take precedence
    const qty = p.quantity || 0
    const avgPrice = Number(p.average_price) || 0
    if (qty > 0 && avgPrice > 0) seedMap.set(sym, { symbol: sym, qty, avgPrice })
  }
  // Also check day positions for any intraday that aren't in net
  for (const p of day) {
    const sym = p.tradingsymbol.toUpperCase()
    if (seedMap.has(sym)) continue
    const qty = p.quantity || 0
    const avgPrice = Number(p.average_price) || 0
    if (qty > 0 && avgPrice > 0) seedMap.set(sym, { symbol: sym, qty, avgPrice })
  }

  const seeds = Array.from(seedMap.values())

  // ── WIPE ──────────────────────────────────────────────────────────────────

  const [journalResult, positionsRemoved] = await Promise.all([
    wipeAccountJournal(account),
    wipeAccountPositions(account),
  ])
  await resetAccountCronState(account)

  // ── RE-SEED ───────────────────────────────────────────────────────────────

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
    })
    // Seed buy history so the pyramid gate knows there's already one buy at this
    // price. Without this, history.length === 0 and the gate skips the min-drop
    // check — allowing the cron to re-buy at the same or higher price immediately
    // after reset. With this entry, the next auto-BUY must be ≥ minDropBetweenBuysPct
    // below avgPrice before it qualifies.
    await recordBuyHistory(account, symbol, avgPrice)
    seeded.push({ symbol, qty, avgPrice })
  }

  console.log(
    `[reset] ${account}: journal wiped (${journalResult.recordsRemoved} records in ${journalResult.filesModified} files), ` +
    `${positionsRemoved} positions cleared, ${seeded.length} positions re-seeded as Accumulator`,
  )

  await recordResetTimestamp().catch(err => console.error('[reset] recordResetTimestamp failed (non-fatal):', err))

  return NextResponse.json({
    ok: true,
    account,
    journalRecordsRemoved: journalResult.recordsRemoved,
    positionsRemoved,
    seeded,
  })
}
