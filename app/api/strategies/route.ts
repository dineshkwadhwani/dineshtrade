// GET /api/strategies — returns the new schema-2 config: capital block +
// strategies array. Phase 2 is read-only; POST will land in Phase 4 with
// validation + hot-reload.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getCapital, getStrategies } from '@/lib/strategyConfig'
import { getWatchlist } from '@/lib/watchlistStore'

export const dynamic = 'force-dynamic'

export async function GET() {
  const t = cookies().get('dt_session')?.value
  if (!t || !(await verifySession(t))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Watchlist keys are derived dynamically so a future `listC` shows up in
  // the Strategies UI dropdown with no code change required.
  const wl = await getWatchlist()
  const watchlistKeys = Object.keys(wl).filter(k =>
    Array.isArray((wl as any)[k]) && (k === 'listA' || k === 'listB' || k.startsWith('list'))
  )

  return NextResponse.json({
    capital: getCapital(),
    strategies: getStrategies(),
    watchlistKeys,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
