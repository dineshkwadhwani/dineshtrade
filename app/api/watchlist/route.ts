// GET  /api/watchlist        — current effective watchlist (runtime override or seed)
// POST /api/watchlist        — save full watchlist { listA, listB }
//
// Save writes to data/watchlist.json — runtime override file. Strategy engine
// reads from this file every scan, so changes take effect immediately on the
// next tick / refresh without restarting the process.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getWatchlist, saveWatchlist, type Watchlist, type WatchlistEntry } from '@/lib/watchlistStore'

export const dynamic = 'force-dynamic'

async function authed(): Promise<boolean> {
  const t = cookies().get('dt_session')?.value
  return !!t && (await verifySession(t))
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const wl = await getWatchlist()
  return NextResponse.json(wl, { headers: { 'Cache-Control': 'no-store' } })
}

function cleanEntries(arr: any): WatchlistEntry[] {
  if (!Array.isArray(arr)) return []
  const out: WatchlistEntry[] = []
  const seen = new Set<string>()
  for (const e of arr) {
    if (!e || typeof e.nse !== 'string') continue
    const nse = e.nse.toUpperCase().trim()
    if (!nse || seen.has(nse)) continue
    seen.add(nse)
    out.push({
      nse,
      name: typeof e.name === 'string' && e.name ? e.name : nse,
      trades: typeof e.trades === 'number' ? e.trades : undefined,
      lastTraded: typeof e.lastTraded === 'string' ? e.lastTraded : undefined,
    })
  }
  return out
}

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.listA) || !Array.isArray(body.listB)) {
    return NextResponse.json({ error: 'Body must include { listA: [], listB: [] }' }, { status: 400 })
  }

  // A symbol can't appear in both lists. If it does, listA wins.
  const a = cleanEntries(body.listA)
  const aSet = new Set(a.map(e => e.nse))
  const b = cleanEntries(body.listB).filter(e => !aSet.has(e.nse))

  const next: Watchlist = {
    generated: new Date().toISOString().slice(0, 10),
    rules: body.rules,
    listA: a,
    listB: b,
  }
  try {
    await saveWatchlist(next)
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 })
  }
  return NextResponse.json({ ok: true, counts: { listA: a.length, listB: b.length } })
}
