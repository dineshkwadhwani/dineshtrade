// GET /api/capital?account=DINESH
// Returns the live capital snapshot used by the Trading Engine header bar:
// Available · Deployed (sum of open position values) · Reserve (20% buffer)
// · Remaining deployable. All numbers in ₹. Pulls Zerodha live each request.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { resolveAccountCreds, kiteRequest, getPositions, getHoldings, getQuotes } from '@/lib/kite'
import { computeDeployable, getCapital } from '@/lib/strategyConfig'
import { listJournalDates } from '@/lib/journal'
import { buildLiveTradeReport } from '@/lib/tradeReport'

export const dynamic = 'force-dynamic'

interface MarginsResponse {
  equity?: { available?: { live_balance?: number; cash?: number } }
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
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

  const quoteSymbols = Array.from(new Set([
    ...positionsResult.net.filter(position => position.quantity > 0).map(position => position.tradingsymbol.toUpperCase()),
    ...holdingsResult.filter(holding => ((holding.quantity || 0) + ((holding as any).t1_quantity || 0)) > 0).map(holding => holding.tradingsymbol.toUpperCase()),
  ]))
  const quotes = quoteSymbols.length > 0
    ? await getQuotes(creds, quoteSymbols).catch(() => ({} as Awaited<ReturnType<typeof getQuotes>>))
    : ({} as Awaited<ReturnType<typeof getQuotes>>)

  // Deployed = sum of (qty × live_ltp) across BOTH open positions and holdings.
  // We avoid double-counting by keying on tradingsymbol; positions take priority
  // because they represent the same live exposure as today's holdings rows.
  const bySymbol = new Map<string, { deployed: number; unrealized: number }>()
  for (const p of positionsResult.net) {
    if (p.quantity > 0) {
      const symbol = p.tradingsymbol.toUpperCase()
      const liveLtp = Number(quotes[`NSE:${symbol}`]?.last_price) || p.last_price || 0
      bySymbol.set(symbol, {
        deployed: p.quantity * liveLtp,
        unrealized: p.quantity * (liveLtp - (p.average_price || 0)),
      })
    }
  }
  for (const h of holdingsResult) {
    const sym = h.tradingsymbol.toUpperCase()
    // Holdings split long qty across `quantity` (T+1 settled) and `t1_quantity`
    // (bought today). Both count for capital-deployed accounting — we own them.
    const heldQty = (h.quantity || 0) + ((h as any).t1_quantity || 0)
    if (!bySymbol.has(sym) && heldQty > 0) {
      const liveLtp = Number(quotes[`NSE:${sym}`]?.last_price) || h.last_price || 0
      bySymbol.set(sym, {
        deployed: heldQty * liveLtp,
        unrealized: heldQty * (liveLtp - (h.average_price || 0)),
      })
    }
  }
  const deployed = Number(Array.from(bySymbol.values()).reduce((sum, row) => sum + row.deployed, 0).toFixed(2))
  const liveUnrealizedPnl = Number(Array.from(bySymbol.values()).reduce((sum, row) => sum + row.unrealized, 0).toFixed(2))

  const snapshot = computeDeployable(available, deployed)
  const capital = getCapital()
  const liveCapital = Number((available + deployed).toFixed(2))

  let netRealizedPnl = 0
  try {
    const journalDates = await listJournalDates()
    const earliest = [...journalDates].sort()[0] || todayYmd()
    const report = await buildLiveTradeReport({ fromDate: earliest, toDate: todayYmd(), account })
    netRealizedPnl = report.summary.netRealizedPnl ?? report.summary.realizedPnl
  } catch {
    // Best-effort only — capital tile should still render from live broker cash + holdings.
  }
  const livePnl = Number((netRealizedPnl + liveUnrealizedPnl).toFixed(2))

  return NextResponse.json({
    account,
    ...snapshot,
    liveCapital,
    netRealizedPnl,
    liveUnrealizedPnl,
    livePnl,
    maxDeployPct: capital.maxDeployPct,
    fetchedAt: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
