// POST /api/strategy/monitor — runs the Strategy-2 monitor across all connected
// accounts. Used by both:
//   - the Engine page's "Run monitor now" button (manual debugging / dry-run)
//   - the node-cron tick during market hours (auto mode)
//
// The monitor's own preflight gate ('market') will reject SELLs when the
// market is closed, so it's safe to run anytime. Returns a structured report.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { monitorAllConnected } from '@/lib/strategy2'

export async function POST() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const results = await monitorAllConnected()
  return NextResponse.json({
    ranAt: new Date().toISOString(),
    accountsChecked: results.length,
    totalPositions: results.reduce((s, r) => s + r.positionsChecked, 0),
    results,
  })
}
