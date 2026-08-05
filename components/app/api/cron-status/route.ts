import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getState } from '@/lib/state'
import { ensureCronStarted } from '@/lib/cron'
import { getStrategies } from '@/lib/strategyConfig'
import { readJournalMonth, istDateString, type JournalRecord, type StrategyScanRecord } from '@/lib/journal'

export const dynamic = 'force-dynamic'

function minutesBetween(fromIso: string, to: Date): number | null {
  const from = new Date(fromIso)
  if (Number.isNaN(from.getTime())) return null
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000))
}

export async function GET() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  ensureCronStarted()

  const state = await getState()
  const today = istDateString()
  const activeStrategies = getStrategies().filter(strategy => strategy.active)

  let strategyLastRunAt: Record<string, string> = {}
  try {
    const { strategyLastRunAt: runtimeLastRunAt } = await import('@/lib/cronState')
    strategyLastRunAt = { ...runtimeLastRunAt }
  } catch {
    strategyLastRunAt = {}
  }

  const monthRecords = await readJournalMonth(today.slice(0, 7)).catch(() => [] as JournalRecord[])
  const todaysRecords = monthRecords.filter(record => record.date === today)
  const todaysScans = todaysRecords.filter((record): record is StrategyScanRecord => record.type === 'strategy_scan')
  const latestScan = todaysScans.slice().sort((a, b) => b.ts.localeCompare(a.ts))[0] || null
  const latestScanByStrategy = todaysScans.reduce<Record<string, StrategyScanRecord>>((acc, scan) => {
    const current = acc[scan.strategyId]
    if (!current || scan.ts.localeCompare(current.ts) > 0) acc[scan.strategyId] = scan
    return acc
  }, {})

  const now = new Date()
  const strategyHealth = activeStrategies.map(strategy => {
    const runtimeLastRunAt = strategyLastRunAt[strategy.id]
    const journalLastRunAt = latestScanByStrategy[strategy.id]?.ts
    const lastRunAt = runtimeLastRunAt || journalLastRunAt || null
    const minutesSinceLastRun = lastRunAt ? minutesBetween(lastRunAt, now) : null
    const staleAfterMin = Math.max(strategy.scanIntervalMin * 3, 10)
    return {
      id: strategy.id,
      name: strategy.name,
      scanIntervalMin: strategy.scanIntervalMin,
      lastRunAt,
      minutesSinceLastRun,
      stale: minutesSinceLastRun === null ? true : minutesSinceLastRun > staleAfterMin,
      staleAfterMin,
      healthSource: runtimeLastRunAt ? 'memory' : journalLastRunAt ? 'journal' : 'none',
    }
  })

  const runtimeHealthy = strategyHealth.some(strategy => !strategy.stale)
  const cronEnabled = process.env.CRON_ENABLED === 'true'

  return NextResponse.json({
    today,
    cronEnabled,
    autoMode: state.mode === 'auto',
    selectedAccounts: state.selectedAccounts,
    accountsWithToken: Object.keys(state.kiteTokens),
    activeStrategies: strategyHealth,
    latestScan,
    todayCounts: {
      strategyScans: todaysScans.length,
      skippedSignals: todaysRecords.filter(record => record.type === 'signal_skipped').length,
      orders: todaysRecords.filter(record => record.type === 'order').length,
    },
    runtimeHealthy,
    warning: !cronEnabled
      ? 'CRON_ENABLED is not true in the running server process.'
      : todaysScans.length === 0
        ? 'No strategy_scan journal records were written today.'
        : !runtimeHealthy
          ? 'Strategy cron tasks look stale based on the latest journal/runtime heartbeat.'
          : strategyHealth.some(strategy => strategy.healthSource === 'journal')
            ? 'Cron scans are healthy, but this request is relying on journal heartbeats because in-memory cron timestamps are missing in the current process.'
          : undefined,
  }, { headers: { 'Cache-Control': 'no-store' } })
}