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
import { monitorAllAccountsStrategy1 } from '@/lib/strategy1'
import { monitorAllPivotalAccounts } from '@/lib/pivotal'
import { journalMonitorHeartbeat } from '@/lib/journal'

export async function POST() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const [momentum, dip, pivotal] = await Promise.all([
    monitorAllConnected(),
    monitorAllAccountsStrategy1(),
    monitorAllPivotalAccounts(),
  ])
  const results = [...momentum, ...dip, ...pivotal]
  const positionsChecked = results.reduce((sum, result) => sum + result.positionsChecked, 0)
  journalMonitorHeartbeat({
    source: 'manual',
    accountsChecked: results.length,
    positionsChecked,
  }).catch(err => console.error('[/api/strategy/monitor] journal heartbeat failed:', err))
  return NextResponse.json({
    ranAt: new Date().toISOString(),
    accountsChecked: results.length,
    totalPositions: positionsChecked,
    results,
  })
}
