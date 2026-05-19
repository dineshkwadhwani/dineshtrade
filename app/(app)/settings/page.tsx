'use client'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'

interface AccountDisplay {
  name: string
  displayName: string
  initials: string
  color: string
  note: string
}

type Mode = 'auto' | 'manual'

type SettingsTab = 'general' | 'strategies'

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
    <div className="space-y-6 pb-4 max-w-2xl">
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

      {tab === 'strategies' && <StrategiesTab autoModeOn={mode === 'auto'} />}

      {tab === 'general' && <>

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
            ['Circuit Breaker', 'Nifty −5%'],
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

      </>}

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
  maxDeployPct: number
  sharedPool: boolean
  maxPositions: number
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
}

// One-line descriptions for each capital field — surfaced inline so the user
// understands what they're looking at without opening docs.
const CAPITAL_DESCRIPTIONS: Record<string, string> = {
  source: 'Where available funds come from. `live` = Zerodha getMargins each request.',
  perTrade: 'Maximum ₹ per individual trade in Auto mode. Manual orders bypass this cap.',
  maxBuysPerDay: 'Maximum BUYs per account per day, shared across all active strategies.',
  maxSellsPerDay: 'Maximum SELLs per account per day, shared across all active strategies.',
  circuitBreakerPct: 'Nifty intraday drop that pauses all auto-trading (e.g. -5 = -5%).',
  maxDeployPct: 'Never deploy more than this percentage of available funds. The remainder is reserve.',
  sharedPool: 'When true, every strategy draws from one common pool of funds.',
  maxPositions: 'Maximum number of simultaneously open positions per account.',
}

// Descriptions for the params of each strategy type. Used in the cards so each
// number has a one-line explanation.
const DIP_PARAM_DESCRIPTIONS: Record<string, string> = {
  emaPeriod: 'EMA window in trading days (default 20).',
  entryBelowPct: 'Minimum % below 20-EMA to consider entering (e.g. 5 = at least 5% below).',
  strongBuyBelowPct: 'Threshold for "strong buy" tier — stock is this many % below EMA.',
  minDownDays: 'Minimum consecutive down days required for entry.',
  tranche2AboveEMAPct: 'Tranche 2 exit fires when LTP reaches EMA × (1 + this/100).',
  reactiveDrop: 'Intraday % drop that triggers an off-cycle re-scan (default 3%).',
  reactiveIntervalMin: 'How often (in min) the reactive scan runs during the day.',
  firesOnAnyMode: 'When true, the reactive scan fires regardless of market mode (dip / catalyst).',
}

const MOMENTUM_PARAM_DESCRIPTIONS: Record<string, string> = {
  minDayGainPct: 'Minimum % day-gain to qualify for momentum entry (e.g. 0.5 = +0.5%).',
  maxDayGainPct: 'Maximum % day-gain — above this and the move is considered too extended.',
  consecutiveCandles: 'Number of consecutive rising 5-min candles required.',
  emaProximityPct: 'LTP must be within ±this % of the 20-day EMA.',
  volumeAvgDays: 'Days of historical volume used to compute the daily average.',
  scanStartHHMM: 'Daily scan window start (IST 24-hr "HH:MM").',
  scanEndHHMM: 'Daily scan window end (IST 24-hr "HH:MM").',
}

function StrategiesTab({ autoModeOn }: { autoModeOn: boolean }) {
  const [data, setData] = useState<{ capital: CapitalConfig; strategies: StrategyConfig[]; watchlistKeys: string[] } | null>(null)
  const [funds, setFunds] = useState<{ available: number; maxDeployable: number; reserve: number; remaining: number; deployed: number } | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/strategies').then(r => r.json()).then(d => {
      if (d.error) setError(d.error)
      else setData(d)
    }).catch(() => setError('Failed to load strategies'))

    // Also pull live funds for the capital block
    fetch('/api/state').then(r => r.json()).then(async s => {
      const accs: string[] = s.accountsWithToken || []
      if (accs.length === 0) return
      const r = await fetch(`/api/capital?account=${encodeURIComponent(accs[0])}`).then(r => r.json()).catch(() => null)
      if (r?.available !== undefined) setFunds(r)
    }).catch(() => { /* best-effort */ })
  }, [])

  if (error) return (
    <div className="rounded-lg p-3" style={{ background:'rgba(224,90,94,0.06)', border:'1px solid rgba(224,90,94,0.25)' }}>
      <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)' }}>✗ {error}</p>
    </div>
  )
  if (!data) return <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.4)' }}>Loading…</p>

  return (
    <div className="space-y-5">
      {autoModeOn && (
        <div className="rounded-lg p-3" style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.3)' }}>
          <p className="text-[12px]" style={{ color:'#f59e0b' }}>
            ⚠ Auto mode is active. Editing strategy parameters will be disabled until you pause Auto.
          </p>
          <p className="text-[10px] mt-1" style={{ color:'rgba(255,255,255,0.4)' }}>
            (This tab is currently read-only in Phase 2 — editing comes in Phase 4.)
          </p>
        </div>
      )}

      {/* CAPITAL BLOCK */}
      <div className="rounded-xl overflow-hidden" style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.2)' }}>
        <div className="px-4 py-2.5" style={{ borderBottom:'1px solid rgba(201,168,76,0.12)' }}>
          <p className="text-[11px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
            Shared Capital · applies to all strategies
          </p>
        </div>
        <div className="p-4 space-y-2.5">
          <Row label="Per Trade Amount"     value={`₹${data.capital.perTrade.toLocaleString('en-IN')}`} desc={CAPITAL_DESCRIPTIONS.perTrade} />
          <Row label="Max Buys / Day"        value={String(data.capital.maxBuysPerDay)}                  desc={CAPITAL_DESCRIPTIONS.maxBuysPerDay} />
          <Row label="Max Sells / Day"       value={String(data.capital.maxSellsPerDay)}                 desc={CAPITAL_DESCRIPTIONS.maxSellsPerDay} />
          <Row label="Circuit Breaker %"     value={`${data.capital.circuitBreakerPct}%`}                desc={CAPITAL_DESCRIPTIONS.circuitBreakerPct} />
          <Row label="Max Deploy %"          value={`${data.capital.maxDeployPct}%`}                     desc={CAPITAL_DESCRIPTIONS.maxDeployPct} />
          <Row label="Max Open Positions"    value={String(data.capital.maxPositions)}                   desc={CAPITAL_DESCRIPTIONS.maxPositions} />
          <Row label="Source"                value={data.capital.source}                                  desc={CAPITAL_DESCRIPTIONS.source} />
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
          Strategies ({data.strategies.length})
        </p>
        {data.strategies.map(s => (
          <StrategyCard key={s.id} s={s} expanded={expanded === s.id} onToggle={() => setExpanded(expanded === s.id ? null : s.id)} watchlistKeys={data.watchlistKeys} />
        ))}
      </div>

      <p className="text-[10px] text-center" style={{ color:'rgba(255,255,255,0.3)' }}>
        Phase 2 · read-only. Editing + validation + hot-reload arrives in Phase 4.
      </p>
    </div>
  )
}

function Row({ label, value, desc }: { label: string; value: string; desc?: string }) {
  return (
    <div className="grid items-baseline gap-3" style={{ gridTemplateColumns: '1.2fr 0.8fr 2fr' }}>
      <span className="text-[12px]" style={{ color:'rgba(255,255,255,0.7)' }}>{label}</span>
      <span className="text-[13px]" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace', fontWeight: 600 }}>{value}</span>
      {desc && <span className="text-[10px]" style={{ color:'rgba(255,255,255,0.4)' }}>{desc}</span>}
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

function StrategyCard({ s, expanded, onToggle, watchlistKeys }: {
  s: StrategyConfig
  expanded: boolean
  onToggle: () => void
  watchlistKeys: string[]
}) {
  const paramDescs = s.type === 'dip' ? DIP_PARAM_DESCRIPTIONS : MOMENTUM_PARAM_DESCRIPTIONS
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background:'rgba(255,255,255,0.02)', border:`1px solid ${s.active ? s.color + '55' : 'rgba(255,255,255,0.08)'}` }}>
      {/* Header — clickable to expand */}
      <button onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-white/5 transition-all">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-2 h-2 rounded-full" style={{ background: s.active ? s.color : 'rgba(255,255,255,0.2)' }}></span>
          <span style={{ color:'rgba(255,255,255,0.9)', fontWeight: 600 }}>{s.name}</span>
          <span className="text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded"
            style={{ background:`${s.color}15`, color: s.color, border:`1px solid ${s.color}40`, fontFamily:'JetBrains Mono, monospace' }}>
            {s.type}
          </span>
          <span className="text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded"
            style={{
              background: s.active ? 'rgba(82,183,136,0.12)' : 'rgba(255,255,255,0.05)',
              color: s.active ? '#52b788' : 'rgba(255,255,255,0.4)',
              border: `1px solid ${s.active ? 'rgba(82,183,136,0.35)' : 'rgba(255,255,255,0.1)'}`,
              fontFamily:'JetBrains Mono, monospace',
            }}>
            {s.active ? 'active' : 'inactive'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px]" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>
          <span>{s.scanIntervalMin} min</span>
          <span>{s.watchlist.join(', ')}</span>
          <span style={{ fontSize: 14 }}>{expanded ? '−' : '+'}</span>
        </div>
      </button>

      {expanded && (
        <div className="p-4 space-y-4" style={{ borderTop:'1px solid rgba(255,255,255,0.06)' }}>
          {/* Core */}
          <div className="space-y-2">
            <p className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>Core</p>
            <Row label="ID"               value={s.id} />
            <Row label="Color"            value={s.color} />
            <Row label="Scan Interval"    value={`${s.scanIntervalMin} min`} desc={`Cron fires every ${s.scanIntervalMin} minute(s) during market hours.`} />
            <Row label="Watchlist"        value={s.watchlist.join(', ')} desc={`Lists scanned. Available keys: ${watchlistKeys.join(', ')}`} />
          </div>

          {/* Params */}
          <div className="space-y-2">
            <p className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>Params</p>
            {Object.entries(s.params).map(([k, v]) => (
              <Row key={k} label={k} value={fmtParamValue(v)} desc={paramDescs[k]} />
            ))}
          </div>

          {/* Exits */}
          <div className="space-y-2">
            <p className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>Exit Targets</p>
            <Row label="T1 (first target)"  value={`+${s.exits.t1Pct}%`} desc="First take-profit target as % gain from entry." />
            <Row label="T2 (second target)" value={`+${s.exits.t2Pct}%`} desc="Second take-profit target. For Strategy 1, T1 sells 50% and T2 sells the remaining." />
          </div>
        </div>
      )}
    </div>
  )
}

function fmtParamValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}
