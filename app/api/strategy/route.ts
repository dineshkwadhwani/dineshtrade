// POST /api/strategy — Manual-mode Refresh & Scan.
// Thin wrapper around the lib/strategyEngine — the cron tick calls the same
// underlying function directly without going through HTTP.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getCapital, getActiveStrategies } from '@/lib/strategyConfig'
import { generateRecommendations, runReactiveDipScan, runStrategyScan } from '@/lib/strategyEngine'
import { appendJournal, istDateString } from '@/lib/journal'

export const dynamic = 'force-dynamic'

async function journalManualStrategyScan(args: {
  strategyId: string
  strategyName: string
  recommendations: Array<{ symbol: string }>
  skipReason?: string
}) {
  await appendJournal({
    type: 'strategy_scan',
    date: istDateString(),
    ts: new Date().toISOString(),
    strategyId: args.strategyId,
    strategyName: args.strategyName,
    recs: args.recommendations.length,
    executed: 0,
    symbols: args.recommendations.length > 0 ? args.recommendations.map(rec => rec.symbol) : undefined,
    skipReason: args.skipReason,
  })
}

export async function POST() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const capital = getCapital()

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

  const pivotalStrategies = getActiveStrategies().filter(strategy => strategy.type === 'pivotal')
  const pivotalRuns = await Promise.all(pivotalStrategies.map(strategy => runStrategyScan(strategy).catch(err => {
    console.warn(`[/api/strategy] pivotal scan failed ${strategy.id}:`, String(err).slice(0, 200))
    return { recommendations: [], message: `Scan crashed: ${String(err).slice(0, 120)}` }
  })))
  const pivotalRecs = pivotalRuns.flatMap(run => run.recommendations || [])

  // De-dupe by symbol; reactive wins since it carries the more specific
  // "intraday −3%+" reason and uses today's down-day count.
  const reactiveSymbols = new Set(reactive.recommendations.map(r => r.symbol))
  const pivotalSymbols = new Set(pivotalRecs.map(r => r.symbol))
  const merged = [
    ...reactive.recommendations,
    ...pivotalRecs.filter(r => !reactiveSymbols.has(r.symbol)),
    ...result.recommendations.filter(r => !reactiveSymbols.has(r.symbol) && !pivotalSymbols.has(r.symbol)),
  ]

  const activeStrategies = getActiveStrategies()
  const manualScanJournalWrites: Promise<void>[] = []

  if (result.mode === 'dip') {
    for (const strategy of activeStrategies.filter(strategy => strategy.type === 'dip')) {
      manualScanJournalWrites.push(journalManualStrategyScan({
        strategyId: strategy.id,
        strategyName: strategy.name,
        recommendations: result.recommendations,
        skipReason: result.message,
      }))
    }
  } else if (result.mode === 'catalyst') {
    for (const strategy of activeStrategies.filter(strategy => strategy.type === 'momentum')) {
      manualScanJournalWrites.push(journalManualStrategyScan({
        strategyId: strategy.id,
        strategyName: strategy.name,
        recommendations: result.recommendations,
        skipReason: result.message,
      }))
    }
  }

  for (let index = 0; index < pivotalStrategies.length; index++) {
    const strategy = pivotalStrategies[index]
    const run = pivotalRuns[index]
    manualScanJournalWrites.push(journalManualStrategyScan({
      strategyId: strategy.id,
      strategyName: strategy.name,
      recommendations: run.recommendations || [],
      skipReason: run.message,
    }))
  }

  Promise.allSettled(manualScanJournalWrites).then(results => {
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[/api/strategy] manual scan journal write failed:', result.reason)
      }
    }
  })

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
      buysRemaining: capital.maxBuysPerDay,
      sellsRemaining: capital.maxSellsPerDay,
    },
  }, { status: result.mode === 'error' ? 502 : 200 })
}
