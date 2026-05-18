// POST /api/strategy — Manual-mode Refresh & Scan.
// Thin wrapper around the lib/strategyEngine — the cron tick calls the same
// underlying function directly without going through HTTP.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import strategyCfg from '@/config/strategy.json'
import { generateRecommendations } from '@/lib/strategyEngine'

export async function POST() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await generateRecommendations()
  return NextResponse.json({
    ...result,
    limits: {
      buysRemaining: strategyCfg.limits.maxBuysPerDay,
      sellsRemaining: strategyCfg.limits.maxSellsPerDay,
    },
  }, { status: result.mode === 'error' ? 502 : 200 })
}
