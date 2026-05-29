// POST /api/settings/reset
// Hard-resets a single Kite account's data:
//   1. Wipes all journal records for the account
//   2. Clears the positions store for the account
//   3. Clears idempotency + buy-history cron state for the account
//   4. Re-seeds current Kite holdings + net positions as Accumulator BUY entries
//      in both the positions store and the journal

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getState, resetAccountCronState, recordBuyHistory } from '@/lib/state'
import { resolveAccountCreds, getPositions, getHoldings } from '@/lib/kite'
import { wipeAccountJournal, journalOrder, istDateString } from '@/lib/journal'
import { wipeAccountPositions, recordBuy } from '@/lib/positions'

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
    const qty = (h.quantity || 0) + ((h as any).t1_quantity || 0)
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

  return NextResponse.json({
    ok: true,
    account,
    journalRecordsRemoved: journalResult.recordsRemoved,
    positionsRemoved,
    seeded,
  })
}
