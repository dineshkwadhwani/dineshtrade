// GET /api/capital?account=DINESH
// Returns the live capital snapshot used by the Trading Engine header bar:
// Available · Deployed (sum of open position values) · Reserve (20% buffer)
// · Remaining deployable. All numbers in ₹. Pulls Zerodha live each request.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { resolveAccountCreds, kiteRequest, getPositions, getHoldings } from '@/lib/kite'
import { computeDeployable, getCapital } from '@/lib/strategyConfig'

export const dynamic = 'force-dynamic'

interface MarginsResponse {
  equity?: { available?: { live_balance?: number; cash?: number } }
}

export async function GET(req: Request) {
  const t = cookies().get('dt_session')?.value
  if (!t || !(await verifySession(t))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = new URL(req.url).searchParams.get('account')
  if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 })

  const creds = await resolveAccountCreds(account)
  if (!creds.ok) return NextResponse.json({ error: creds.error }, { status: 400 })

  // Live fetches in parallel — margins for cash, positions+holdings for deployed.
  const [marginsResult, positionsResult, holdingsResult] = await Promise.all([
    kiteRequest<{ data?: MarginsResponse }>('/user/margins', creds).catch(() => null),
    getPositions(creds).catch(() => ({ net: [], day: [] })),
    getHoldings(creds).catch(() => [] as Awaited<ReturnType<typeof getHoldings>>),
  ])

  const m = marginsResult?.data?.data?.equity?.available
  const available = Number(m?.live_balance ?? m?.cash ?? 0)

  // Deployed = sum of (qty × last_price) across BOTH open positions and holdings.
  // We avoid double-counting by keying on tradingsymbol; positions take priority
  // because their last_price is slightly more current than holdings'.
  const bySymbol = new Map<string, number>()
  for (const p of positionsResult.net) {
    if (p.quantity > 0) bySymbol.set(p.tradingsymbol.toUpperCase(), p.quantity * (p.last_price || 0))
  }
  for (const h of holdingsResult) {
    const sym = h.tradingsymbol.toUpperCase()
    if (!bySymbol.has(sym) && h.quantity > 0) bySymbol.set(sym, h.quantity * (h.last_price || 0))
  }
  const deployed = Array.from(bySymbol.values()).reduce((s, v) => s + v, 0)

  const snapshot = computeDeployable(available, deployed)
  const capital = getCapital()

  return NextResponse.json({
    account,
    ...snapshot,
    maxDeployPct: capital.maxDeployPct,
    fetchedAt: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
