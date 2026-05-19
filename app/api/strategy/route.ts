// POST /api/strategy — Manual-mode Refresh & Scan.
// Thin wrapper around the lib/strategyEngine — the cron tick calls the same
// underlying function directly without going through HTTP.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import strategyCfg from '@/config/strategy.json'
import { generateRecommendations, runReactiveDipScan } from '@/lib/strategyEngine'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Run the regular mode-based scan AND the reactive dip scan in parallel.
  // Reactive recs (List A stocks intraday-down 3%+ and meeting Strategy 1
  // criteria) are merged into the response so Manual-mode users see them on
  // Refresh, regardless of whether today is dip / catalyst mode.
  const [result, reactive] = await Promise.all([
    generateRecommendations(),
    runReactiveDipScan().catch(err => {
      console.warn('[/api/strategy] reactive dip scan failed:', String(err).slice(0, 200))
      return { recommendations: [], scanned: 0, triggered: [] as string[], evaluated: 0, skipReason: undefined as string | undefined }
    }),
  ])

  // De-dupe by symbol; reactive wins since it carries the more specific
  // "intraday −3%+" reason and uses today's down-day count.
  const reactiveSymbols = new Set(reactive.recommendations.map(r => r.symbol))
  const merged = [
    ...reactive.recommendations,
    ...result.recommendations.filter(r => !reactiveSymbols.has(r.symbol)),
  ]

  return NextResponse.json({
    ...result,
    recommendations: merged,
    reactive: {
      scanned: reactive.scanned,
      triggered: reactive.triggered,
      produced: reactive.recommendations.length,
      skipReason: reactive.skipReason,
    },
    limits: {
      buysRemaining: strategyCfg.limits.maxBuysPerDay,
      sellsRemaining: strategyCfg.limits.maxSellsPerDay,
    },
  }, { status: result.mode === 'error' ? 502 : 200 })
}
