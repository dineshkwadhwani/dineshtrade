import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { runStrategyBacktest } from '@/lib/backtest'
import { analyseSingleBacktestResult, buildBacktestHistoryEntry, appendBacktestHistory } from '@/lib/backtestHistory'
import { getActiveStrategies, getStrategyById, type Strategy } from '@/lib/strategyConfig'
import { rehydrateForCustomer } from '@/lib/strategyConfigStore'
import { getWatchlist } from '@/lib/watchlistStore'
import { withCustomer } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const primaryCustomerId = (process.env.CUSTOMER_IDS || '').split(',')[0]?.trim() || profile.id
    // Strategy config + watchlist always come from the target customer; Kite creds from the primary (Connect plan).
    const targetCustomerId = (['superadmin', 'account_manager'] as string[]).includes(profile.role) && body.targetCustomerId
      ? body.targetCustomerId as string
      : profile.id
    const historyCustomerId = targetCustomerId

    const runAllActive = body.runAllActive === true
    const strategyId = typeof body.strategyKey === 'string' ? body.strategyKey
      : typeof body.strategyId === 'string' ? body.strategyId : undefined
    const strategySnapshot = body.strategySnapshot as Strategy | undefined
    const strategySnapshots = Array.isArray(body.strategySnapshots) ? body.strategySnapshots as Strategy[] : undefined
    const days = typeof body.days === 'number' ? body.days : 60
    const initialCapital = typeof body.initialCapital === 'number' ? body.initialCapital : 50000

    // Pre-load strategy snapshot + watchlist from the target customer's context.
    const [resolvedStrategySnapshot, resolvedStrategySnapshots, targetWatchlist] = await withCustomer(targetCustomerId, async () => {
      await rehydrateForCustomer()
      const snap = strategySnapshot ?? (strategyId ? getStrategyById(strategyId) ?? undefined : undefined)
      const snaps = strategySnapshots ?? (runAllActive ? getActiveStrategies() : undefined)
      const wl = await getWatchlist()
      return [snap, snaps, wl] as const
    })

    // Run in the primary customer's context so firstConnectedCreds() reads the Connect-plan Kite tokens.
    // Strategy and watchlist are injected as overrides — they come from the target customer above.
    const result = await withCustomer(primaryCustomerId, () => runStrategyBacktest({
      days, initialCapital, strategyId, runAllActive,
      strategySnapshot: resolvedStrategySnapshot,
      strategySnapshots: resolvedStrategySnapshots,
      watchlistOverride: targetWatchlist,
    }))

    const historyEntry = buildBacktestHistoryEntry({
      result,
      strategySnapshot: runAllActive ? null : (resolvedStrategySnapshot ?? null),
      strategySnapshots: runAllActive ? resolvedStrategySnapshots : undefined,
    })
    // Save history scoped to the requesting customer (or the target customer for admin)
    await withCustomer(historyCustomerId, () => appendBacktestHistory(historyEntry))

    let analysis: string | null = null
    let analysisError: string | null = null
    try { analysis = await analyseSingleBacktestResult(result) }
    catch (err) { analysisError = String(err).slice(0, 300) }

    return NextResponse.json({ result, historyEntry, analysis, analysisError })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[customer/backtest] error:', err)
    return NextResponse.json({ error: String(err).slice(0, 400) }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })
    const url = new URL(req.url)
    const targetId = url.searchParams.get('targetCustomerId')
    const customerId = (['superadmin', 'account_manager'] as string[]).includes(profile.role) && targetId ? targetId : profile.id

    const { loadBacktestHistory } = await import('@/lib/backtestHistory')
    const history = await withCustomer(customerId, () => loadBacktestHistory())
    return NextResponse.json({ history })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 400 })
  }
}
