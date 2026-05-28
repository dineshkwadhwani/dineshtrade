'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'

interface AccountDisplay {
  name: string
  displayName: string
  initials: string
  color: string
  note: string
}

type Mode = 'auto' | 'manual'

type SettingsTab = 'general' | 'strategies' | 'backtest'

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [environment, setEnvironment] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('manual')
  const [connected, setConnected] = useState<string[]>([])
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [savedFlash, setSavedFlash] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [callbackUrl, setCallbackUrl] = useState('')
  const [banner, setBanner] = useState<{ text: string; ok: boolean } | null>(null)

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Compute callback URL on the client (where window is available)
  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/zerodha/callback`)
  }, [])

  // Initial load
  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/state').then(r => r.json()),
    ]).then(([a, s]) => {
      setAccounts(a.accounts || [])
      setEnvironment(a.environment || null)
      setMode(s.mode === 'auto' ? 'auto' : 'manual')
      setConnected(s.accountsWithToken || [])
    }).catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  // Read ?connected= / ?error= from callback and show a banner; then clean the URL
  useEffect(() => {
    const connectedParam = searchParams.get('connected')
    const errorParam = searchParams.get('error')
    if (connectedParam) {
      setBanner({ text: `✓ ${connectedParam} connected via Kite Connect`, ok: true })
      router.replace(pathname, { scroll: false })
    } else if (errorParam) {
      setBanner({ text: `✗ ${errorParam}`, ok: false })
      router.replace(pathname, { scroll: false })
    }
  }, [searchParams, router, pathname])

  function flashSaved() {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1400)
  }

  async function changeMode(next: Mode) {
    if (next === mode) return
    setMode(next)
    const res = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    })
    if (res.ok) flashSaved()
  }

  function loginWithKite(account: string) {
    setBusy(b => ({ ...b, [account]: true }))
    // Server-side redirect chain handles the rest. Page unloads after navigation.
    window.location.href = `/api/zerodha/login?account=${encodeURIComponent(account)}`
  }

  async function disconnect(account: string) {
    setBusy(b => ({ ...b, [account]: true }))
    try {
      const res = await fetch(`/api/zerodha/token?account=${encodeURIComponent(account)}`, { method: 'DELETE' })
      if (res.ok) {
        setConnected(c => c.filter(a => a !== account))
        setBanner({ text: `${account} disconnected`, ok: true })
      }
    } finally {
      setBusy(b => ({ ...b, [account]: false }))
    }
  }

  function copyCallbackUrl() {
    if (!callbackUrl) return
    navigator.clipboard?.writeText(callbackUrl).then(() => {
      setBanner({ text: '✓ Callback URL copied', ok: true })
      setTimeout(() => setBanner(null), 1800)
    }).catch(() => {})
  }

  return (
    <div className={`space-y-6 pb-4 ${tab === 'backtest' ? 'max-w-7xl' : 'max-w-2xl'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
            <span className="gold-text">Settings</span>
          </h1>
          {environment && (
            <span className="text-[10px] tracking-widest uppercase px-2 py-1 rounded"
              style={{
                background: environment === 'PROD' ? 'rgba(224,90,94,0.12)' : 'rgba(82,183,136,0.12)',
                border: `1px solid ${environment === 'PROD' ? 'rgba(224,90,94,0.35)' : 'rgba(82,183,136,0.35)'}`,
                color: environment === 'PROD' ? '#e05a5e' : '#52b788',
                fontFamily:'JetBrains Mono, monospace',
              }}>
              {environment}
            </span>
          )}
        </div>
        {savedFlash && (
          <span className="text-[11px]" style={{ color:'#52b788', fontFamily:'JetBrains Mono, monospace' }}>
            ✓ Saved
          </span>
        )}
      </div>

      {banner && (
        <div className="rounded-lg px-4 py-3 text-[12px]"
          style={{
            background: banner.ok ? 'rgba(82,183,136,0.08)' : 'rgba(224,90,94,0.08)',
            border: `1px solid ${banner.ok ? 'rgba(82,183,136,0.3)' : 'rgba(224,90,94,0.3)'}`,
            color: banner.ok ? '#52b788' : 'rgba(224,90,94,0.9)',
          }}>
          {banner.text}
        </div>
      )}

      {/* ── TAB SWITCHER ── */}
      <div className="flex gap-1 rounded-lg p-1 w-fit" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
        {([
          { id: 'general',    label: 'Accounts & Trading' },
          { id: 'strategies', label: 'Strategies' },
          { id: 'backtest',   label: 'Backtest' },
        ] as const).map(t => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-4 py-1.5 rounded-md text-[11px] transition-all"
              style={{
                background: active ? 'rgba(201,168,76,0.12)' : 'transparent',
                border: active ? '1px solid rgba(201,168,76,0.3)' : '1px solid transparent',
                color: active ? '#c9a84c' : 'rgba(255,255,255,0.5)',
                fontFamily:'JetBrains Mono, monospace',
              }}>
              {t.label}
            </button>
          )
        })}
      </div>

      <div style={{ display: tab === 'strategies' ? 'block' : 'none' }}>
        <StrategiesTab autoModeOn={mode === 'auto'} />
      </div>

      <div style={{ display: tab === 'backtest' ? 'block' : 'none' }}>
        <BacktestTab active={tab === 'backtest'} />
      </div>

      <div style={{ display: tab === 'general' ? 'block' : 'none' }}><>

      {/* ── TRADE MODE ── */}
      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-[11px] tracking-widest uppercase mb-4"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Trade Mode
        </h2>
        <div className="flex gap-3">
          {(['manual','auto'] as const).map(m => (
            <button key={m} onClick={() => changeMode(m)}
              className="flex-1 py-4 rounded-xl font-semibold tracking-wider uppercase text-[12px] transition-all"
              style={{
                background: mode === m
                  ? m === 'auto' ? 'rgba(82,183,136,0.15)' : 'rgba(201,168,76,0.15)'
                  : 'rgba(255,255,255,0.03)',
                border: mode === m
                  ? `1px solid ${m === 'auto' ? 'rgba(82,183,136,0.4)' : 'rgba(201,168,76,0.4)'}`
                  : '1px solid rgba(255,255,255,0.06)',
                color: mode === m
                  ? m === 'auto' ? '#52b788' : '#c9a84c'
                  : 'rgba(255,255,255,0.3)',
              }}>
              {m === 'auto' ? '⚡ Auto' : '✋ Manual'}
            </button>
          ))}
        </div>
        <p className="text-[11px] mt-3" style={{ color:'rgba(255,255,255,0.3)' }}>
          {mode === 'manual'
            ? 'Manual: recommendations shown with Execute button. You approve each trade.'
            : 'Auto: trades execute automatically every 5 min during market hours.'}
        </p>
        <RunMonitorButton />
      </div>

      {/* ── KITE CONNECT SETUP HINT ── */}
      {callbackUrl && (
        <div className="rounded-lg p-4"
          style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.12)' }}>
          <p className="text-[10px] tracking-widest uppercase mb-2"
            style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
            One-time setup
          </p>
          <p className="text-[11px] mb-2" style={{ color:'rgba(255,255,255,0.5)' }}>
            Set this as the <strong>Redirect URL</strong> in each Kite Connect app at developers.kite.trade:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded text-[11px] truncate"
              style={{ background:'rgba(0,0,0,0.3)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              {callbackUrl}
            </code>
            <button onClick={copyCallbackUrl}
              className="px-3 py-2 rounded text-[10px] tracking-wider uppercase"
              style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c' }}>
              Copy
            </button>
          </div>
        </div>
      )}

      {/* ── ACCOUNTS ── */}
      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-[11px] tracking-widest uppercase mb-4"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Zerodha Accounts
        </h2>

        {!loaded && <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.3)' }}>Loading…</p>}

        {loaded && accounts.length === 0 && (
          <p className="text-[11px]" style={{ color:'rgba(224,90,94,0.7)' }}>
            No accounts configured. Set ZERODHA_ACCOUNT1, ZERODHA_API_KEY_…, ZERODHA_API_SECRET_… in .env.local.
          </p>
        )}

        <div className="space-y-4">
          {accounts.map(acc => {
            const isConnected = connected.includes(acc.name)
            return (
              <div key={acc.name} className="rounded-lg p-4"
                style={{
                  background: isConnected ? `${acc.color}08` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isConnected ? acc.color + '33' : 'rgba(255,255,255,0.06)'}`,
                }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                    style={{ background:`${acc.color}20`, color:acc.color, border:`1px solid ${acc.color}40` }}>
                    {acc.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/85">{acc.displayName}</p>
                    {acc.note && <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.3)' }}>{acc.note}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium"
                    style={{
                      background: isConnected ? 'rgba(82,183,136,0.12)' : 'rgba(255,255,255,0.05)',
                      border: isConnected ? '1px solid rgba(82,183,136,0.3)' : '1px solid rgba(255,255,255,0.08)',
                      color: isConnected ? '#52b788' : 'rgba(255,255,255,0.4)',
                    }}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#52b788] animate-pulse-dot' : 'bg-white/20'}`} />
                    {isConnected ? 'Connected' : 'Not connected'}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => loginWithKite(acc.name)}
                    disabled={busy[acc.name]}
                    className="flex-1 py-2.5 rounded-lg text-[12px] font-semibold tracking-wider transition-all disabled:opacity-50"
                    style={{
                      background:'linear-gradient(135deg, rgba(82,183,136,0.3), rgba(82,183,136,0.15))',
                      border:'1px solid rgba(82,183,136,0.4)',
                      color:'#52b788',
                    }}>
                    {busy[acc.name]
                      ? 'Redirecting…'
                      : isConnected ? '↻ Re-login with Kite' : '⚡ Login with Kite'}
                  </button>
                  {isConnected && (
                    <button
                      onClick={() => disconnect(acc.name)}
                      disabled={busy[acc.name]}
                      className="px-3 py-2.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40"
                      style={{
                        background:'rgba(224,90,94,0.08)',
                        border:'1px solid rgba(224,90,94,0.2)',
                        color:'rgba(224,90,94,0.7)',
                      }}>
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-[10px] mt-3" style={{ color:'rgba(255,255,255,0.25)' }}>
          Tokens expire at 6 AM IST next day — re-login each morning. Token never touches the browser; stored server-side in your session.
        </p>

        {accounts.length > 1 && (
          <div className="rounded-lg p-3 mt-3" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[11px] mb-2" style={{ color:'rgba(255,255,255,0.5)' }}>
              Switching between accounts? Kite reuses your browser session — log out of the current Kite user first:
            </p>
            <a href="https://kite.zerodha.com/logout" target="_blank" rel="noopener noreferrer"
              className="inline-block px-3 py-1.5 rounded-lg text-[11px] font-medium tracking-wider transition-all"
              style={{ background:'rgba(201,168,76,0.08)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c' }}>
              ↗ Logout of Zerodha (new tab)
            </a>
          </div>
        )}
      </div>

      {/* ── STRATEGY RULES (read-only) ── */}
      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-[11px] tracking-widest uppercase mb-4"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Strategy Rules (Fixed — Read Only)
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Per Trade Cap', '₹5,000'],
            ['Max Positions', '10'],
            ['Max Buys/Day', '3'],
            ['Max Sells/Day', '3'],
            ['T1 Target', '+1.5%'],
            ['T2 Target', '+2.0%'],
            ['EMA Period', '20-day'],
            ['Entry Signal', '5%+ below EMA'],
            ['Short Selling', 'Never'],
            ['F&O', 'Never'],
            ['Auto Mode Loss-Sell', 'Never'],
            ['Circuit Breaker', 'GIFT Nifty −5%'],
            ['Order Type', 'CNC / Market'],
          ].map(([k,v]) => (
            <div key={k} className="flex justify-between items-center py-2 px-3 rounded-lg"
              style={{ background:'rgba(255,255,255,0.02)' }}>
              <span className="text-[11px]" style={{ color:'rgba(255,255,255,0.35)' }}>{k}</span>
              <span className="text-[11px] font-medium"
                style={{ color:'rgba(201,168,76,0.7)', fontFamily:'JetBrains Mono, monospace' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── DANGER ZONE: ACCOUNT RESET ── */}
      <ResetSection connected={connected} />

      </></div>

      <p className="text-[10px] text-center" style={{ color:'rgba(255,255,255,0.2)' }}>
        Settings persist until logout · Closing the browser does not log you out · Only Logout clears the session
      </p>
    </div>
  )
}

// ─────────────────────── STRATEGIES TAB (read-only, Phase 2) ───────────────────────

interface CapitalConfig {
  source: string
  perTrade: number
  maxBuysPerDay: number
  maxSellsPerDay: number
  circuitBreakerPct: number
  intradayCircuitTripPct?: number
  intradayCircuitResumePct?: number
  panicDropPct?: number
  panicWindowMin?: number
  maxDeployPct: number
  sharedPool: boolean
  maxPositions: number
  maxBuysPerSymbol: number
  minDropBetweenBuysPct: number
}

interface StrategyConfig {
  id: string
  name: string
  type: 'dip' | 'momentum'
  active: boolean
  color: string
  scanIntervalMin: number
  watchlist: string[]
  params: Record<string, unknown>
  exits: { t1Pct: number; t2Pct: number }
  giftNiftyGate?: { enabled: boolean; minPct?: number | null; maxPct?: number | null }
}

interface BacktestTrade {
  strategyId?: string
  strategyName?: string
  symbol: string
  signalDate: string
  entryDate: string
  entryPrice: number
  qty: number
  remainingQty: number
  buyNumber: number
  entryValue: number
  emaAtSignal: number
  deviationPct: number
  downDays: number
  confidence: 'normal' | 'high'
  target1: number
  target2: number
  exitDate?: string
  exitPrice?: number
  exitValue?: number
  charges?: number
  incurredCharges?: number
  chargeModel?: 'intraday' | 'delivery'
  realizedPnl: number
  netRealizedPnl?: number
  realizedPct: number
  holdDays: number
  status: 'closed' | 'open'
  markPrice: number
  markValue: number
  unrealizedPnl: number
  netUnrealizedPnl?: number
  netTotalPnl?: number
  setup?: string
  t1Date?: string
  t2Date?: string
}

interface BacktestEquityPoint {
  date: string
  cash: number
  marketValue: number
  equity: number
  drawdownPct: number
  openTrades: number
}

interface BacktestGateCount {
  gate: string
  label: string
  count: number
}

interface BacktestSummary {
  strategyId: string
  strategyName: string
  days: number
  tradingDays: number
  dipDays: number
  momentumDays: number
  startingCapital: number
  endingCapital: number
  totalCharges?: number
  incurredCharges?: number
  realizedPnl: number
  netRealizedPnl?: number
  unrealizedPnl: number
  netUnrealizedPnl?: number
  totalPnl: number
  netTotalPnl?: number
  totalReturnPct: number
  netTotalReturnPct?: number
  netEndingCapital?: number
  maxDrawdownPct: number
  tradesClosed: number
  tradesOpen: number
  wins: number
  losses: number
  winRate: number | null
  avgHoldDays: number | null
  skippedNoToken: number
  skippedNoHistorical: number
  skippedCapitalLimited: number
  skippedPositionLimited: number
  gateBreakdown: BacktestGateCount[]
}

interface StrategyBacktestResult {
  summary: BacktestSummary
  trades: BacktestTrade[]
  equityCurve: BacktestEquityPoint[]
}

interface BacktestHistoryEntry {
  runId: string
  timestamp: string
  strategyName: string
  strategyType: 'dip' | 'momentum' | 'all'
  entryParams: Record<string, unknown>
  exitCriteria: Record<string, unknown>
  startingAmount: number
  maxBuysPerDay: number
  maxSellsPerDay: number
  backtestDays: number
  closedTrades: number
  openTrades: number
  avgHoldDays: number | null
  avgDrawdownPct: number
  netProfitRupees: number
  netProfitPct: number
  realizedProfitRupees: number
  realizedProfitPct: number
  unrealizedMTM: number
  winRate: number | null
  capitalEfficiency: number
  avgDeployedCapital: number
  strategySnapshot?: StrategyConfig | null
  strategySnapshots?: StrategyConfig[]
}

type BacktestHistorySortKey = keyof BacktestHistoryEntry
type SortDirection = 'asc' | 'desc'
type BacktestWorkspaceTab = 'run' | 'history'
type BacktestHistoryView = 'overview' | 'performance' | 'risk' | 'config'

interface BacktestHistoryColumn {
  key: BacktestHistorySortKey
  label: string
  minWidth?: number
  render: (entry: BacktestHistoryEntry) => React.ReactNode
  color?: (entry: BacktestHistoryEntry) => string
}

const BACKTEST_HISTORY_VIEWS: { id: BacktestHistoryView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'performance', label: 'Performance' },
  { id: 'risk', label: 'Risk' },
  { id: 'config', label: 'Config' },
]

const STRATEGY_FIELD_LABELS: Record<string, string> = {
  id: 'Strategy ID',
  name: 'Strategy Name',
  type: 'Strategy Type',
  scanIntervalMin: 'Scan Interval',
  watchlist: 'Watchlists',
  active: 'Active',
  t1Pct: 'Target 1',
  t2Pct: 'Target 2',
  enabled: 'Enabled',
  minPct: 'Minimum GIFT Nifty %',
  maxPct: 'Maximum GIFT Nifty %',
}

const STRATEGY_FIELD_DESCRIPTIONS: Record<string, string> = {
  scanIntervalMin: 'How often this strategy scans for entries during market hours.',
  watchlist: 'The saved watchlists this run used for symbol selection.',
  active: 'Whether the strategy was active in the saved snapshot.',
}

const EXIT_DESCRIPTIONS: Record<string, string> = {
  t1Pct: 'First take-profit threshold used by the saved strategy snapshot.',
  t2Pct: 'Second take-profit threshold used by the saved strategy snapshot.',
}

const GIFT_GATE_DESCRIPTIONS: Record<string, string> = {
  enabled: 'Whether GIFT Nifty gating was enabled for this strategy snapshot.',
  minPct: 'Minimum GIFT Nifty move allowed before the strategy may enter.',
  maxPct: 'Maximum GIFT Nifty move allowed before the strategy is blocked.',
}

// One-line descriptions for each capital field — surfaced inline so the user
// understands what they're looking at without opening docs.
const CAPITAL_DESCRIPTIONS: Record<string, string> = {
  source: 'Where available funds come from. `live` = Zerodha getMargins each request.',
  perTrade: 'Maximum ₹ per individual trade in Auto mode. Manual orders bypass this cap.',
  maxBuysPerDay: 'Maximum BUYs per account per day, shared across all active strategies.',
  maxSellsPerDay: 'Maximum SELLs per account per day, shared across all active strategies.',
  circuitBreakerPct: 'GIFT Nifty pre-market drop that blocks new auto-BUYs all day (e.g. -5 = -5%). Open SELL monitors keep running; manual orders unaffected.',
  intradayCircuitTripPct: 'Live NIFTY 50 drop from today\'s open that trips the intraday circuit (e.g. -3). Blocks new auto-BUYs until Nifty recovers. SELL monitors + manual unaffected. Set to 0 to disable.',
  intradayCircuitResumePct: 'NIFTY 50 level at which the intraday circuit resumes auto-BUYs (e.g. -2). Must be greater than the trip threshold to provide hysteresis. Set to 0 to disable.',
  panicDropPct: 'Per-symbol panic-sell threshold (e.g. 3 = 3%). If a stock drops this much from its peak in the last N minutes, it\'s flagged as news-driven panic and skipped for the rest of the day. Set to 0 to disable.',
  panicWindowMin: 'Lookback window in minutes for the panic-sell check (e.g. 15). Step in multiples of 5 — measurement uses 5-min candles. Set to 0 to disable.',
  maxDeployPct: 'Never deploy more than this percentage of available funds. The remainder is reserve.',
  sharedPool: 'When true, every strategy draws from one common pool of funds.',
  maxPositions: 'Maximum number of simultaneously open positions per account.',
  maxBuysPerSymbol: 'Auto-mode pyramid cap: max BUYs that can stack into one position before sellout. Default 3.',
  minDropBetweenBuysPct: 'Each subsequent auto BUY must be at least this % below the previous BUY price. Default 10 = next BUY only if LTP ≤ previous × 0.90.',
}

// Descriptions for the params of each strategy type. Used in the cards so each
// number has a one-line explanation.
const DIP_PARAM_DESCRIPTIONS: Record<string, string> = {
  emaPeriod: 'EMA window in trading days (default 20).',
  entryBelowPct: 'Minimum % below 20-EMA to consider entering (e.g. 5 = at least 5% below).',
  strongBuyBelowPct: 'Threshold for "strong buy" tier — stock is this many % below EMA.',
  minDownDays: 'Minimum consecutive down days required for entry.',
  capitulationFloorPct: 'Capitulation floor — stocks more than this many % below 20-EMA are treated as news-event / panic, not mean-reversion. Engine tiles mark them red, and the BUY scan skips them. Default 12.',
  tranche2AboveEMAPct: 'Tranche 2 exit fires when LTP reaches EMA × (1 + this/100).',
  reactiveDrop: 'Intraday % drop that triggers an off-cycle re-scan (default 3%).',
  reactiveIntervalMin: 'How often (in min) the reactive scan runs during the day.',
  firesOnAnyMode: 'When true, the reactive scan fires regardless of market mode (dip / catalyst).',
  maxPerSector: 'Sector concentration cap — max DineshTrade-tracked open positions in the same NSE sector before new auto-BUYs for this strategy are blocked. Set to 0 to disable. Requires sector data in the watchlist (run the backfill script on EC2).',
}

const MOMENTUM_PARAM_DESCRIPTIONS: Record<string, string> = {
  minDayGainPct: 'Minimum % day-gain to qualify for momentum entry (e.g. 0.5 = +0.5%).',
  maxDayGainPct: 'Maximum % day-gain — above this and the move is considered too extended.',
  consecutiveCandles: 'Number of consecutive rising 5-min candles required.',
  emaProximityPct: 'LTP must be within ±this % of the 20-day EMA.',
  volumeAvgDays: 'Days of historical volume used to compute the daily average.',
  scanStartHHMM: 'Daily scan window start (IST 24-hr "HH:MM").',
  scanEndHHMM: 'Daily scan window end (IST 24-hr "HH:MM").',
  deliveryHandoffDays: 'Calendar days after first BUY before this strategy\'s position hands off to Accumulator (universal mean-reversion parking lot). Default 15. Set to 0 to disable handoff (position stays with this strategy indefinitely).',
  exitSameDayTime: 'Time (IST HH:MM) to check EOD behaviour. Default 15:10.',
  exitSameDayOnPositive: 'Sell at end of day if position is in profit — frees capital for tomorrow.',
  squareOffEOD: 'Always square all positions at end of day regardless of profit or loss. Never takes delivery. Overrides the no-loss gate.',
}

// Default param sets for the Duplicate / Create-New / Reset flows
const DEFAULT_DIP_PARAMS = {
  emaPeriod: 20, entryBelowPct: 5, strongBuyBelowPct: 8, minDownDays: 3,
  capitulationFloorPct: 12,
  tranche2AboveEMAPct: 3.0, reactiveDrop: 3.0, reactiveIntervalMin: 30, firesOnAnyMode: true,
  maxPerSector: 3,
}
const DEFAULT_MOMENTUM_PARAMS = {
  minDayGainPct: 0.5, maxDayGainPct: 1.5, consecutiveCandles: 3, emaProximityPct: 3.0,
  volumeAvgDays: 10, scanStartHHMM: '09:30', scanEndHHMM: '14:30',
  deliveryHandoffDays: 15,
  exitSameDayTime: '15:10', exitSameDayOnPositive: false, squareOffEOD: false,
}

// ──────────────────────────────────────────────────────────────────────────────
// RUN MONITOR NOW
// Manually triggers the SELL monitor + position reseeding outside cron hours.
// ──────────────────────────────────────────────────────────────────────────────

function RunMonitorButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const mono: React.CSSProperties = { fontFamily: 'JetBrains Mono, monospace' }

  async function run() {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/strategy/monitor', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.error) { setMsg(data.error || `HTTP ${res.status}`); return }
      const total = (data.results || []).reduce((n: number, r: any) => n + (r.positionsChecked || 0), 0)
      setMsg(`Done — ${total} position(s) checked`)
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 flex items-center gap-3 flex-wrap">
      <button onClick={run} disabled={busy}
        className="px-4 py-1.5 rounded-md text-[11px] transition-all disabled:opacity-40"
        style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa', ...mono }}>
        {busy ? 'Running…' : 'Sync Positions Now'}
      </button>
      {msg && <span className="text-[11px]" style={{ color: msg.startsWith('Done') ? '#52b788' : '#e05a5e', ...mono }}>{msg}</span>}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// RESET SECTION
// Wipes all journal + position data for a single account and re-seeds from Kite.
// ──────────────────────────────────────────────────────────────────────────────

interface SeededPosition { symbol: string; qty: number; avgPrice: number }

function ResetSection({ connected }: { connected: string[] }) {
  const [account, setAccount] = useState(connected[0] || '')
  const [showModal, setShowModal] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ seeded: SeededPosition[]; journalRecordsRemoved: number } | null>(null)
  const [error, setError] = useState('')

  // Keep selected account in sync if connected list changes
  const effectiveAccount = connected.includes(account) ? account : (connected[0] || '')

  async function doReset() {
    if (confirmText !== 'RESET') return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/settings/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: effectiveAccount, confirm: 'RESET' }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error || `HTTP ${res.status}`); return }
      setResult(data)
      setShowModal(false)
      setConfirmText('')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (connected.length === 0) return null

  const mono: React.CSSProperties = { fontFamily: 'JetBrains Mono, monospace' }
  const canConfirm = confirmText === 'RESET' && !busy

  return (
    <div className="rounded-xl p-5 mt-4" style={{ background: 'rgba(224,90,94,0.04)', border: '1px solid rgba(224,90,94,0.2)' }}>
      <h2 className="text-[11px] tracking-widest uppercase mb-1" style={{ color: 'rgba(224,90,94,0.7)', ...mono }}>Danger Zone</h2>
      <p className="text-[11px] mb-4" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Wipes all journal history and position data for the selected account, then re-imports current Kite holdings as Accumulator positions. Opening capital is recalculated from live Kite data.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        {/* Account picker */}
        <select value={effectiveAccount} onChange={e => setAccount(e.target.value)}
          className="px-3 py-1.5 rounded-md text-[11px] outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', ...mono }}>
          {connected.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <button onClick={() => { setShowModal(true); setConfirmText(''); setError('') }}
          className="px-4 py-1.5 rounded-md text-[11px] transition-all"
          style={{ background: 'rgba(224,90,94,0.12)', border: '1px solid rgba(224,90,94,0.4)', color: '#e05a5e', ...mono }}>
          Reset Account Data
        </button>
      </div>

      {result && (
        <div className="mt-3 p-3 rounded-md text-[11px]" style={{ background: 'rgba(82,183,136,0.08)', border: '1px solid rgba(82,183,136,0.25)', color: '#52b788', ...mono }}>
          Reset complete · {result.journalRecordsRemoved} journal records removed · {result.seeded.length} position{result.seeded.length !== 1 ? 's' : ''} re-seeded as Accumulator
          {result.seeded.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: 'rgba(82,183,136,0.7)' }}>
              {result.seeded.map(s => <span key={s.symbol}>{s.symbol} ×{s.qty} @ ₹{s.avgPrice.toFixed(2)}</span>)}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 text-[11px]" style={{ color: '#e05a5e', ...mono }}>{error}</p>
      )}

      {/* Confirmation modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="rounded-xl p-6 w-[400px] space-y-4" style={{ background: '#111', border: '1px solid rgba(224,90,94,0.4)' }}>
            <h3 className="text-[13px] font-semibold" style={{ color: '#e05a5e', ...mono }}>Confirm Account Reset</h3>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
              This will permanently delete all journal history for <span style={{ color: 'rgba(255,255,255,0.8)' }}>{effectiveAccount}</span> and re-import current Kite positions as Accumulator entries. This cannot be undone.
            </p>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Type <span style={{ color: '#e05a5e' }}>RESET</span> to confirm:
            </p>
            <input
              autoFocus
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canConfirm) doReset() }}
              placeholder="RESET"
              className="w-full px-3 py-2 rounded-md text-[12px] outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', ...mono }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowModal(false); setConfirmText('') }}
                className="px-4 py-1.5 rounded-md text-[11px]"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', ...mono }}>
                Cancel
              </button>
              <button onClick={doReset} disabled={!canConfirm}
                className="px-4 py-1.5 rounded-md text-[11px] transition-all disabled:opacity-40"
                style={{ background: canConfirm ? 'rgba(224,90,94,0.2)' : 'rgba(224,90,94,0.06)', border: '1px solid rgba(224,90,94,0.5)', color: '#e05a5e', ...mono }}>
                {busy ? 'Resetting…' : 'Reset Account'}
              </button>
            </div>
            {error && <p className="text-[11px]" style={{ color: '#e05a5e', ...mono }}>{error}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function StrategiesTab({ autoModeOn }: { autoModeOn: boolean }) {
  // The server response is the SOURCE; `draft` is the user's working copy.
  const [source, setSource] = useState<{ capital: CapitalConfig; strategies: StrategyConfig[]; watchlistOptions: { key: string; name: string }[]; openPositionCounts: Record<string, number> } | null>(null)
  const [draft, setDraft] = useState<{ capital: CapitalConfig; strategies: StrategyConfig[] } | null>(null)
  const [funds, setFunds] = useState<{ available: number; maxDeployable: number; reserve: number; remaining: number; deployed: number } | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [okMsg, setOkMsg] = useState('')

  // Auto-mode lock: when on, every edit input is disabled.
  const locked = autoModeOn

  useEffect(() => {
    fetch('/api/strategies').then(r => r.json()).then(d => {
      if (d.error) setError(d.error)
      else {
        // Prefer rich watchlistOptions (new); fall back to mapping legacy watchlistKeys.
        const opts = Array.isArray(d.watchlistOptions) && d.watchlistOptions.length > 0
          ? d.watchlistOptions
          : (Array.isArray(d.watchlistKeys) ? d.watchlistKeys.map((k: string) => ({ key: k, name: k })) : [])
        setSource({ capital: d.capital, strategies: d.strategies, watchlistOptions: opts, openPositionCounts: d.openPositionCounts || {} })
        setDraft({ capital: d.capital, strategies: d.strategies })
      }
    }).catch(() => setError('Failed to load strategies'))

    fetch('/api/state').then(r => r.json()).then(async s => {
      const accs: string[] = s.accountsWithToken || []
      if (accs.length === 0) return
      const r = await fetch(`/api/capital?account=${encodeURIComponent(accs[0])}`).then(r => r.json()).catch(() => null)
      if (r?.available !== undefined) setFunds(r)
    }).catch(() => {})
  }, [])

  if (error) return (
    <div className="rounded-lg p-3" style={{ background:'rgba(224,90,94,0.06)', border:'1px solid rgba(224,90,94,0.25)' }}>
      <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)' }}>✗ {error}</p>
    </div>
  )
  if (!source || !draft) return <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.4)' }}>Loading…</p>

  const dirty = JSON.stringify({ capital: source.capital, strategies: source.strategies }) !== JSON.stringify(draft)
  const diffLines = dirty ? buildDiff(source, draft) : []

  function patchCapital(patch: Partial<CapitalConfig>) {
    if (!draft) return
    setDraft({ ...draft, capital: { ...draft.capital, ...patch } })
  }
  function patchStrategy(id: string, patch: Partial<StrategyConfig>) {
    if (!draft) return
    setDraft({ ...draft, strategies: draft.strategies.map(s => s.id === id ? { ...s, ...patch } : s) })
  }
  function resetStrategy(id: string) {
    if (!source || !draft) return
    const orig = source.strategies.find(s => s.id === id)
    if (!orig) return
    setDraft({ ...draft, strategies: draft.strategies.map(s => s.id === id ? orig : s) })
  }
  function duplicateStrategy(id: string) {
    if (!draft) return
    const currentDraft = draft
    const orig = currentDraft.strategies.find(s => s.id === id)
    if (!orig) return
    let newId = `${id}_copy`
    let n = 2
    while (currentDraft.strategies.some(s => s.id === newId)) { newId = `${id}_copy_${n++}` }
    const copy: StrategyConfig = { ...JSON.parse(JSON.stringify(orig)), id: newId, name: `${orig.name} (copy)`, active: false }
    setDraft({ ...currentDraft, strategies: [...currentDraft.strategies, copy] })
    setExpanded(newId)
  }
  function deleteStrategy(id: string) {
    if (!draft) return
    if (id === 'accumulator') {
      alert('Accumulator cannot be deleted — it is the universal parking lot every other strategy hands off to.')
      return
    }
    const openCount = source?.openPositionCounts?.[id] ?? 0
    const msg = openCount > 0
      ? `Remove "${id}" — it has ${openCount} open position${openCount === 1 ? '' : 's'} which will be moved to Accumulator (and managed by Accumulator's exits) on save. Continue?`
      : `Remove "${id}"? This will stop its cron task on save.`
    if (!confirm(msg)) return
    setDraft({ ...draft, strategies: draft.strategies.filter(s => s.id !== id) })
  }

  // Confirm before deactivating a strategy with open positions — they migrate
  // to Accumulator on save. Returns true if the user confirmed (or no confirm
  // needed). Returns false to cancel.
  function confirmDeactivate(id: string, fromActive: boolean): boolean {
    if (!fromActive) return true   // activating doesn't need confirmation
    if (id === 'accumulator') {
      alert('Accumulator cannot be deactivated — it is the keeper strategy.')
      return false
    }
    const openCount = source?.openPositionCounts?.[id] ?? 0
    if (openCount === 0) return true
    return confirm(`Deactivate "${id}" — it has ${openCount} open position${openCount === 1 ? '' : 's'}. They will be moved to Accumulator on save. Continue?`)
  }
  // Two type-aware creators — pre-fill the correct param shape, exits,
  // scan interval, color, and GIFT Nifty gate defaults so a new strategy
  // starts in a sensible state. User can edit anything after.
  function createNewStrategy(type: 'dip' | 'momentum') {
    if (!draft) return
    const prefix = type === 'dip' ? 'new_dip' : 'new_momentum'
    let newId = prefix
    let n = 2
    while (draft.strategies.some(s => s.id === newId)) { newId = `${prefix}_${n++}` }
    const fresh: StrategyConfig = type === 'dip'
      ? {
          id: newId, name: 'New Dip Strategy', type: 'dip', active: false, color: '#52b788',
          scanIntervalMin: 30, watchlist: ['listA'],
          params: { ...DEFAULT_DIP_PARAMS }, exits: { t1Pct: 5.0, t2Pct: 8.0 },
          giftNiftyGate: { enabled: true, minPct: null, maxPct: -0.5 },
        }
      : {
          id: newId, name: 'New Momentum Strategy', type: 'momentum', active: false, color: '#a78bfa',
          scanIntervalMin: 5, watchlist: ['listA'],
          params: { ...DEFAULT_MOMENTUM_PARAMS }, exits: { t1Pct: 1.5, t2Pct: 2.0 },
          giftNiftyGate: { enabled: false, minPct: null, maxPct: null },
        }
    setDraft({ ...draft, strategies: [...draft.strategies, fresh] })
    setExpanded(newId)
  }

  async function doSave() {
    if (!draft) return
    setSaving(true); setError(''); setOkMsg('')
    try {
      const res = await fetch('/api/strategies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capital: draft.capital, strategies: draft.strategies }),
      })
      const data = await res.json()
      if (res.ok) {
        setSource({ capital: draft.capital, strategies: draft.strategies, watchlistOptions: source?.watchlistOptions || [], openPositionCounts: source?.openPositionCounts || {} })
        const r = data.reload
        const parts: string[] = []
        if (r?.added?.length)     parts.push(`+${r.added.length} added`)
        if (r?.removed?.length)   parts.push(`-${r.removed.length} removed`)
        if (r?.restarted?.length) parts.push(`~${r.restarted.length} restarted`)
        setOkMsg(`Saved · cron ${parts.length ? parts.join(', ') : 'unchanged'}`)
        setConfirming(false)
        setTimeout(() => setOkMsg(''), 4000)
      } else {
        const detail = data.errors?.length ? ' — ' + data.errors.join('; ') : ''
        setError((data.error || 'Save failed') + detail)
      }
    } catch (e) {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {locked && (
        <div className="rounded-lg p-3" style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.3)' }}>
          <p className="text-[12px]" style={{ color:'#f59e0b' }}>⚠ Auto mode is active — editing is disabled. Switch to Manual mode above to tune strategies.</p>
        </div>
      )}
      {okMsg && (
        <div className="rounded-lg p-3" style={{ background:'rgba(82,183,136,0.06)', border:'1px solid rgba(82,183,136,0.3)' }}>
          <p className="text-[12px]" style={{ color:'#52b788' }}>✓ {okMsg}</p>
        </div>
      )}

      {/* CAPITAL BLOCK — editable */}
      <div className="rounded-xl overflow-hidden" style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.2)' }}>
        <div className="px-4 py-2.5" style={{ borderBottom:'1px solid rgba(201,168,76,0.12)' }}>
          <p className="text-[11px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
            Shared Capital · applies to all strategies
          </p>
        </div>
        <div className="p-4 space-y-2.5">
          <NumField label="Per Trade Amount"  value={draft.capital.perTrade}        onChange={v => patchCapital({ perTrade: v })}        desc={CAPITAL_DESCRIPTIONS.perTrade}     prefix="₹"  disabled={locked} />
          <NumField label="Max Buys / Day"     value={draft.capital.maxBuysPerDay}   onChange={v => patchCapital({ maxBuysPerDay: v })}   desc={CAPITAL_DESCRIPTIONS.maxBuysPerDay}            disabled={locked} />
          <NumField label="Max Sells / Day"    value={draft.capital.maxSellsPerDay}  onChange={v => patchCapital({ maxSellsPerDay: v })}  desc={CAPITAL_DESCRIPTIONS.maxSellsPerDay}           disabled={locked} />
          <NumField label="Circuit Breaker % (GIFT Nifty, pre-market)" value={draft.capital.circuitBreakerPct} onChange={v => patchCapital({ circuitBreakerPct: v })} desc={CAPITAL_DESCRIPTIONS.circuitBreakerPct} suffix="%" disabled={locked} />
          <NumField label="Intraday Circuit Trip % (NIFTY 50 live)"    value={draft.capital.intradayCircuitTripPct ?? 0} onChange={v => patchCapital({ intradayCircuitTripPct: v })} desc={CAPITAL_DESCRIPTIONS.intradayCircuitTripPct} suffix="%" disabled={locked} />
          <NumField label="Intraday Circuit Resume %"                  value={draft.capital.intradayCircuitResumePct ?? 0} onChange={v => patchCapital({ intradayCircuitResumePct: v })} desc={CAPITAL_DESCRIPTIONS.intradayCircuitResumePct} suffix="%" disabled={locked} />
          <NumField label="Panic-Sell Drop % (per symbol)"             value={draft.capital.panicDropPct ?? 0} onChange={v => patchCapital({ panicDropPct: v })} desc={CAPITAL_DESCRIPTIONS.panicDropPct} suffix="%" disabled={locked} />
          <NumField label="Panic-Sell Window (min)"                    value={draft.capital.panicWindowMin ?? 0} onChange={v => patchCapital({ panicWindowMin: Math.max(0, v) })} desc={CAPITAL_DESCRIPTIONS.panicWindowMin} suffix="min" disabled={locked} />
          <NumField label="Max Deploy %"       value={draft.capital.maxDeployPct}    onChange={v => patchCapital({ maxDeployPct: v })}    desc={CAPITAL_DESCRIPTIONS.maxDeployPct}      suffix="%" disabled={locked} />
          <NumField label="Max Open Positions" value={draft.capital.maxPositions}    onChange={v => patchCapital({ maxPositions: v })}    desc={CAPITAL_DESCRIPTIONS.maxPositions}             disabled={locked} />
          <NumField label="Max BUYs / Symbol"  value={draft.capital.maxBuysPerSymbol} onChange={v => patchCapital({ maxBuysPerSymbol: v })} desc={CAPITAL_DESCRIPTIONS.maxBuysPerSymbol}        disabled={locked} />
          <NumField label="Min Drop Between BUYs" value={draft.capital.minDropBetweenBuysPct} onChange={v => patchCapital({ minDropBetweenBuysPct: v })} desc={CAPITAL_DESCRIPTIONS.minDropBetweenBuysPct} suffix="%" disabled={locked} />
        </div>
        {funds && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background:'rgba(255,255,255,0.04)', borderTop:'1px solid rgba(201,168,76,0.12)' }}>
            <Stat label="Live Available" value={`₹${Math.round(funds.available).toLocaleString('en-IN')}`} color="#c9a84c" />
            <Stat label="Max Deployable" value={`₹${Math.round(funds.maxDeployable).toLocaleString('en-IN')}`} color="rgba(255,255,255,0.7)" />
            <Stat label="Reserve" value={`₹${Math.round(funds.reserve).toLocaleString('en-IN')}`} color="rgba(255,255,255,0.5)" />
            <Stat label="Remaining" value={`₹${Math.round(funds.remaining).toLocaleString('en-IN')}`} color="#52b788" />
          </div>
        )}
      </div>

      {/* STRATEGY CARDS */}
      <div className="space-y-3">
        <p className="text-[11px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Strategies ({draft.strategies.length})
        </p>
        {draft.strategies.map(s => (
          <StrategyCard key={s.id} s={s}
            expanded={expanded === s.id}
            onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
            watchlistOptions={source.watchlistOptions}
            onPatch={p => patchStrategy(s.id, p)}
            onToggleActive={() => {
              if (confirmDeactivate(s.id, s.active)) patchStrategy(s.id, { active: !s.active })
            }}
            onReset={() => resetStrategy(s.id)}
            onDuplicate={() => duplicateStrategy(s.id)}
            onDelete={() => deleteStrategy(s.id)}
            canReset={!!source.strategies.find(o => o.id === s.id)}
            isProtected={s.id === 'accumulator'}
            locked={locked}
          />
        ))}

        {/* "Add another strategy" buttons — at the bottom, after all existing
            cards. Two type-aware buttons so the new strategy starts with the
            correct param shape, exits, and gate defaults. */}
        <div className="rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap"
          style={{ background:'rgba(255,255,255,0.02)', border:'1px dashed rgba(255,255,255,0.1)' }}>
          <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.5)' }}>Add another strategy</p>
          <div className="flex gap-2">
            <button onClick={() => createNewStrategy('dip')} disabled={locked}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium tracking-wider transition-all disabled:opacity-40"
              style={{ background:'rgba(82,183,136,0.12)', border:'1px solid rgba(82,183,136,0.4)', color:'#52b788', fontFamily:'JetBrains Mono, monospace' }}>
              + New Dip Strategy
            </button>
            <button onClick={() => createNewStrategy('momentum')} disabled={locked}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium tracking-wider transition-all disabled:opacity-40"
              style={{ background:'rgba(167,139,250,0.12)', border:'1px solid rgba(167,139,250,0.4)', color:'#a78bfa', fontFamily:'JetBrains Mono, monospace' }}>
              + New Momentum Strategy
            </button>
          </div>
        </div>
      </div>

      {/* SAVE BAR */}
      {dirty && (
        <div className="rounded-xl p-3 flex items-center justify-between sticky bottom-2"
          style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.4)', backdropFilter: 'blur(8px)' }}>
          <p className="text-[12px]" style={{ color:'#c9a84c' }}>
            ● {diffLines.length} change{diffLines.length === 1 ? '' : 's'} pending
          </p>
          <div className="flex gap-2">
            <button onClick={() => setDraft({ capital: source.capital, strategies: source.strategies })}
              className="px-3 py-1.5 rounded-md text-[11px]"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)' }}>
              Discard
            </button>
            <button onClick={() => setConfirming(true)} disabled={locked}
              className="px-4 py-1.5 rounded-md text-[11px] font-semibold tracking-wider disabled:opacity-40"
              style={{ background:'linear-gradient(135deg, #8a6a1a, #c9a84c)', color:'#080604' }}>
              Review & Save
            </button>
          </div>
        </div>
      )}

      {/* CONFIRMATION DIALOG — rendered via portal to document.body so that the
          fixed overlay is not trapped by the animated <main> ancestor whose
          transform:translateY(0) creates a new containing block for position:fixed. */}
      {confirming && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
          style={{ background:'rgba(0,0,0,0.7)', backdropFilter:'blur(4px)' }} onClick={() => setConfirming(false)}>
          <div className="w-full max-w-xl rounded-xl overflow-hidden" onClick={e => e.stopPropagation()}
            style={{ background:'#100e0a', border:'1px solid rgba(201,168,76,0.3)' }}>
            <div className="px-5 py-3 flex items-center justify-between"
              style={{ borderBottom:'1px solid rgba(201,168,76,0.15)' }}>
              <p className="text-[12px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                Confirm {diffLines.length} change{diffLines.length === 1 ? '' : 's'}
              </p>
              <button onClick={() => setConfirming(false)} className="text-white/40 hover:text-white/80">✕</button>
            </div>
            <div className="p-5 max-h-[60vh] overflow-y-auto space-y-1.5">
              {diffLines.map((d, i) => (
                <div key={i} className="text-[11px] flex gap-2" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                  <span style={{ color:'rgba(255,255,255,0.4)' }}>•</span>
                  <span style={{ color:'rgba(255,255,255,0.85)' }}>{d.path}</span>
                  <span style={{ color:'rgba(224,90,94,0.7)', textDecoration:'line-through' }}>{d.from}</span>
                  <span style={{ color:'rgba(255,255,255,0.4)' }}>→</span>
                  <span style={{ color:'#52b788' }}>{d.to}</span>
                </div>
              ))}
            </div>
            {error && <p className="px-5 pb-2 text-[11px]" style={{ color:'rgba(224,90,94,0.9)' }}>✗ {error}</p>}
            <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop:'1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setConfirming(false)} disabled={saving}
                className="px-3 py-1.5 rounded-md text-[11px]"
                style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)' }}>
                Cancel
              </button>
              <button onClick={doSave} disabled={saving}
                className="px-4 py-1.5 rounded-md text-[11px] font-semibold tracking-wider"
                style={{ background:'linear-gradient(135deg, #8a6a1a, #c9a84c)', color:'#080604' }}>
                {saving ? 'Saving…' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {error && !confirming && (
        <div className="rounded-lg p-3" style={{ background:'rgba(224,90,94,0.06)', border:'1px solid rgba(224,90,94,0.25)' }}>
          <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)' }}>✗ {error}</p>
        </div>
      )}
    </div>
  )
}

function BacktestTab({ active }: { active: boolean }) {
  const [workspaceTab, setWorkspaceTab] = useState<BacktestWorkspaceTab>('run')
  const [strategies, setStrategies] = useState<StrategyConfig[]>([])
  const [strategyId, setStrategyId] = useState('accumulator')
  const [days, setDays] = useState(60)
  const [capital, setCapital] = useState(50000)
  const [history, setHistory] = useState<BacktestHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historySortKey, setHistorySortKey] = useState<BacktestHistorySortKey>('timestamp')
  const [historySortDirection, setHistorySortDirection] = useState<SortDirection>('desc')
  const [historyView, setHistoryView] = useState<BacktestHistoryView>('overview')
  const [analysis, setAnalysis] = useState('')
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [loadedRunId, setLoadedRunId] = useState('')
  const [loadedRunLabel, setLoadedRunLabel] = useState('')
  const [loadedRunType, setLoadedRunType] = useState<'dip' | 'momentum' | 'all' | ''>('')
  const [previewEntry, setPreviewEntry] = useState<BacktestHistoryEntry | null>(null)
  const [snapshotEditor, setSnapshotEditor] = useState('')
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [result, setResult] = useState<StrategyBacktestResult | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false

    async function loadStrategies() {
      try {
        setError('')
        const [strategyRes, historyRes] = await Promise.all([
          fetch('/api/strategies').then(r => r.json()),
          fetch('/api/strategy/backtest/history').then(r => r.json()).catch(() => ({ runs: [] })),
        ])
        if (cancelled) return
        if (strategyRes.error) {
          setStrategies([])
          setError(strategyRes.error)
          return
        }
        const nextStrategies = Array.isArray(strategyRes.strategies) ? strategyRes.strategies as StrategyConfig[] : []
        setStrategies(nextStrategies)
        setStrategyId(current => nextStrategies.some(s => s.id === current) ? current : (nextStrategies[0]?.id || 'accumulator'))
        setHistory(Array.isArray(historyRes.runs) ? historyRes.runs as BacktestHistoryEntry[] : [])
        setHistoryError(historyRes.error || '')
      } catch {
        if (!cancelled) {
          setStrategies([])
          setError('Failed to load strategies')
        }
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }

    loadStrategies()
    return () => { cancelled = true }
  }, [active])

  const selected = strategies.find(s => s.id === strategyId) || null
  const activeStrategies = strategies.filter(s => s.active)

  async function loadHistory() {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const data = await fetch('/api/strategy/backtest/history').then(r => r.json())
      if (data.error) {
        setHistoryError(data.error)
        return
      }
      setHistory(Array.isArray(data.runs) ? data.runs as BacktestHistoryEntry[] : [])
    } catch {
      setHistoryError('Failed to load backtest history')
    } finally {
      setHistoryLoading(false)
    }
  }

  function toggleHistorySort(key: BacktestHistorySortKey) {
    if (historySortKey === key) {
      setHistorySortDirection(current => current === 'asc' ? 'desc' : 'asc')
      return
    }
    setHistorySortKey(key)
    setHistorySortDirection('desc')
  }

  function parseLoadedSnapshot(runAllActive: boolean): { strategyId?: string; strategySnapshot?: StrategyConfig; strategySnapshots?: StrategyConfig[] } {
    if (!loadedRunId || !snapshotEditor.trim()) return {}
    const parsed = JSON.parse(snapshotEditor)
    if (runAllActive) {
      if (!Array.isArray(parsed)) throw new Error('Loaded Run All snapshot must be a JSON array of strategies')
      return { strategySnapshots: parsed as StrategyConfig[] }
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') {
      throw new Error('Loaded strategy snapshot must be a JSON object with an id')
    }
    return { strategyId: parsed.id, strategySnapshot: parsed as StrategyConfig }
  }

  async function runBacktest(runAllActive = false) {
    if (!runAllActive && !selected) return
    if (runAllActive && activeStrategies.length === 0) return
    setLoading(true)
    setError('')
    setInfo('')
    try {
      const overrides = parseLoadedSnapshot(runAllActive)
      const res = await fetch('/api/strategy/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: runAllActive ? undefined : (overrides.strategyId || selected?.id),
          runAllActive,
          days: Math.max(10, Math.min(180, Math.round(days || 60))),
          initialCapital: Math.max(1000, Math.round(capital || 50000)),
          strategySnapshot: runAllActive ? undefined : overrides.strategySnapshot,
          strategySnapshots: runAllActive ? overrides.strategySnapshots : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult(null)
        setError(data.error || `Backtest failed (HTTP ${res.status})`)
        return
      }
      setResult(data.result || null)
      if (data.historyEntry) {
        setHistory(current => [data.historyEntry as BacktestHistoryEntry, ...current.filter(item => item.runId !== data.historyEntry.runId)])
      } else {
        void loadHistory()
      }
      setInfo(runAllActive
        ? `Backtest completed for ${activeStrategies.length} active strategies and saved to history`
        : `Backtest completed for ${overrides.strategySnapshot?.name || selected?.name} and saved to history`)
    } catch (err) {
      setResult(null)
      const message = err instanceof Error ? err.message : ''
      setError(message || (loadedRunId ? 'Failed to run the loaded backtest snapshot' : 'Network error while running backtest'))
    } finally {
      setLoading(false)
    }
  }

  function loadHistoryRun(entry: BacktestHistoryEntry) {
    setWorkspaceTab('run')
    setDays(entry.backtestDays)
    setCapital(entry.startingAmount)
    setLoadedRunId(entry.runId)
    setLoadedRunLabel(`${entry.strategyName} · ${formatDateTime(entry.timestamp)}`)
    setLoadedRunType(entry.strategyType)
    setResult(null)
    setError('')
    setAnalysis('')
    if (entry.strategyType === 'all') {
      setSnapshotEditor(JSON.stringify(entry.strategySnapshots || [], null, 2))
      setInfo(`Loaded ${entry.strategyName} snapshot from history. Run All Active will use the saved strategy set from ${formatDateTime(entry.timestamp)}.`)
      return
    }
    if (entry.strategySnapshot?.id) setStrategyId(entry.strategySnapshot.id)
    setSnapshotEditor(JSON.stringify(entry.strategySnapshot || {}, null, 2))
    setInfo(`Loaded ${entry.strategyName} snapshot from history. You can tweak the JSON below and rerun.`)
  }

  function clearLoadedRun() {
    setLoadedRunId('')
    setLoadedRunLabel('')
    setLoadedRunType('')
    setSnapshotEditor('')
    setInfo('Loaded backtest snapshot cleared')
  }

  function openHistoryPreview(entry: BacktestHistoryEntry) {
    setPreviewEntry(entry)
  }

  function confirmHistoryLoad() {
    if (!previewEntry) return
    loadHistoryRun(previewEntry)
    setPreviewEntry(null)
  }

  async function resetTests() {
    if (!confirm('Reset Tests will permanently delete all saved backtest history. This cannot be undone. Continue?')) return
    setHistoryLoading(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch('/api/strategy/backtest/history', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Reset failed (HTTP ${res.status})`)
        return
      }
      setHistory([])
      setAnalysis('')
      setInfo('Backtest history reset')
    } catch {
      setError('Failed to reset backtest history')
    } finally {
      setHistoryLoading(false)
    }
  }

  async function analyseTests() {
    if (history.length < 3) {
      setError('Run at least 3 backtests with different parameters before analysing for meaningful insights.')
      return
    }
    if (!confirm(`Analyse ${history.length} saved backtest runs with the configured AI provider? This will make one API call.`)) return
    setAnalysisLoading(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch('/api/strategy/backtest/history/analyze', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Analysis failed (HTTP ${res.status})`)
        return
      }
      setAnalysis(typeof data.analysis === 'string' ? data.analysis : '')
      setInfo('Backtest history analysis completed')
    } catch {
      setError('Failed to analyse backtest history')
    } finally {
      setAnalysisLoading(false)
    }
  }

  const sortedHistory = [...history].sort((a, b) => compareBacktestHistory(a, b, historySortKey, historySortDirection))
  const historyColumns = getBacktestHistoryColumns(historyView)
  const bestHistoryRun = sortedHistory.reduce<BacktestHistoryEntry | null>((best, entry) => {
    if (!best || entry.realizedProfitRupees > best.realizedProfitRupees) return entry
    return best
  }, null)
  const worstHistoryRun = sortedHistory.reduce<BacktestHistoryEntry | null>((worst, entry) => {
    if (!worst || entry.realizedProfitRupees < worst.realizedProfitRupees) return entry
    return worst
  }, null)
  const avgHistoryRealizedProfit = sortedHistory.length > 0
    ? sortedHistory.reduce((sum, entry) => sum + entry.realizedProfitRupees, 0) / sortedHistory.length
    : null
  const avgHistoryWinRate = sortedHistory.length > 0
    ? sortedHistory.reduce((sum, entry) => sum + (entry.winRate ?? 0), 0) / sortedHistory.length
    : null

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-lg p-1 w-fit" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
        {([
          { id: 'run', label: 'Backtest' },
          { id: 'history', label: 'Backtest History' },
        ] as const).map(tab => {
          const activeTab = workspaceTab === tab.id
          return (
            <button key={tab.id} onClick={() => setWorkspaceTab(tab.id)}
              className="px-4 py-1.5 rounded-md text-[11px] transition-all"
              style={{
                background: activeTab ? 'rgba(201,168,76,0.12)' : 'transparent',
                border: activeTab ? '1px solid rgba(201,168,76,0.3)' : '1px solid transparent',
                color: activeTab ? '#c9a84c' : 'rgba(255,255,255,0.5)',
                fontFamily:'JetBrains Mono, monospace',
              }}>
              {tab.label}
            </button>
          )
        })}
      </div>

      {workspaceTab === 'run' && (
        <>
      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[11px] tracking-widest uppercase mb-2"
              style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
              Strategy Backtest
            </h2>
            <p className="text-[12px] max-w-xl" style={{ color:'rgba(255,255,255,0.45)' }}>
              Pick a saved strategy, choose the lookback window, and replay it on historical candles. `Run All Active` simulates the real shared-capital environment where active strategies run together and compete for the same cash pool and position limits.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => runBacktest(false)} disabled={loading || !selected}
              className="px-5 py-2.5 rounded-xl text-[12px] font-semibold tracking-wider transition-all disabled:opacity-40"
              style={{ background:'linear-gradient(135deg, #7a5510, #c9a84c)', color:'#080604' }}>
              {loading ? 'Running…' : 'Run Selected'}
            </button>
            <button onClick={() => runBacktest(true)} disabled={loading || activeStrategies.length === 0}
              className="px-5 py-2.5 rounded-xl text-[12px] font-semibold tracking-wider transition-all disabled:opacity-40"
              style={{ background:'rgba(82,183,136,0.16)', border:'1px solid rgba(82,183,136,0.35)', color:'#52b788' }}>
              {loading ? 'Running…' : `Run All Active (${activeStrategies.length})`}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          <div>
            <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color:'rgba(201,168,76,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
              Strategy
            </label>
            <select value={strategyId}
              onChange={e => {
                setStrategyId(e.target.value)
                setResult(null)
                setError('')
                setInfo('')
              }}
              className="w-full px-3 py-2.5 rounded-lg text-[12px] outline-none"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              {strategies.map(strategy => (
                <option key={strategy.id} value={strategy.id}>{strategy.name} · {strategy.type}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color:'rgba(201,168,76,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
              Trading Days
            </label>
            <input type="number" min={10} max={180} step={1} value={days}
              onChange={e => setDays(parseInt(e.target.value || '60', 10))}
              className="w-full px-3 py-2.5 rounded-lg text-[12px] outline-none"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }} />
          </div>
          <div>
            <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color:'rgba(201,168,76,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
              Starting Capital
            </label>
            <input type="number" min={1000} step={1000} value={capital}
              onChange={e => setCapital(parseInt(e.target.value || '50000', 10))}
              className="w-full px-3 py-2.5 rounded-lg text-[12px] outline-none"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            {selected && (
              <span className="text-[10px] tracking-widest uppercase px-2 py-1 rounded"
                style={{ background:`${selected.color}18`, border:`1px solid ${selected.color}55`, color:selected.color, fontFamily:'JetBrains Mono, monospace' }}>
                {selected.name} · {selected.type}
              </span>
            )}
            {selected?.active === false && (
              <span className="text-[10px] tracking-widest uppercase px-2 py-1 rounded"
                style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.45)', fontFamily:'JetBrains Mono, monospace' }}>
                inactive strategy
              </span>
            )}
          </div>
          <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.32)' }}>
            Backtest runs against the saved strategy configuration. `Run All Active` now uses one shared capital pool across active saved strategies.
          </p>
        </div>

        {loadedRunId && (
          <div className="mt-4 rounded-lg p-4" style={{ background:'rgba(96,165,250,0.06)', border:'1px solid rgba(96,165,250,0.25)' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <p className="text-[11px] tracking-widest uppercase" style={{ color:'#60a5fa', fontFamily:'JetBrains Mono, monospace' }}>
                Loaded Historical Snapshot · {loadedRunLabel || loadedRunId}
              </p>
              <button onClick={clearLoadedRun}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold tracking-wider"
                style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.7)' }}>
                Clear Loaded Snapshot
              </button>
            </div>
            <p className="text-[11px] mb-3" style={{ color:'rgba(255,255,255,0.42)' }}>
              This editor is populated from the saved run. Adjust the snapshot JSON and rerun to compare variants without overwriting today&apos;s saved strategy config.
            </p>
            <textarea
              value={snapshotEditor}
              onChange={e => setSnapshotEditor(e.target.value)}
              rows={loadedRunType === 'all' ? 18 : 12}
              className="w-full px-3 py-2.5 rounded-lg text-[11px] outline-none"
              style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(96,165,250,0.22)', color:'rgba(255,255,255,0.82)', fontFamily:'JetBrains Mono, monospace' }}
            />
          </div>
        )}
      </div>

      </>
      )}

      {!loaded && <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.4)' }}>Loading…</p>}

      {workspaceTab === 'run' && selected?.type === 'momentum' && (
        <div className="rounded-lg p-3" style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.3)' }}>
          <p className="text-[12px]" style={{ color:'#f59e0b' }}>
            Momentum replay uses 5-minute historical candles, so it is materially heavier than dip backtests. Expect a longer run time on larger watchlists.
          </p>
        </div>
      )}

      {info && (
        <div className="rounded-lg p-3" style={{ background:'rgba(82,183,136,0.06)', border:'1px solid rgba(82,183,136,0.3)' }}>
          <p className="text-[12px]" style={{ color:'#52b788' }}>✓ {info}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg p-3" style={{ background:'rgba(224,90,94,0.06)', border:'1px solid rgba(224,90,94,0.25)' }}>
          <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)' }}>✗ {error}</p>
        </div>
      )}

      {workspaceTab === 'history' && analysis && (
        <div className="rounded-xl overflow-hidden" style={{ background:'rgba(96,165,250,0.05)', border:'1px solid rgba(96,165,250,0.2)' }}>
          <div className="px-4 py-2.5" style={{ borderBottom:'1px solid rgba(96,165,250,0.14)' }}>
            <p className="text-[11px] tracking-widest uppercase" style={{ color:'#60a5fa', fontFamily:'JetBrains Mono, monospace' }}>
              Backtest Insights
            </p>
          </div>
          <div className="p-4">
            <pre className="whitespace-pre-wrap text-[12px] leading-6" style={{ color:'rgba(255,255,255,0.82)', fontFamily:'Outfit, sans-serif' }}>{analysis}</pre>
          </div>
        </div>
      )}

      {workspaceTab === 'history' && (
      <div className="rounded-xl overflow-hidden" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <p className="text-[11px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
              Backtest History ({history.length})
            </p>
            <p className="text-[10px] mt-1" style={{ color:'rgba(255,255,255,0.3)' }}>
              Every completed run is saved on the server and can be reloaded into the backtest config.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={loadHistory} disabled={historyLoading}
              className="px-4 py-2.5 rounded-xl text-[12px] font-semibold tracking-wider transition-all disabled:opacity-40"
              style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.78)' }}>
              {historyLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button onClick={resetTests} disabled={historyLoading || history.length === 0}
              className="px-4 py-2.5 rounded-xl text-[12px] font-semibold tracking-wider transition-all disabled:opacity-40"
              style={{ background:'rgba(224,90,94,0.12)', border:'1px solid rgba(224,90,94,0.35)', color:'#e05a5e' }}>
              Reset Tests
            </button>
            <button onClick={analyseTests} disabled={analysisLoading || history.length < 3}
              className="px-4 py-2.5 rounded-xl text-[12px] font-semibold tracking-wider transition-all disabled:opacity-40"
              style={{ background:'rgba(96,165,250,0.12)', border:'1px solid rgba(96,165,250,0.35)', color:'#60a5fa' }}>
              {analysisLoading ? 'Analysing…' : 'Analyse Tests'}
            </button>
          </div>
        </div>

        <div className="px-4 pt-4">
          <div className="flex gap-1 rounded-lg p-1 w-fit" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
            {BACKTEST_HISTORY_VIEWS.map(view => {
              const activeView = historyView === view.id
              return (
                <button key={view.id} onClick={() => setHistoryView(view.id)}
                  className="px-3 py-1.5 rounded-md text-[10px] tracking-widest uppercase transition-all"
                  style={{
                    background: activeView ? 'rgba(201,168,76,0.12)' : 'transparent',
                    border: activeView ? '1px solid rgba(201,168,76,0.28)' : '1px solid transparent',
                    color: activeView ? '#c9a84c' : 'rgba(255,255,255,0.45)',
                    fontFamily:'JetBrains Mono, monospace',
                  }}>
                  {view.label}
                </button>
              )
            })}
          </div>
        </div>

        {history.length > 0 && (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 px-4 pt-4">
            <MiniMetric
              label="Best Realized Run"
              value={bestHistoryRun ? formatSignedCurrency(bestHistoryRun.realizedProfitRupees) : '—'}
              valueColor={bestHistoryRun && bestHistoryRun.realizedProfitRupees >= 0 ? '#52b788' : '#e05a5e'}
            />
            <MiniMetric
              label="Worst Realized Run"
              value={worstHistoryRun ? formatSignedCurrency(worstHistoryRun.realizedProfitRupees) : '—'}
              valueColor={worstHistoryRun && worstHistoryRun.realizedProfitRupees >= 0 ? '#52b788' : '#e05a5e'}
            />
            <MiniMetric
              label="Average Realized"
              value={avgHistoryRealizedProfit === null ? '—' : formatSignedCurrency(avgHistoryRealizedProfit)}
              valueColor={avgHistoryRealizedProfit !== null && avgHistoryRealizedProfit >= 0 ? '#52b788' : '#e05a5e'}
            />
            <MiniMetric
              label="Average Win Rate"
              value={avgHistoryWinRate === null ? '—' : `${avgHistoryWinRate.toFixed(2)}%`}
              valueColor="#c9a84c"
            />
          </div>
        )}

        {historyError && (
          <div className="px-4 pt-4">
            <div className="rounded-lg p-3" style={{ background:'rgba(224,90,94,0.06)', border:'1px solid rgba(224,90,94,0.25)' }}>
              <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)' }}>✗ {historyError}</p>
            </div>
          </div>
        )}

        {history.length < 3 && (
          <div className="px-4 pt-4">
            <div className="rounded-lg p-3" style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.25)' }}>
              <p className="text-[12px]" style={{ color:'#f59e0b' }}>
                Run at least 3 backtests with different parameters before analysing for meaningful insights.
              </p>
            </div>
          </div>
        )}

        {historyLoading && history.length === 0 ? (
          <p className="px-4 py-4 text-[11px]" style={{ color:'rgba(255,255,255,0.4)' }}>Loading backtest history…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1120px]">
              <thead>
                <tr style={{ background:'rgba(255,255,255,0.02)' }}>
                  <th className="px-3 py-2 text-[10px] tracking-widest uppercase font-medium sticky left-0 z-20" style={{ minWidth:190, background:'#15120d', color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>
                    <button onClick={() => toggleHistorySort('timestamp')} className="inline-flex items-center gap-1" style={{ color:'inherit' }}>
                      <span>Saved On</span>
                      {historySortKey === 'timestamp' && <span>{historySortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-[10px] tracking-widest uppercase font-medium sticky left-[190px] z-20" style={{ minWidth:260, background:'#15120d', color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>
                    <button onClick={() => toggleHistorySort('strategyName')} className="inline-flex items-center gap-1" style={{ color:'inherit' }}>
                      <span>Strategy</span>
                      {historySortKey === 'strategyName' && <span>{historySortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                  {historyColumns.map(column => (
                    <th key={column.key} className="px-3 py-2 text-[10px] tracking-widest uppercase font-medium" style={{ minWidth:column.minWidth, color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>
                      <button onClick={() => toggleHistorySort(column.key)} className="inline-flex items-center gap-1" style={{ color:'inherit' }}>
                        <span>{column.label}</span>
                        {historySortKey === column.key && <span>{historySortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </button>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-[10px] tracking-widest uppercase font-medium sticky right-0 z-20 text-right" style={{ minWidth:110, background:'#15120d', color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedHistory.map(entry => (
                  <tr key={entry.runId} style={{ borderTop:'1px solid rgba(255,255,255,0.05)' }}>
                    <td className="px-3 py-3 text-[11px] sticky left-0 z-10 whitespace-nowrap align-middle" style={{ minWidth:190, background:'#100e0a', color:'rgba(255,255,255,0.7)', fontFamily:'JetBrains Mono, monospace' }}>{formatDateTime(entry.timestamp)}</td>
                    <td className="px-3 py-3 sticky left-[190px] z-10 align-middle" style={{ minWidth:260, background:'#100e0a' }}>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px]" style={{ color:'rgba(255,255,255,0.82)' }}>{entry.strategyName}</span>
                        <span className="text-[10px] tracking-widest uppercase" style={{ color: entry.strategyType === 'all' ? '#60a5fa' : entry.strategyType === 'momentum' ? '#52b788' : '#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>{entry.strategyType}</span>
                      </div>
                    </td>
                    {historyColumns.map(column => (
                      <td key={column.key} className="px-3 py-3 text-[11px] align-middle whitespace-nowrap" style={{ minWidth:column.minWidth, color:column.color ? column.color(entry) : 'rgba(255,255,255,0.74)', fontFamily:'JetBrains Mono, monospace' }}>
                        {column.render(entry)}
                      </td>
                    ))}
                    <td className="px-3 py-3 sticky right-0 z-10 text-right align-middle" style={{ minWidth:110, background:'#100e0a' }}>
                      <button onClick={() => openHistoryPreview(entry)}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold tracking-wider"
                        style={{ background:'rgba(201,168,76,0.12)', border:'1px solid rgba(201,168,76,0.3)', color:'#c9a84c' }}>
                        Load
                      </button>
                    </td>
                  </tr>
                ))}
                {sortedHistory.length === 0 && (
                  <tr>
                    <td colSpan={historyColumns.length + 3} className="px-4 py-8 text-center text-[11px]" style={{ color:'rgba(255,255,255,0.35)' }}>
                      No saved backtests yet. Run a backtest and it will appear here automatically.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {workspaceTab === 'run' && result && (
        <div className="space-y-5">
          <div className="rounded-xl overflow-hidden" style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.2)' }}>
            <div className="px-4 py-2.5" style={{ borderBottom:'1px solid rgba(201,168,76,0.12)' }}>
              <p className="text-[11px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                Summary · {result.summary.strategyName}
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ background:'rgba(255,255,255,0.04)' }}>
              <Stat label="Gross P&L (MTM)" value={formatSignedCurrency(result.summary.totalPnl)} color={result.summary.totalPnl >= 0 ? '#52b788' : '#e05a5e'} />
              <Stat label="Net P&L (MTM)" value={formatSignedCurrency(result.summary.netTotalPnl ?? result.summary.totalPnl)} color={(result.summary.netTotalPnl ?? result.summary.totalPnl) >= 0 ? '#52b788' : '#e05a5e'} />
              <Stat label="Gross Return (MTM)" value={formatSignedPct(result.summary.totalReturnPct)} color={result.summary.totalReturnPct >= 0 ? '#52b788' : '#e05a5e'} />
              <Stat label="Net Return (MTM)" value={formatSignedPct(result.summary.netTotalReturnPct ?? result.summary.totalReturnPct)} color={(result.summary.netTotalReturnPct ?? result.summary.totalReturnPct) >= 0 ? '#52b788' : '#e05a5e'} />
              <Stat label="Max Drawdown" value={`${result.summary.maxDrawdownPct.toFixed(2)}%`} color="rgba(224,90,94,0.85)" />
              <Stat label="Starting Capital" value={formatCurrency(result.summary.startingCapital)} color="rgba(255,255,255,0.7)" />
              <Stat label="Gross Ending Equity" value={formatCurrency(result.summary.endingCapital)} color="rgba(255,255,255,0.82)" />
              <Stat label="Net Ending Equity" value={formatCurrency(result.summary.netEndingCapital ?? result.summary.endingCapital)} color="rgba(255,255,255,0.9)" />
              <Stat label="Win Rate" value={result.summary.winRate === null ? '—' : `${result.summary.winRate.toFixed(2)}%`} color="#c9a84c" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
              <MiniMetric label="Trading Days" value={String(result.summary.tradingDays)} />
              <MiniMetric label="Dip Days" value={String(result.summary.dipDays)} />
              <MiniMetric label="Momentum Days" value={String(result.summary.momentumDays)} />
              <MiniMetric label="Wins / Losses" value={`${result.summary.wins} / ${result.summary.losses}`} />
              <MiniMetric label="Trades Closed" value={String(result.summary.tradesClosed)} />
              <MiniMetric label="Trades Open" value={String(result.summary.tradesOpen)} />
              <MiniMetric label="Avg Hold" value={result.summary.avgHoldDays === null ? '—' : `${result.summary.avgHoldDays.toFixed(1)} d`} />
              <MiniMetric
                label="Gross Realized P&L"
                value={`${formatSignedCurrency(result.summary.realizedPnl)} · ${formatSignedPct((result.summary.realizedPnl / result.summary.startingCapital) * 100)}`}
                valueColor={result.summary.realizedPnl >= 0 ? '#52b788' : '#e05a5e'}
              />
              <MiniMetric
                label="Net Realized P&L"
                value={`${formatSignedCurrency(result.summary.netRealizedPnl ?? result.summary.realizedPnl)} · ${formatSignedPct(((result.summary.netRealizedPnl ?? result.summary.realizedPnl) / result.summary.startingCapital) * 100)}`}
                valueColor={(result.summary.netRealizedPnl ?? result.summary.realizedPnl) >= 0 ? '#52b788' : '#e05a5e'}
              />
              <MiniMetric
                label="Gross Unrealized MTM"
                value={`${formatSignedCurrency(result.summary.unrealizedPnl)} · ${formatSignedPct((result.summary.unrealizedPnl / result.summary.startingCapital) * 100)}`}
                valueColor={result.summary.unrealizedPnl >= 0 ? '#52b788' : '#e05a5e'}
              />
              <MiniMetric
                label="Net Unrealized MTM"
                value={`${formatSignedCurrency(result.summary.netUnrealizedPnl ?? result.summary.unrealizedPnl)} · ${formatSignedPct(((result.summary.netUnrealizedPnl ?? result.summary.unrealizedPnl) / result.summary.startingCapital) * 100)}`}
                valueColor={(result.summary.netUnrealizedPnl ?? result.summary.unrealizedPnl) >= 0 ? '#52b788' : '#e05a5e'}
              />
              <MiniMetric label="Estimated Charges" value={formatCurrency(result.summary.totalCharges || 0)} valueColor="#c9a84c" />
              <MiniMetric label="Skipped No Token" value={String(result.summary.skippedNoToken)} />
              <MiniMetric label="Skipped No Historical" value={String(result.summary.skippedNoHistorical)} />
              <MiniMetric label="Skipped Capital" value={String(result.summary.skippedCapitalLimited)} />
              <MiniMetric label="Skipped Position" value={String(result.summary.skippedPositionLimited)} />
            </div>
            {result.summary.tradesOpen > 0 && (
              <div className="px-4 pb-4">
                <div className="rounded-lg p-3" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.45)' }}>
                    MTM includes open positions marked at the last candle in the replay window. Net values subtract estimated Zerodha-style equity charges; open rows use estimated exit charges at the mark price.
                  </p>
                </div>
              </div>
            )}
          </div>

          {result.summary.gateBreakdown.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.08)' }}>
              <div className="px-4 py-2.5 flex items-center justify-between gap-3" style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[11px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
                  Gate Breakdown
                </p>
                <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.3)' }}>
                  Which rule blocked how many entry attempts during the replay.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[560px]">
                  <thead>
                    <tr style={{ background:'rgba(255,255,255,0.02)' }}>
                      {['Gate', 'Blocked Attempts'].map(h => (
                        <th key={h} className="px-3 py-2 text-[10px] tracking-widest uppercase font-medium" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.summary.gateBreakdown.map(item => (
                      <tr key={item.gate} style={{ borderTop:'1px solid rgba(255,255,255,0.05)' }}>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.72)' }}>{item.label}</td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>{item.count.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-xl overflow-hidden" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.08)' }}>
            <div className="px-4 py-2.5 flex items-center justify-between gap-3" style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[11px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
                Trades ({result.trades.length})
              </p>
              <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.3)' }}>
                Same-page result view for quick parameter comparisons.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1620px]">
                <thead>
                  <tr style={{ background:'rgba(255,255,255,0.02)' }}>
                    {['Symbol', 'Strategy', 'Signal', 'Entry Price', 'T1 Date', 'T2 Date', 'Exit Price / Mark Price', 'Qty / Remaining', 'Gross Profit', 'Brokerage', 'Net Profit', 'Status', 'Hold', 'Reason'].map(h => (
                      <th key={h} className="px-3 py-2 text-[10px] tracking-widest uppercase font-medium" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((trade, index) => {
                    const grossPnl = trade.realizedPnl
                    const pnl = trade.netRealizedPnl ?? trade.realizedPnl
                    const displayStatus = trade.status === 'closed' ? 'closed' : trade.t1Date ? 'partial' : 'open'
                    const grossPct = trade.entryValue > 0 ? (grossPnl / trade.entryValue) * 100 : 0
                    const realizedPct = trade.entryValue > 0 ? (pnl / trade.entryValue) * 100 : 0
                    return (
                      <tr key={`${trade.symbol}-${trade.entryDate}-${index}`} style={{ borderTop:'1px solid rgba(255,255,255,0.05)' }}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-medium" style={{ color:'rgba(255,255,255,0.85)' }}>{trade.symbol}</span>
                            <span className="text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded"
                              style={{ background: trade.confidence === 'high' ? 'rgba(82,183,136,0.12)' : 'rgba(201,168,76,0.12)', border:`1px solid ${trade.confidence === 'high' ? 'rgba(82,183,136,0.35)' : 'rgba(201,168,76,0.35)'}`, color: trade.confidence === 'high' ? '#52b788' : '#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                              {trade.confidence}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'#60a5fa', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.strategyName || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.55)', fontFamily:'JetBrains Mono, monospace' }}>{trade.signalDate}</td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.75)' }}>
                          <div>{trade.entryDate}</div>
                          <div style={{ color:'rgba(255,255,255,0.45)' }}>Entry Price</div>
                          <div style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>{formatCurrency(trade.entryPrice)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.t1Date || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.t2Date || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.75)' }}>
                          <div>{trade.exitDate || 'Open'}</div>
                          <div style={{ color:'rgba(255,255,255,0.45)' }}>{trade.status === 'closed' ? 'Exit Price' : 'Mark Price'}</div>
                          <div style={{ color: trade.status === 'closed' ? '#52b788' : 'rgba(255,255,255,0.65)', fontFamily:'JetBrains Mono, monospace' }}>{formatCurrency(trade.status === 'closed' ? (trade.exitPrice || trade.markPrice) : trade.markPrice)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.75)', fontFamily:'JetBrains Mono, monospace' }}>
                          <div>{trade.qty}</div>
                          <div style={{ color:'rgba(255,255,255,0.45)' }}>remaining {trade.remainingQty}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color: grossPnl >= 0 ? '#52b788' : '#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.realizedPnl !== 0 ? (
                            <>
                              <div style={{ color:'rgba(255,255,255,0.45)' }}>Gross</div>
                              <div>{formatSignedCurrency(grossPnl)}</div>
                              <div>{formatSignedPct(grossPct)}</div>
                            </>
                          ) : (
                            <div style={{ color:'rgba(255,255,255,0.35)' }}>—</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                          <div>{formatCurrency(trade.charges || 0)}</div>
                          <div style={{ color:'rgba(255,255,255,0.45)' }}>{displayStatus === 'closed' ? (trade.chargeModel || 'actual') : `est. ${trade.chargeModel || 'delivery'}`}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color: pnl >= 0 ? '#52b788' : '#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.realizedPnl !== 0 ? (
                            <>
                              <div style={{ color:'rgba(255,255,255,0.45)' }}>Net</div>
                              <div>{formatSignedCurrency(pnl)}</div>
                              <div>{formatSignedPct(realizedPct)}</div>
                            </>
                          ) : (
                            <div style={{ color:'rgba(255,255,255,0.35)' }}>—</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded"
                            style={{
                              background: displayStatus === 'closed'
                                ? 'rgba(82,183,136,0.12)'
                                : displayStatus === 'partial'
                                  ? 'rgba(201,168,76,0.12)'
                                  : 'rgba(96,165,250,0.12)',
                              border: `1px solid ${displayStatus === 'closed'
                                ? 'rgba(82,183,136,0.35)'
                                : displayStatus === 'partial'
                                  ? 'rgba(201,168,76,0.35)'
                                  : 'rgba(96,165,250,0.35)'}`,
                              color: displayStatus === 'closed' ? '#52b788' : displayStatus === 'partial' ? '#c9a84c' : '#60a5fa',
                              fontFamily:'JetBrains Mono, monospace',
                            }}>
                            {displayStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.55)', fontFamily:'JetBrains Mono, monospace' }}>{trade.holdDays} d</td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.45)' }}>
                          {trade.setup || `${Math.abs(trade.deviationPct).toFixed(2)}% below EMA · ${trade.downDays} down days · buy #${trade.buyNumber}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.08)' }}>
            <div className="px-4 py-2.5" style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[11px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
                Equity Curve ({result.equityCurve.length} days)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[760px]">
                <thead>
                  <tr style={{ background:'rgba(255,255,255,0.02)' }}>
                    {['Date', 'Cash', 'Market Value', 'Equity', 'Drawdown', 'Open Trades'].map(h => (
                      <th key={h} className="px-3 py-2 text-[10px] tracking-widest uppercase font-medium" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.equityCurve.map(point => (
                    <tr key={point.date} style={{ borderTop:'1px solid rgba(255,255,255,0.05)' }}>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.75)', fontFamily:'JetBrains Mono, monospace' }}>{point.date}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.7)', fontFamily:'JetBrains Mono, monospace' }}>{formatCurrency(point.cash)}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.7)', fontFamily:'JetBrains Mono, monospace' }}>{formatCurrency(point.marketValue)}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>{formatCurrency(point.equity)}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color: point.drawdownPct > 0 ? '#e05a5e' : 'rgba(255,255,255,0.45)', fontFamily:'JetBrains Mono, monospace' }}>{point.drawdownPct.toFixed(2)}%</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.7)', fontFamily:'JetBrains Mono, monospace' }}>{point.openTrades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {previewEntry && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
          style={{ background:'rgba(0,0,0,0.72)', backdropFilter:'blur(4px)' }} onClick={() => setPreviewEntry(null)}>
          <div className="w-full max-w-5xl rounded-xl overflow-hidden" onClick={e => e.stopPropagation()}
            style={{ background:'#100e0a', border:'1px solid rgba(201,168,76,0.25)' }}>
            <div className="px-5 py-3 flex items-center justify-between gap-3"
              style={{ borderBottom:'1px solid rgba(201,168,76,0.15)' }}>
              <div>
                <p className="text-[12px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                  Review Saved Backtest
                </p>
                <p className="text-[11px] mt-1" style={{ color:'rgba(255,255,255,0.55)' }}>
                  {previewEntry.strategyName} · saved on {formatDateTime(previewEntry.timestamp)}
                </p>
              </div>
              <button onClick={() => setPreviewEntry(null)} className="text-white/40 hover:text-white/80">✕</button>
            </div>

            <div className="p-5 max-h-[75vh] overflow-y-auto space-y-5">
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                <MiniMetric label="Starting Capital" value={formatCurrency(previewEntry.startingAmount)} valueColor="#c9a84c" />
                <MiniMetric label="Trading Days" value={String(previewEntry.backtestDays)} valueColor="rgba(255,255,255,0.82)" />
                <MiniMetric label="Max Buys / Day" value={String(previewEntry.maxBuysPerDay)} valueColor="rgba(255,255,255,0.82)" />
                <MiniMetric label="Max Sells / Day" value={String(previewEntry.maxSellsPerDay)} valueColor="rgba(255,255,255,0.82)" />
              </div>

              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                <MiniMetric label="Realized Profit" value={formatSignedCurrency(previewEntry.realizedProfitRupees)} valueColor={previewEntry.realizedProfitRupees >= 0 ? '#52b788' : '#e05a5e'} />
                <MiniMetric label="Open MTM" value={formatSignedCurrency(previewEntry.unrealizedMTM)} valueColor={previewEntry.unrealizedMTM >= 0 ? '#52b788' : '#e05a5e'} />
                <MiniMetric label="Win Rate" value={previewEntry.winRate === null ? '—' : `${previewEntry.winRate.toFixed(2)}%`} valueColor="#c9a84c" />
                <MiniMetric label="Closed Trades" value={String(previewEntry.closedTrades)} valueColor="rgba(255,255,255,0.82)" />
                <MiniMetric label="Open Trades" value={String(previewEntry.openTrades)} valueColor="rgba(255,255,255,0.82)" />
              </div>

              {previewEntry.strategyType === 'all' ? (
                <div className="space-y-4">
                  <div className="rounded-lg p-4" style={{ background:'rgba(96,165,250,0.06)', border:'1px solid rgba(96,165,250,0.2)' }}>
                    <p className="text-[11px] tracking-widest uppercase mb-1" style={{ color:'#60a5fa', fontFamily:'JetBrains Mono, monospace' }}>
                      Run All Active Snapshot
                    </p>
                    <p className="text-[12px]" style={{ color:'rgba(255,255,255,0.58)' }}>
                      This saved run contains {previewEntry.strategySnapshots?.length || 0} strategy snapshots. Loading it will restore the saved multi-strategy setup into the Backtest tab for rerun.
                    </p>
                  </div>
                  {(previewEntry.strategySnapshots || []).map(snapshot => (
                    <StrategySnapshotPreviewCard key={snapshot.id} snapshot={snapshot} />
                  ))}
                </div>
              ) : previewEntry.strategySnapshot ? (
                <StrategySnapshotPreviewCard snapshot={previewEntry.strategySnapshot} />
              ) : (
                <div className="rounded-xl p-4" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-[11px] tracking-widest uppercase mb-3" style={{ color:'rgba(201,168,76,0.65)', fontFamily:'JetBrains Mono, monospace' }}>
                    Saved Parameters
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <PreviewRecordSection title="Entry Parameters" values={previewEntry.entryParams} descriptions={previewEntry.strategyType === 'momentum' ? MOMENTUM_PARAM_DESCRIPTIONS : DIP_PARAM_DESCRIPTIONS} />
                    <PreviewRecordSection title="Exit Criteria" values={previewEntry.exitCriteria} descriptions={EXIT_DESCRIPTIONS} />
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop:'1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setPreviewEntry(null)}
                className="px-3 py-1.5 rounded-md text-[11px]"
                style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)' }}>
                Close
              </button>
              <button onClick={confirmHistoryLoad}
                className="px-4 py-1.5 rounded-md text-[11px] font-semibold tracking-wider"
                style={{ background:'linear-gradient(135deg, #8a6a1a, #c9a84c)', color:'#080604' }}>
                Load Into Backtest
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// Builds a flat list of {path, from, to} entries for the confirm dialog.
function buildDiff(
  source: { capital: CapitalConfig; strategies: StrategyConfig[] },
  draft:  { capital: CapitalConfig; strategies: StrategyConfig[] },
): Array<{ path: string; from: string; to: string }> {
  const out: Array<{ path: string; from: string; to: string }> = []
  const compareObj = (prefix: string, a: any, b: any) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
    keys.forEach(k => {
      const va = a?.[k]; const vb = b?.[k]
      if (typeof va === 'object' && va !== null && !Array.isArray(va)) {
        compareObj(`${prefix}.${k}`, va, vb)
      } else if (JSON.stringify(va) !== JSON.stringify(vb)) {
        out.push({ path: `${prefix}.${k}`, from: stringify(va), to: stringify(vb) })
      }
    })
  }
  compareObj('capital', source.capital, draft.capital)
  // strategies: by id, plus added/removed
  const srcById = new Map(source.strategies.map(s => [s.id, s]))
  const dstById = new Map(draft.strategies.map(s => [s.id, s]))
  Array.from(srcById.keys()).forEach(id => {
    if (!dstById.has(id)) out.push({ path: `strategies.${id}`, from: 'present', to: 'REMOVED' })
  })
  Array.from(dstById.keys()).forEach(id => {
    const a = srcById.get(id); const b = dstById.get(id)!
    if (!a) { out.push({ path: `strategies.${id}`, from: '—', to: 'CREATED' }); return }
    compareObj(`strategies.${id}`, a, b)
  })
  return out
}

function stringify(v: any): string {
  if (v === undefined || v === null) return '—'
  if (Array.isArray(v)) return v.join(',')
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

// Field layout: description on top (small + dim), then [label | value] on the
// row below. Reads cleanly on both mobile and desktop. All editable field
// components below follow the same pattern.
function FieldDesc({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return <p className="text-[10px] mb-1 leading-snug" style={{ color:'rgba(255,255,255,0.4)' }}>{children}</p>
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] flex-shrink-0" style={{ color:'rgba(255,255,255,0.7)' }}>{label}</span>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

function Row({ label, value, desc }: { label: string; value: string; desc?: string }) {
  return (
    <div className="py-1">
      <FieldDesc>{desc}</FieldDesc>
      <FieldRow label={label}>
        <span className="text-[13px]" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace', fontWeight: 600 }}>{value}</span>
      </FieldRow>
    </div>
  )
}

function PreviewRecordSection({ title, values, descriptions }: { title: string; values: Record<string, unknown>; descriptions?: Record<string, string> }) {
  const entries = Object.entries(values || {})

  return (
    <div className="rounded-lg p-4" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)' }}>
      <p className="text-[10px] tracking-widest uppercase mb-3" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
        {title}
      </p>
      {entries.length === 0 ? (
        <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.35)' }}>No saved values</p>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <Row
              key={key}
              label={getPreviewLabel(key)}
              value={formatPreviewValue(key, value)}
              desc={descriptions?.[key] || STRATEGY_FIELD_DESCRIPTIONS[key]}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function StrategySnapshotPreviewCard({ snapshot }: { snapshot: StrategyConfig }) {
  const paramDescriptions = snapshot.type === 'momentum' ? MOMENTUM_PARAM_DESCRIPTIONS : DIP_PARAM_DESCRIPTIONS

  return (
    <div className="rounded-xl p-4" style={{ background:'rgba(255,255,255,0.02)', border:`1px solid ${snapshot.color}33` }}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <p className="text-[15px]" style={{ color:'rgba(255,255,255,0.88)' }}>{snapshot.name}</p>
          <p className="text-[10px] tracking-widest uppercase mt-1" style={{ color:snapshot.color, fontFamily:'JetBrains Mono, monospace' }}>
            {snapshot.type} · {snapshot.id}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <span className="text-[10px] tracking-widest uppercase px-2 py-1 rounded"
            style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
            {snapshot.active ? 'Active' : 'Inactive'}
          </span>
          <span className="text-[10px] tracking-widest uppercase px-2 py-1 rounded"
            style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
            {snapshot.watchlist.length} watchlist{snapshot.watchlist.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PreviewRecordSection
          title="Setup"
          values={{
            scanIntervalMin: snapshot.scanIntervalMin,
            watchlist: snapshot.watchlist,
            active: snapshot.active,
          }}
          descriptions={STRATEGY_FIELD_DESCRIPTIONS}
        />
        <PreviewRecordSection title="Entry Parameters" values={snapshot.params} descriptions={paramDescriptions} />
        <PreviewRecordSection title="Exit Criteria" values={snapshot.exits} descriptions={EXIT_DESCRIPTIONS} />
        <PreviewRecordSection title="GIFT Nifty Gate" values={snapshot.giftNiftyGate || { enabled: false }} descriptions={GIFT_GATE_DESCRIPTIONS} />
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-3" style={{ background:'#100e0a' }}>
      <p className="text-[9px] tracking-widest uppercase mb-1" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{label}</p>
      <p style={{ color, fontFamily:'JetBrains Mono, monospace', fontSize: 15, fontWeight: 600 }}>{value}</p>
    </div>
  )
}

function MiniMetric({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)' }}>
      <p className="text-[9px] tracking-widest uppercase mb-1" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{label}</p>
      <p className="text-[12px]" style={{ color: valueColor || 'rgba(255,255,255,0.82)', fontFamily:'JetBrains Mono, monospace' }}>{value}</p>
    </div>
  )
}

function formatCurrency(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

function formatSignedCurrency(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatCurrency(Math.abs(value))}`
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(2)}%`
}

function formatDateTime(value: string): string {
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return value
  return dt.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getPreviewLabel(key: string): string {
  return STRATEGY_FIELD_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

function formatPreviewValue(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (/(Rupees|Amount|Capital|MTM|Profit|Deployed)/i.test(key)) return formatCurrency(value)
    if (/(Pct|Rate|Drawdown|Gain|Drop|Below|Above|Proximity|Efficiency)/i.test(key)) return `${value.toFixed(2)}%`
    if (/Min$/i.test(key)) return `${value} min`
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return compactJson(value)
  return String(value)
}

function summarizeConfigValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(item => item && typeof item === 'object' && 'id' in item)) return `${value.length} strategy snapshots`
    return value.map(item => summarizeConfigValue(item)).join(', ')
  }
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return `${Object.keys(value as Record<string, unknown>).length} saved fields`
  return String(value)
}

function renderConfigSummary(config: Record<string, unknown>): React.ReactNode {
  const entries = Object.entries(config || {})
  if (entries.length === 0) {
    return <span style={{ color:'rgba(255,255,255,0.35)' }}>—</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5 max-w-full whitespace-normal">
      {entries.map(([key, value]) => (
        <span key={key} className="inline-flex items-center gap-1 rounded-md px-2 py-1 leading-snug"
          style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color:'rgba(255,255,255,0.38)' }}>{key}:</span>
          <span style={{ color:'rgba(255,255,255,0.78)' }}>{summarizeConfigValue(value)}</span>
        </span>
      ))}
    </div>
  )
}

function getBacktestHistoryColumns(view: BacktestHistoryView): BacktestHistoryColumn[] {
  switch (view) {
    case 'performance':
      return [
        {
          key: 'netProfitRupees',
          label: 'Net Profit ₹',
          minWidth: 130,
          render: entry => formatSignedCurrency(entry.netProfitRupees),
          color: entry => entry.netProfitRupees >= 0 ? '#52b788' : '#e05a5e',
        },
        {
          key: 'netProfitPct',
          label: 'Net Profit %',
          minWidth: 120,
          render: entry => formatSignedPct(entry.netProfitPct),
          color: entry => entry.netProfitPct >= 0 ? '#52b788' : '#e05a5e',
        },
        {
          key: 'realizedProfitRupees',
          label: 'Realized ₹',
          minWidth: 130,
          render: entry => formatSignedCurrency(entry.realizedProfitRupees),
          color: entry => entry.realizedProfitRupees >= 0 ? '#52b788' : '#e05a5e',
        },
        {
          key: 'realizedProfitPct',
          label: 'Realized %',
          minWidth: 120,
          render: entry => formatSignedPct(entry.realizedProfitPct),
          color: entry => entry.realizedProfitPct >= 0 ? '#52b788' : '#e05a5e',
        },
        {
          key: 'unrealizedMTM',
          label: 'Unrealized MTM',
          minWidth: 130,
          render: entry => formatSignedCurrency(entry.unrealizedMTM),
          color: entry => entry.unrealizedMTM >= 0 ? '#52b788' : '#e05a5e',
        },
        {
          key: 'winRate',
          label: 'Win Rate',
          minWidth: 110,
          render: entry => entry.winRate === null ? '—' : `${entry.winRate.toFixed(2)}%`,
          color: () => '#c9a84c',
        },
        {
          key: 'capitalEfficiency',
          label: 'Realized Efficiency',
          minWidth: 150,
          render: entry => formatSignedPct(entry.capitalEfficiency),
          color: entry => entry.capitalEfficiency >= 0 ? '#52b788' : '#e05a5e',
        },
      ]
    case 'risk':
      return [
        {
          key: 'closedTrades',
          label: 'Closed Trades',
          minWidth: 110,
          render: entry => entry.closedTrades,
        },
        {
          key: 'openTrades',
          label: 'Open Trades',
          minWidth: 100,
          render: entry => entry.openTrades,
        },
        {
          key: 'avgHoldDays',
          label: 'Avg Hold',
          minWidth: 110,
          render: entry => entry.avgHoldDays === null ? '—' : `${entry.avgHoldDays.toFixed(1)} d`,
        },
        {
          key: 'avgDrawdownPct',
          label: 'Avg Drawdown %',
          minWidth: 130,
          render: entry => `${entry.avgDrawdownPct.toFixed(2)}%`,
          color: () => 'rgba(224,90,94,0.9)',
        },
        {
          key: 'backtestDays',
          label: 'Backtest Days',
          minWidth: 120,
          render: entry => entry.backtestDays,
        },
        {
          key: 'startingAmount',
          label: 'Starting Amount',
          minWidth: 140,
          render: entry => formatCurrency(entry.startingAmount),
        },
        {
          key: 'avgDeployedCapital',
          label: 'Avg Deployed',
          minWidth: 130,
          render: entry => formatCurrency(entry.avgDeployedCapital),
        },
      ]
    case 'config':
      return [
        {
          key: 'strategyType',
          label: 'Strategy Type',
          minWidth: 120,
          render: entry => entry.strategyType,
          color: entry => entry.strategyType === 'all' ? '#60a5fa' : entry.strategyType === 'momentum' ? '#52b788' : '#c9a84c',
        },
        {
          key: 'entryParams',
          label: 'Snapshot',
          minWidth: 240,
          render: entry => entry.strategyType === 'all'
            ? `${entry.strategySnapshots?.length || 0} saved strategies · open in Load preview`
            : 'Saved setup available in Load preview',
          color: () => 'rgba(255,255,255,0.62)',
        },
        {
          key: 'maxBuysPerDay',
          label: 'Max Buys',
          minWidth: 100,
          render: entry => entry.maxBuysPerDay,
        },
        {
          key: 'maxSellsPerDay',
          label: 'Max Sells',
          minWidth: 100,
          render: entry => entry.maxSellsPerDay,
        },
        {
          key: 'startingAmount',
          label: 'Starting Amount',
          minWidth: 140,
          render: entry => formatCurrency(entry.startingAmount),
        },
        {
          key: 'backtestDays',
          label: 'Backtest Days',
          minWidth: 120,
          render: entry => entry.backtestDays,
        },
        {
          key: 'openTrades',
          label: 'Open Trades',
          minWidth: 110,
          render: entry => entry.openTrades,
        },
      ]
    case 'overview':
    default:
      return [
        {
          key: 'strategyType',
          label: 'Strategy Type',
          minWidth: 120,
          render: entry => entry.strategyType,
          color: entry => entry.strategyType === 'all' ? '#60a5fa' : entry.strategyType === 'momentum' ? '#52b788' : '#c9a84c',
        },
        {
          key: 'backtestDays',
          label: 'Days',
          minWidth: 90,
          render: entry => entry.backtestDays,
        },
        {
          key: 'closedTrades',
          label: 'Closed',
          minWidth: 90,
          render: entry => entry.closedTrades,
        },
        {
          key: 'openTrades',
          label: 'Open',
          minWidth: 90,
          render: entry => entry.openTrades,
        },
        {
          key: 'realizedProfitRupees',
          label: 'Realized P&L ₹',
          minWidth: 140,
          render: entry => formatSignedCurrency(entry.realizedProfitRupees),
          color: entry => entry.realizedProfitRupees >= 0 ? '#52b788' : '#e05a5e',
        },
        {
          key: 'realizedProfitPct',
          label: 'Realized Return %',
          minWidth: 150,
          render: entry => formatSignedPct(entry.realizedProfitPct),
          color: entry => entry.realizedProfitPct >= 0 ? '#52b788' : '#e05a5e',
        },
        {
          key: 'unrealizedMTM',
          label: 'Open MTM',
          minWidth: 120,
          render: entry => formatSignedCurrency(entry.unrealizedMTM),
          color: entry => entry.unrealizedMTM >= 0 ? '#52b788' : '#e05a5e',
        },
        {
          key: 'winRate',
          label: 'Win Rate',
          minWidth: 110,
          render: entry => entry.winRate === null ? '—' : `${entry.winRate.toFixed(2)}%`,
          color: () => '#c9a84c',
        },
      ]
  }
}

function compareHistoryValue(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  return compactJson(a).localeCompare(compactJson(b))
}

function compareBacktestHistory(
  a: BacktestHistoryEntry,
  b: BacktestHistoryEntry,
  key: BacktestHistorySortKey,
  direction: SortDirection,
): number {
  const result = compareHistoryValue(a[key], b[key])
  return direction === 'asc' ? result : -result
}

function StrategyCard({ s, expanded, onToggle, watchlistOptions, onPatch, onToggleActive, onReset, onDuplicate, onDelete, canReset, isProtected, locked }: {
  s: StrategyConfig
  expanded: boolean
  onToggle: () => void
  watchlistOptions: { key: string; name: string }[]
  onPatch: (patch: Partial<StrategyConfig>) => void
  onToggleActive: () => void
  onReset: () => void
  onDuplicate: () => void
  onDelete: () => void
  canReset: boolean
  isProtected: boolean    // true for accumulator — disables active toggle + delete
  locked: boolean
}) {
  const paramDescs = s.type === 'dip' ? DIP_PARAM_DESCRIPTIONS : MOMENTUM_PARAM_DESCRIPTIONS
  function toggleListKey(k: string) {
    const next = s.watchlist.includes(k) ? s.watchlist.filter(x => x !== k) : [...s.watchlist, k]
    onPatch({ watchlist: next.length > 0 ? next : [k] })   // never go empty
  }
  function patchParam(k: string, v: unknown) {
    onPatch({ params: { ...s.params, [k]: v } })
  }
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background:'rgba(255,255,255,0.02)', border:`1px solid ${s.active ? s.color + '55' : 'rgba(255,255,255,0.08)'}` }}>
      <div className="w-full px-4 py-3 flex items-center justify-between gap-3" style={{ background:'rgba(255,255,255,0.01)' }}>
        <button onClick={onToggle} className="flex items-center gap-3 min-w-0 flex-1 text-left">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.active ? s.color : 'rgba(255,255,255,0.2)' }}></span>
          <span style={{ color:'rgba(255,255,255,0.9)', fontWeight: 600 }}>{s.name}</span>
          <span className="text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded"
            style={{ background:`${s.color}15`, color: s.color, border:`1px solid ${s.color}40`, fontFamily:'JetBrains Mono, monospace' }}>
            {s.type}
          </span>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Active toggle — disabled for protected (accumulator) so it stays Active */}
          <button onClick={() => !locked && !isProtected && onToggleActive()} disabled={locked || isProtected}
            title={isProtected ? 'Accumulator cannot be deactivated — it is the keeper strategy' : undefined}
            className="text-[9px] tracking-widest uppercase px-2 py-1 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: s.active ? 'rgba(82,183,136,0.15)' : 'rgba(255,255,255,0.04)',
              color: s.active ? '#52b788' : 'rgba(255,255,255,0.4)',
              border: `1px solid ${s.active ? 'rgba(82,183,136,0.4)' : 'rgba(255,255,255,0.1)'}`,
              fontFamily:'JetBrains Mono, monospace',
            }}>
            {s.active ? '● Active' : '○ Inactive'}
          </button>
          <button onClick={onToggle} className="text-[12px] px-2" style={{ color:'rgba(255,255,255,0.4)' }}>{expanded ? '−' : '+'}</button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4" style={{ borderTop:'1px solid rgba(255,255,255,0.06)' }}>
          {/* Core editable */}
          <div className="space-y-2.5">
            <p className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>Core</p>
            <TextField label="Name"  value={s.name}  onChange={v => onPatch({ name: v })}  disabled={locked} />
            <TextField label="ID (immutable after save)" value={s.id}    onChange={v => onPatch({ id: v.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} disabled={locked || canReset} desc={canReset ? 'ID locked once saved.' : 'Lowercase, underscores only.'} />
            {/* Type selector — changing replaces params + exits + GIFT gate
                with the new type's defaults (with confirm). */}
            <div className="py-1">
              <FieldDesc>Dip = mean-reversion (EMA-stretched entry). Momentum = trending up (3 rising candles + volume). Changing type resets params to that type's defaults.</FieldDesc>
              <FieldRow label="Type">
                <div className="flex gap-1">
                  {(['dip', 'momentum'] as const).map(t => {
                    const active = s.type === t
                    return (
                      <button key={t} disabled={locked} onClick={() => {
                        if (locked || s.type === t) return
                        if (!confirm(`Switch type to "${t}"? This will reset params, exits, scan interval, and GIFT Nifty gate to ${t} defaults. The strategy ID, name, color, and active state stay.`)) return
                        const patch: Partial<StrategyConfig> = t === 'dip'
                          ? {
                              type: 'dip',
                              scanIntervalMin: 30,
                              params: { ...DEFAULT_DIP_PARAMS },
                              exits: { t1Pct: 5.0, t2Pct: 8.0 },
                              giftNiftyGate: { enabled: true, minPct: null, maxPct: -0.5 },
                            }
                          : {
                              type: 'momentum',
                              scanIntervalMin: 5,
                              params: { ...DEFAULT_MOMENTUM_PARAMS },
                              exits: { t1Pct: 1.5, t2Pct: 2.0 },
                              giftNiftyGate: { enabled: false, minPct: null, maxPct: null },
                            }
                        onPatch(patch)
                      }}
                        className="px-3 py-1 rounded text-[11px] disabled:opacity-50"
                        style={{
                          background: active ? `${s.color}22` : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${active ? s.color + '66' : 'rgba(255,255,255,0.1)'}`,
                          color: active ? s.color : 'rgba(255,255,255,0.5)',
                          fontFamily:'JetBrains Mono, monospace',
                        }}>{active ? '✓ ' : ''}{t}</button>
                    )
                  })}
                </div>
              </FieldRow>
            </div>
            <ColorField label="Color" value={s.color} onChange={v => onPatch({ color: v })} disabled={locked} />
            <NumField  label="Scan Interval (min)" value={s.scanIntervalMin} onChange={v => onPatch({ scanIntervalMin: Math.max(1, Math.round(v)) })} desc="Cron fires every N minutes during market hours." disabled={locked} />
            <div>
              <p className="text-[10px] mb-1.5" style={{ color:'rgba(255,255,255,0.6)' }}>Watchlist (select one or more)</p>
              <div className="flex gap-2 flex-wrap">
                {watchlistOptions.map(opt => {
                  const on = s.watchlist.includes(opt.key)
                  return (
                    <button key={opt.key} onClick={() => !locked && toggleListKey(opt.key)} disabled={locked}
                      title={opt.key}
                      className="px-2.5 py-1 rounded-md text-[10px] disabled:opacity-50"
                      style={{
                        background: on ? `${s.color}22` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${on ? s.color + '66' : 'rgba(255,255,255,0.1)'}`,
                        color: on ? s.color : 'rgba(255,255,255,0.5)',
                        fontFamily:'JetBrains Mono, monospace',
                      }}>{on ? '✓ ' : ''}{opt.name}</button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Params editable */}
          <div className="space-y-2.5">
            <p className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>Params</p>
            {(() => {
              const EOD_PARAM_KEYS = new Set(['exitSameDayTime', 'exitSameDayOnPositive', 'squareOffEOD'])
              return Object.entries(s.params).filter(([k]) => !EOD_PARAM_KEYS.has(k)).map(([k, v]) => {
                if (typeof v === 'boolean') return <BoolField key={k} label={k} value={v} onChange={x => patchParam(k, x)} desc={paramDescs[k]} disabled={locked} />
                if (typeof v === 'number')  return <NumField  key={k} label={k} value={v} onChange={x => patchParam(k, x)} desc={paramDescs[k]} disabled={locked} />
                return <TextField key={k} label={k} value={String(v)} onChange={x => patchParam(k, x)} desc={paramDescs[k]} disabled={locked} />
              })
            })()}
          </div>

          {/* End of Day Behaviour (momentum only) */}
          {s.type === 'momentum' && (
            <div className="space-y-2.5">
              <p className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>End of Day Behaviour</p>
              <TextField label="exitSameDayTime" value={String((s.params as any).exitSameDayTime ?? '15:10')} onChange={x => patchParam('exitSameDayTime', x)} desc={MOMENTUM_PARAM_DESCRIPTIONS.exitSameDayTime} disabled={locked} />
              <BoolField label="exitSameDayOnPositive" value={Boolean((s.params as any).exitSameDayOnPositive)} onChange={x => patchParam('exitSameDayOnPositive', x)} desc={MOMENTUM_PARAM_DESCRIPTIONS.exitSameDayOnPositive} disabled={locked} />
              <BoolField label="squareOffEOD" value={Boolean((s.params as any).squareOffEOD)} onChange={x => patchParam('squareOffEOD', x)} desc={MOMENTUM_PARAM_DESCRIPTIONS.squareOffEOD} disabled={locked} />
            </div>
          )}

          {/* Exits editable */}
          <div className="space-y-2.5">
            <p className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>Exit Targets</p>
            <NumField label="T1 % (first target)"  value={s.exits.t1Pct} onChange={v => onPatch({ exits: { ...s.exits, t1Pct: v } })} suffix="%" desc="First take-profit target as % gain from entry." disabled={locked} />
            <NumField label="T2 % (second target)" value={s.exits.t2Pct} onChange={v => onPatch({ exits: { ...s.exits, t2Pct: v } })} suffix="%" desc="Second take-profit target. For Strategy 1, T1 sells 50% and T2 sells the remaining." disabled={locked} />
          </div>

          {/* GIFT Nifty gate */}
          <GiftNiftyGateEditor strategy={s} onPatch={onPatch} disabled={locked} />

          {/* Actions */}
          <div className="flex gap-2 flex-wrap pt-2" style={{ borderTop:'1px solid rgba(255,255,255,0.05)' }}>
            <button onClick={onReset} disabled={locked || !canReset}
              className="px-3 py-1.5 rounded-md text-[10px] tracking-wider transition-all disabled:opacity-30"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
              Reset to Saved
            </button>
            <button onClick={onDuplicate} disabled={locked}
              className="px-3 py-1.5 rounded-md text-[10px] tracking-wider transition-all disabled:opacity-30"
              style={{ background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.3)', color:'#60a5fa', fontFamily:'JetBrains Mono, monospace' }}>
              Duplicate
            </button>
            <button onClick={onDelete} disabled={locked || isProtected}
              title={isProtected ? 'Accumulator cannot be deleted — it is the keeper strategy every other strategy hands off to' : undefined}
              className="ml-auto px-3 py-1.5 rounded-md text-[10px] tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background:'rgba(224,90,94,0.08)', border:'1px solid rgba(224,90,94,0.3)', color:'#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ──────── EDITABLE FIELD COMPONENTS ────────

function NumField({ label, value, onChange, desc, prefix, suffix, disabled }: {
  label: string; value: number; onChange: (v: number) => void; desc?: string; prefix?: string; suffix?: string; disabled?: boolean
}) {
  return (
    <div className="py-1">
      <FieldDesc>{desc}</FieldDesc>
      <FieldRow label={label}>
        <div className="flex items-center gap-1">
          {prefix && <span className="text-[11px]" style={{ color:'rgba(255,255,255,0.4)' }}>{prefix}</span>}
          <input type="number" step="any" value={value} disabled={disabled}
            onChange={e => onChange(parseFloat(e.target.value))}
            className="w-24 px-2 py-1 rounded text-[12px] outline-none disabled:opacity-50"
            style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }} />
          {suffix && <span className="text-[11px]" style={{ color:'rgba(255,255,255,0.4)' }}>{suffix}</span>}
        </div>
      </FieldRow>
    </div>
  )
}

function TextField({ label, value, onChange, desc, disabled }: {
  label: string; value: string; onChange: (v: string) => void; desc?: string; disabled?: boolean
}) {
  return (
    <div className="py-1">
      <FieldDesc>{desc}</FieldDesc>
      <FieldRow label={label}>
        <input type="text" value={value} disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className="px-2 py-1 rounded text-[12px] outline-none disabled:opacity-50 w-40"
          style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }} />
      </FieldRow>
    </div>
  )
}

function BoolField({ label, value, onChange, desc, disabled }: {
  label: string; value: boolean; onChange: (v: boolean) => void; desc?: string; disabled?: boolean
}) {
  return (
    <div className="py-1">
      <FieldDesc>{desc}</FieldDesc>
      <FieldRow label={label}>
        <button onClick={() => !disabled && onChange(!value)} disabled={disabled}
          className="px-3 py-1 rounded text-[11px] disabled:opacity-50"
          style={{
            background: value ? 'rgba(82,183,136,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${value ? 'rgba(82,183,136,0.4)' : 'rgba(255,255,255,0.1)'}`,
            color: value ? '#52b788' : 'rgba(255,255,255,0.5)',
            fontFamily:'JetBrains Mono, monospace',
          }}>{value ? 'true' : 'false'}</button>
      </FieldRow>
    </div>
  )
}

function ColorField({ label, value, onChange, disabled }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean
}) {
  return (
    <div className="py-1">
      <FieldRow label={label}>
        <div className="flex items-center gap-2">
          <input type="color" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
            className="w-8 h-7 rounded cursor-pointer disabled:opacity-50"
            style={{ background:'transparent', border:'1px solid rgba(255,255,255,0.1)', padding: 0 }} />
          <span className="text-[11px]" style={{ color:'rgba(255,255,255,0.5)', fontFamily:'JetBrains Mono, monospace' }}>{value}</span>
        </div>
      </FieldRow>
    </div>
  )
}

// GIFT Nifty pre-market gate editor — disabled by default for new strategies;
// when enabled, lets the user set min/max bounds. UI explains exactly what
// triggers a fire (e.g. "Only fires when GIFT Nifty ≤ −0.5%").
function GiftNiftyGateEditor({ strategy, onPatch, disabled }: {
  strategy: StrategyConfig
  onPatch: (patch: Partial<StrategyConfig>) => void
  disabled?: boolean
}) {
  const gate = strategy.giftNiftyGate
  const enabled = gate?.enabled === true
  const minPct = gate?.minPct ?? null
  const maxPct = gate?.maxPct ?? null

  function patchGate(p: Partial<{ enabled: boolean; minPct: number | null; maxPct: number | null }>) {
    const next: any = {
      enabled: gate?.enabled ?? false,
      minPct: gate?.minPct ?? null,
      maxPct: gate?.maxPct ?? null,
      ...p,
    }
    onPatch({ giftNiftyGate: next })
  }

  // Human-readable preview of the gate's effect
  let preview: string
  if (!enabled) preview = 'Not applicable — strategy fires regardless of GIFT Nifty'
  else if (minPct !== null && maxPct !== null) preview = `Only fires when GIFT Nifty is between ${minPct}% and ${maxPct}%`
  else if (maxPct !== null) preview = `Only fires when GIFT Nifty ≤ ${maxPct}%`
  else if (minPct !== null) preview = `Only fires when GIFT Nifty ≥ ${minPct}%`
  else preview = 'Enabled but no bounds set — add a min or max'

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>
          GIFT Nifty Gate (pre-market mode filter)
        </p>
        <button onClick={() => !disabled && patchGate({ enabled: !enabled })} disabled={disabled}
          className="px-2.5 py-1 rounded text-[10px] tracking-widest disabled:opacity-50"
          style={{
            background: enabled ? 'rgba(82,183,136,0.12)' : 'rgba(255,255,255,0.04)',
            color: enabled ? '#52b788' : 'rgba(255,255,255,0.4)',
            border: `1px solid ${enabled ? 'rgba(82,183,136,0.4)' : 'rgba(255,255,255,0.1)'}`,
            fontFamily:'JetBrains Mono, monospace',
          }}>
          {enabled ? '● ENABLED' : '○ N/A'}
        </button>
      </div>

      {enabled && (
        <>
          <NumField label="Min GIFT Nifty %" value={minPct ?? 0}
            onChange={v => patchGate({ minPct: Number.isFinite(v) ? v : null })}
            suffix="%" desc="Lower bound. Leave at 0 + clear the field for no lower bound (use Clear below)." disabled={disabled} />
          <NumField label="Max GIFT Nifty %" value={maxPct ?? 0}
            onChange={v => patchGate({ maxPct: Number.isFinite(v) ? v : null })}
            suffix="%" desc="Upper bound. e.g. −0.5 = only fires on gap-down days." disabled={disabled} />
          <div className="flex gap-2">
            <button onClick={() => patchGate({ minPct: null })} disabled={disabled || minPct === null}
              className="px-2 py-1 rounded text-[10px] disabled:opacity-30"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
              Clear min
            </button>
            <button onClick={() => patchGate({ maxPct: null })} disabled={disabled || maxPct === null}
              className="px-2 py-1 rounded text-[10px] disabled:opacity-30"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
              Clear max
            </button>
          </div>
        </>
      )}

      <p className="text-[10px]" style={{ color: enabled ? 'rgba(82,183,136,0.7)' : 'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>
        → {preview}
      </p>
    </div>
  )
}
