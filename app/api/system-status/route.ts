import { constants as fsConstants, promises as fs } from 'fs'
import * as path from 'path'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getState } from '@/lib/state'
import { computeDeployable, getCapital, getStrategies } from '@/lib/strategyConfig'
import { istDateString, listJournalDates, readJournalMonth, type JournalRecord, type StrategyScanRecord, type MonitorHeartbeatRecord } from '@/lib/journal'
import { isMarketOpen } from '@/lib/market'
import { getAccountDisplay, getAccountList } from '@/lib/accounts'
import { getHoldings, getPositions, getQuotes, kiteRequest, resolveAccountCreds } from '@/lib/kite'
import { buildLiveTradeReport } from '@/lib/tradeReport'

export const dynamic = 'force-dynamic'

type StatusTone = 'green' | 'amber' | 'red' | 'gray'

interface StatusItem {
  key: string
  label: string
  tone: StatusTone
  summary: string
  detail?: string
}

function formatInr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function minutesBetween(fromIso: string, to: Date): number | null {
  const from = new Date(fromIso)
  if (Number.isNaN(from.getTime())) return null
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000))
}

function rankTone(tone: StatusTone): number {
  if (tone === 'red') return 3
  if (tone === 'amber') return 2
  if (tone === 'green') return 1
  return 0
}

function summarizeCounts(items: StatusItem[]) {
  let critical = 0
  let warning = 0
  for (const item of items) {
    if (item.tone === 'red') critical++
    if (item.tone === 'amber') warning++
  }
  return { critical, warning }
}

async function getPersistenceItems(todayRecords: JournalRecord[]): Promise<StatusItem[]> {
  const stateFilePath = process.env.STATE_FILE_PATH || ''
  if (!stateFilePath) {
    return [{
      key: 'persistence',
      label: 'Persistence',
      tone: 'amber',
      summary: 'File backend disabled',
      detail: 'STATE_FILE_PATH is not set in this process.',
    }]
  }

  const stateDir = path.dirname(stateFilePath)
  const journalLatest = todayRecords
    .map(record => 'ts' in record ? record.ts : null)
    .filter((value): value is string => !!value)
    .sort()
    .slice(-1)[0] || null

  let stateTone: StatusTone = 'green'
  let stateSummary = `State file ready · ${path.basename(stateFilePath)}`
  try {
    await fs.access(stateDir, fsConstants.R_OK | fsConstants.W_OK)
  } catch {
    stateTone = 'red'
    stateSummary = `State dir not writable · ${stateDir}`
  }

  let journalTone: StatusTone = 'green'
  let journalSummary = journalLatest
    ? `Latest journal write ${new Date(journalLatest).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata', hour12: false })} IST`
    : 'No journal write today'
  if (!journalLatest) journalTone = 'amber'
  try {
    await fs.access(stateDir, fsConstants.W_OK)
  } catch {
    journalTone = 'red'
    journalSummary = `Journal dir not writable · ${stateDir}`
  }

  return [
    { key: 'state-file', label: 'State File', tone: stateTone, summary: stateSummary, detail: stateFilePath },
    { key: 'journal-write', label: 'Journal', tone: journalTone, summary: journalSummary, detail: stateDir },
  ]
}

async function getCapitalItems(trackedAccounts: string[], accountSet: Set<string>) {
  const capital = getCapital()
  const journalDates = await listJournalDates().catch(() => [] as string[])
  const earliestJournalDate = [...journalDates].sort()[0] || todayYmd()
  const accountItems = await Promise.all(trackedAccounts.map(async account => {
    if (!accountSet.has(account)) {
      return {
        capitalItem: {
          key: `capital-${account}`,
          label: `${account} Capital`,
          tone: 'red' as const,
          summary: 'Account not configured',
          detail: 'Capital snapshot unavailable in this environment.',
        },
        reconciliationItem: {
          key: `reconciliation-${account}`,
          label: `${account} Reconciliation`,
          tone: 'gray' as const,
          summary: 'No reconciliation baseline',
          detail: 'Account is not configured in this environment.',
        },
        deployable: 0,
        available: 0,
      }
    }

    const creds = await resolveAccountCreds(account)
    if (!creds.ok) {
      return {
        capitalItem: {
          key: `capital-${account}`,
          label: `${account} Capital`,
          tone: 'red' as const,
          summary: 'Broker credentials unavailable',
          detail: creds.error,
        },
        reconciliationItem: {
          key: `reconciliation-${account}`,
          label: `${account} Reconciliation`,
          tone: 'gray' as const,
          summary: 'Capital reconciliation unavailable',
          detail: creds.error,
        },
        deployable: 0,
        available: 0,
      }
    }

    const [marginsResult, positionsResult, holdingsResult] = await Promise.all([
      kiteRequest<{ data?: { equity?: { available?: { live_balance?: number; cash?: number } } } }>('/user/margins', creds).catch(() => null),
      getPositions(creds).catch(() => ({ net: [], day: [] })),
      getHoldings(creds).catch(() => [] as Awaited<ReturnType<typeof getHoldings>>),
    ])

    const m = marginsResult?.data?.data?.equity?.available
    const available = Number(m?.live_balance ?? m?.cash ?? 0)
    const quoteSymbols = Array.from(new Set([
      ...positionsResult.net.filter(position => position.quantity > 0).map(position => position.tradingsymbol.toUpperCase()),
      ...holdingsResult.filter(holding => ((holding.quantity || 0) + (holding.t1_quantity || 0)) > 0).map(holding => holding.tradingsymbol.toUpperCase()),
    ]))
    const quotes = quoteSymbols.length > 0
      ? await getQuotes(creds, quoteSymbols).catch(() => ({} as Awaited<ReturnType<typeof getQuotes>>))
      : ({} as Awaited<ReturnType<typeof getQuotes>>)

    const bySymbol = new Map<string, { deployed: number; unrealized: number }>()
    for (const position of positionsResult.net) {
      if (position.quantity > 0) {
        const symbol = position.tradingsymbol.toUpperCase()
        const liveLtp = Number(quotes[`NSE:${symbol}`]?.last_price) || position.last_price || 0
        bySymbol.set(symbol, {
          deployed: position.quantity * liveLtp,
          unrealized: position.quantity * (liveLtp - (position.average_price || 0)),
        })
      }
    }
    for (const holding of holdingsResult) {
      const symbol = holding.tradingsymbol.toUpperCase()
      const heldQty = (holding.quantity || 0) + (holding.t1_quantity || 0)
      if (!bySymbol.has(symbol) && heldQty > 0) {
        const liveLtp = Number(quotes[`NSE:${symbol}`]?.last_price) || holding.last_price || 0
        bySymbol.set(symbol, {
          deployed: heldQty * liveLtp,
          unrealized: heldQty * (liveLtp - (holding.average_price || 0)),
        })
      }
    }

    const deployed = Number(Array.from(bySymbol.values()).reduce((sum, value) => sum + value.deployed, 0).toFixed(2))
    const liveUnrealizedPnl = Number(Array.from(bySymbol.values()).reduce((sum, value) => sum + value.unrealized, 0).toFixed(2))
    const snapshot = computeDeployable(available, deployed)
    const deployablePct = snapshot.available > 0 ? snapshot.remaining / snapshot.available : 0
    const tone: StatusTone = snapshot.remaining <= 0
      ? 'red'
      : deployablePct < 0.1
        ? 'amber'
        : 'green'

    const liveCapital = Number((available + deployed).toFixed(2))
    const reconciliationBase = Number(getAccountDisplay(account)?.reconciliationBase ?? 0)
    let netRealizedPnl = 0
    try {
      const report = await buildLiveTradeReport({ fromDate: earliestJournalDate, toDate: todayYmd(), account })
      netRealizedPnl = report.summary.netRealizedPnl ?? report.summary.realizedPnl
    } catch {
      netRealizedPnl = 0
    }
    const livePnl = Number((netRealizedPnl + liveUnrealizedPnl).toFixed(2))
    const explainedCapital = reconciliationBase > 0 ? Number((reconciliationBase + livePnl).toFixed(2)) : null
    const reconciliationResidual = explainedCapital === null
      ? null
      : Number((liveCapital - explainedCapital).toFixed(2))
    const absResidual = Math.abs(reconciliationResidual ?? 0)
    const reconciliationTone: StatusTone = explainedCapital === null
      ? 'gray'
      : absResidual >= 5000
        ? 'red'
        : absResidual >= 1000
          ? 'amber'
          : 'green'

    return {
      capitalItem: {
        key: `capital-${account}`,
        label: `${account} Capital`,
        tone,
        summary: `${formatInr(snapshot.remaining)} deployable of ${formatInr(snapshot.available)}`,
        detail: `Deployed ${formatInr(snapshot.deployed)} · Reserve ${formatInr(snapshot.reserve)} · Max ${capital.maxDeployPct}%`,
      },
      reconciliationItem: {
        key: `reconciliation-${account}`,
        label: `${account} Reconciliation`,
        tone: reconciliationTone,
        summary: explainedCapital === null
          ? 'No reconciliation baseline configured'
          : `Residual ${formatInr(reconciliationResidual ?? 0)} vs reconstructed capital`,
        detail: explainedCapital === null
          ? 'Add reconciliationBase to account config to enable drift tracking.'
          : `Live ${formatInr(liveCapital)} · Explained ${formatInr(explainedCapital)} · Realized ${formatInr(netRealizedPnl)} · Unrealized ${formatInr(liveUnrealizedPnl)}`,
      },
      deployable: snapshot.remaining,
      available: snapshot.available,
    }
  }))

  const totalDeployable = accountItems.reduce((sum, item) => sum + item.deployable, 0)
  const totalAvailable = accountItems.reduce((sum, item) => sum + item.available, 0)
  const capitalStatusItems = accountItems.flatMap(({ capitalItem, reconciliationItem }) => [capitalItem, reconciliationItem])
  return {
    summaryItem: {
      key: 'deployable-capital',
      label: 'Deployable Capital',
      tone: accountItems.length === 0
        ? 'amber'
        : capitalStatusItems.every(item => item.tone === 'green')
          ? 'green'
          : capitalStatusItems.some(item => item.tone === 'red')
            ? 'red'
            : 'amber',
      summary: accountItems.length === 0
        ? 'No tracked account for capital checks'
        : `${formatInr(totalDeployable)} deployable across ${accountItems.length} account(s)`,
      detail: totalAvailable > 0 ? `Live cash tracked: ${formatInr(totalAvailable)}` : undefined,
    } satisfies StatusItem,
    items: capitalStatusItems,
  }
}

export async function GET() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const today = istDateString()
  const state = await getState()
  const strategies = getStrategies().filter(strategy => strategy.active)
  const monthRecords = await readJournalMonth(today.slice(0, 7)).catch(() => [] as JournalRecord[])
  const todayRecords = monthRecords.filter(record => record.date === today)
  const todayScans = todayRecords.filter((record): record is StrategyScanRecord => record.type === 'strategy_scan')
  const todayMonitorHeartbeats = todayRecords.filter((record): record is MonitorHeartbeatRecord => record.type === 'monitor_heartbeat')

  let strategyLastRunAt: Record<string, string> = {}
  let coreTickLastRunAt: string | null = null
  try {
    const cronState = await import('@/lib/cronState')
    strategyLastRunAt = { ...cronState.strategyLastRunAt }
    coreTickLastRunAt = cronState.coreTickLastRunAt || null
  } catch {
    strategyLastRunAt = {}
  }

  const latestScanByStrategy = todayScans.reduce<Record<string, StrategyScanRecord>>((acc, scan) => {
    const current = acc[scan.strategyId]
    if (!current || scan.ts.localeCompare(current.ts) > 0) acc[scan.strategyId] = scan
    return acc
  }, {})
  const latestMonitorHeartbeat = todayMonitorHeartbeats.slice().sort((a, b) => b.ts.localeCompare(a.ts))[0] || null

  const market = await isMarketOpen()
  const connectedAccounts = Object.keys(state.kiteTokens)
  const selectedAccounts = state.selectedAccounts
  const trackedAccounts = selectedAccounts.length > 0 ? selectedAccounts : connectedAccounts
  const accountSet = new Set(getAccountList().map(account => account.name))
  const reachableAccounts = await Promise.all(trackedAccounts.map(async account => {
    if (!accountSet.has(account)) return { account, ok: false, reason: 'Account not configured in current environment' }
    const creds = await resolveAccountCreds(account)
    if (!creds.ok) return { account, ok: false, reason: creds.error }
    const ping = await kiteRequest<{ status?: string; message?: string }>('/user/margins', creds).catch(() => null)
    if (!ping?.ok) return { account, ok: false, reason: ping?.data?.message || `Kite HTTP ${ping?.status || 'error'}` }
    return { account, ok: true, reason: 'Broker reachable' }
  }))

  const strategyItems: StatusItem[] = strategies.map(strategy => {
    const runtimeLast = strategyLastRunAt[strategy.id]
    const journalLast = latestScanByStrategy[strategy.id]?.ts
    const lastRunAt = runtimeLast || journalLast || null
    const minutesSinceLastRun = lastRunAt ? minutesBetween(lastRunAt, now) : null
    const staleAfterMin = Math.max(strategy.scanIntervalMin * 3, 10)
    const tone: StatusTone = minutesSinceLastRun === null
      ? 'red'
      : minutesSinceLastRun > staleAfterMin
        ? 'amber'
        : 'green'
    return {
      key: `strategy-${strategy.id}`,
      label: strategy.name,
      tone,
      summary: minutesSinceLastRun === null
        ? `No run recorded today · every ${strategy.scanIntervalMin} min`
        : `Every ${strategy.scanIntervalMin} min · last run ${minutesSinceLastRun}m ago`,
      detail: latestScanByStrategy[strategy.id]?.skipReason,
    }
  })

  const buyScannerTone: StatusTone = strategyItems.length === 0
    ? 'gray'
    : strategyItems.every(item => item.tone === 'green')
      ? 'green'
      : strategyItems.some(item => item.tone === 'red')
        ? 'red'
        : 'amber'

  const latestMonitorTs = coreTickLastRunAt || latestMonitorHeartbeat?.ts || null
  const monitorMinutes = latestMonitorTs ? minutesBetween(latestMonitorTs, now) : null
  const sellMonitorTone: StatusTone = !process.env.CRON_ENABLED || process.env.CRON_ENABLED !== 'true'
    ? 'amber'
    : monitorMinutes === null
      ? 'amber'
      : monitorMinutes > 10
        ? 'amber'
        : 'green'

  const brokerConnectedTone: StatusTone = connectedAccounts.length === 0
    ? 'red'
    : trackedAccounts.length === 0
      ? 'amber'
      : trackedAccounts.every(account => connectedAccounts.includes(account))
        ? 'green'
        : 'amber'

  const brokerReachableTone: StatusTone = reachableAccounts.length === 0
    ? 'amber'
    : reachableAccounts.every(account => account.ok)
      ? 'green'
      : reachableAccounts.some(account => account.ok)
        ? 'amber'
        : 'red'

  const autoModeItem: StatusItem = {
    key: 'auto-mode',
    label: 'Auto Mode',
    tone: state.mode === 'auto' ? 'green' : 'amber',
    summary: state.mode === 'auto' ? 'Armed for automation' : 'Paused in manual mode',
    detail: market.open
      ? `Market open · ${market.status}`
      : market.nextOpen
        ? `${market.status} · next open ${market.nextOpen}`
        : market.status,
  }

  const summaryItems: StatusItem[] = [
    {
      key: 'zerodha-connected',
      label: 'Zerodha Connected',
      tone: brokerConnectedTone,
      summary: connectedAccounts.length === 0
        ? 'No Kite token in state'
        : `${connectedAccounts.length} connected · ${trackedAccounts.length} tracked`,
      detail: trackedAccounts.length > 0 ? `Tracked: ${trackedAccounts.join(', ')}` : 'No selected accounts yet',
    },
    {
      key: 'broker-reachable',
      label: 'Broker API',
      tone: brokerReachableTone,
      summary: reachableAccounts.length === 0
        ? 'No account selected for broker check'
        : `${reachableAccounts.filter(account => account.ok).length}/${reachableAccounts.length} account(s) reachable`,
      detail: reachableAccounts.find(account => !account.ok)?.reason,
    },
    {
      key: 'deployable-capital',
      label: 'Deployable Capital',
      tone: 'gray',
      summary: 'Capital check pending',
    },
    {
      key: 'buy-scanner',
      label: 'Buy Scanner',
      tone: buyScannerTone,
      summary: strategyItems.length === 0
        ? 'No active strategies'
        : `${todayScans.length} scan record(s) today`,
      detail: todayScans.slice().sort((a, b) => b.ts.localeCompare(a.ts))[0]?.skipReason,
    },
    {
      key: 'sell-monitor',
      label: 'Sell Monitor',
      tone: sellMonitorTone,
      summary: monitorMinutes === null
        ? 'No monitor heartbeat recorded today'
        : `Last heartbeat ${monitorMinutes}m ago`,
      detail: latestMonitorHeartbeat ? `Source: ${latestMonitorHeartbeat.source}` : (coreTickLastRunAt ? 'Source: in-memory cron tick' : undefined),
    },
    autoModeItem,
  ]

  const persistenceItems = await getPersistenceItems(todayRecords)
  const capitalGroup = await getCapitalItems(trackedAccounts, accountSet)
  summaryItems[2] = capitalGroup.summaryItem
  const groups = {
    execution: [summaryItems[3], summaryItems[4], autoModeItem],
    broker: [summaryItems[0], summaryItems[1]],
    capital: capitalGroup.items,
    persistence: persistenceItems,
    strategies: strategyItems,
  }

  const allItems = [...summaryItems, ...persistenceItems, ...strategyItems]
  const counts = summarizeCounts(allItems)
  const overallTone = counts.critical > 0 ? 'red' : counts.warning > 0 ? 'amber' : 'green'

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    overall: {
      tone: overallTone,
      summary: overallTone === 'green'
        ? 'All core systems look healthy.'
        : overallTone === 'amber'
          ? 'System is usable, but one or more checks need attention.'
          : 'System has a blocking issue.',
      ...counts,
    },
    summaryItems,
    groups,
    latest: {
      scan: todayScans.slice().sort((a, b) => b.ts.localeCompare(a.ts))[0] || null,
      monitorHeartbeat: latestMonitorHeartbeat,
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}