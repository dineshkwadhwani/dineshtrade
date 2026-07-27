'use client'
import { useEffect, useState } from 'react'
import OrderModal, { type AccountDisplay } from '@/components/OrderModal'
import type { EnrichedPosition, ClosedTodaySummary } from '@/app/api/positions/route'
import { isMarketOpen } from '@/lib/market'

export default function PositionsPage() {
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [positions, setPositions] = useState<EnrichedPosition[]>([])
  const [closedToday, setClosedToday] = useState<ClosedTodaySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  // Square-off modal — uses OrderModal pre-filled with SELL + held qty + the
  // position's product so it lines up with what's actually held in Kite.
  const [squareOff, setSquareOff] = useState<EnrichedPosition | null>(null)

  const [market, setMarket] = useState(() => isMarketOpen())
  useEffect(() => {
    const id = setInterval(() => setMarket(isMarketOpen()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/state').then(r => r.json()),
    ]).then(([a, s]) => {
      setAccounts(a.accounts || [])
      const conn: string[] = s.accountsWithToken || []
      setConnected(conn)
      if (conn.length > 0) setActiveTab(conn[0])
    }).catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const [fetchedAt, setFetchedAt] = useState<string>('')

  async function load(account: string) {
    setLoading(true); setError(''); setPositions([]); setClosedToday([])
    try {
      // cache-bust the browser fetch with a timestamp + no-store hint
      const res = await fetch(
        `/api/positions?account=${encodeURIComponent(account)}&_t=${Date.now()}`,
        { cache: 'no-store' },
      ).then(r => r.json())
      if (res.error) setError(res.error)
      else if (Array.isArray(res.positions)) setPositions(res.positions)
      if (Array.isArray(res.closedToday)) setClosedToday(res.closedToday)
      if (res.fetchedAt) setFetchedAt(res.fetchedAt)
    } catch {
      setError('Failed to load positions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab) load(activeTab)
  }, [activeTab])

  const openCount = positions.filter(p => p.qty !== 0).length
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealized, 0)
  const totalRealized = positions.reduce((s, p) => s + p.realized, 0)
  // Capital invested in still-open positions — used as the denominator for the
  // hero %-of-deployed-capital figures so users can read return in context.
  const investedOpen = positions.filter(p => p.qty > 0).reduce((s, p) => s + p.qty * p.avgPrice, 0)
  const totalUnrealizedPct = investedOpen > 0 ? (totalUnrealized / investedOpen) * 100 : null
  const totalPnl = totalUnrealized + totalRealized
  const capitalDeployed = investedOpen
  const totalPnlPct = capitalDeployed > 0 ? (totalPnl / capitalDeployed) * 100 : null
  const activeAccount = accounts.find(a => a.name === activeTab)

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
          Today's <span className="accent-text">Positions</span>
        </h1>
        {activeTab && (
          <div className="flex items-center gap-3">
            {!market.open && (
              <span className="text-[10px]" style={{ color:'rgba(245,158,11,0.85)', fontFamily:'JetBrains Mono, monospace' }}>
                {market.status} — trading disabled
              </span>
            )}
            {fetchedAt && (
              <span className="text-[10px] dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                fetched {new Date(fetchedAt).toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' })}
              </span>
            )}
            <button onClick={() => load(activeTab)} disabled={loading}
              className="px-4 py-2 rounded-lg text-[11px] font-medium transition-all"
              style={{ background:'rgba(93,169,255,0.12)', border:'1px solid rgba(93,169,255,0.3)', color:'#7fd1ff' }}>
              {loading ? '↻ Loading…' : '↻ Refresh'}
            </button>
          </div>
        )}
      </div>

      <AccountTabs accounts={accounts} connected={connected} active={activeTab} onSelect={setActiveTab} loaded={loaded} />

      {loaded && connected.length === 0 && (
        <div className="rounded-xl p-6 text-center dt-banner-accent">
          <p className="text-4xl mb-3 opacity-20">⚙</p>
          <p className="text-sm mb-1" style={{ color:'rgba(201,168,76,0.7)' }}>No accounts connected</p>
          <p className="text-[12px] dt-text-muted">Go to Settings, paste today's Kite access token, and Connect.</p>
        </div>
      )}

      {activeTab && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label:'Open Positions',         val: String(openCount), sub: undefined,                              color: activeAccount?.color || '#c9a84c' },
              { label:'Capital Deployed',       val:`₹${Math.round(capitalDeployed).toLocaleString('en-IN')}`, sub: undefined, color:'#c9a84c' },
              { label:'Unrealized',             val: signedRupees(totalUnrealized), sub: signedPct(totalUnrealizedPct), color: totalUnrealized >= 0 ? '#52b788' : '#e05a5e' },
              { label:'Day P&L (incl. closed)', val: signedRupees(totalPnl),        sub: signedPct(totalPnlPct),        color: totalPnl >= 0 ? '#52b788' : '#e05a5e' },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-4 dt-card">
                <p className="text-[9px] tracking-widest uppercase mb-2 dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>{s.label}</p>
                <p className="text-xl font-semibold" style={{ color:s.color, fontFamily:'JetBrains Mono, monospace' }}>{s.val}</p>
                {s.sub && <p className="text-[11px] mt-1" style={{ color:s.color, opacity:0.7, fontFamily:'JetBrains Mono, monospace' }}>{s.sub}</p>}
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-xl p-4 dt-banner-error">
              <p className="text-sm" style={{ color:'rgba(224,90,94,0.85)' }}>✗ {error}</p>
            </div>
          )}

          {positions.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.06)' }}>
              {/* Header — desktop only; mobile uses inline labels per cell */}
              <div className="hidden sm:grid grid-cols-12 px-4 py-2.5 text-[9px] tracking-widest uppercase dt-table-head"
                style={{ fontFamily:'JetBrains Mono, monospace' }}>
                <span className="col-span-3">Symbol</span>
                <span className="col-span-1 text-right">Qty</span>
                <span className="col-span-2 text-right">Avg</span>
                <span className="col-span-2 text-right">LTP</span>
                <span className="col-span-2 text-right">P&L</span>
                <span className="col-span-2 text-right">Action</span>
              </div>
              {positions.map((p, i) => (
                <PositionRow key={p.symbol + i} p={p} last={i === positions.length - 1}
                  marketOpen={market.open} onSquareOff={() => setSquareOff(p)} />
              ))}
            </div>
          )}

          {closedToday.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="px-4 py-2.5 text-[9px] tracking-widest uppercase dt-table-head"
                style={{ fontFamily:'JetBrains Mono, monospace' }}>
                Closed Today ({closedToday.length})
              </div>
              <div className="hidden sm:grid grid-cols-12 px-4 py-2.5 text-[9px] tracking-widest uppercase dt-table-head"
                style={{ fontFamily:'JetBrains Mono, monospace', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
                <span className="col-span-4">Symbol</span>
                <span className="col-span-2 text-right">Closed Qty</span>
                <span className="col-span-2 text-right">Buy VWAP</span>
                <span className="col-span-2 text-right">Sell VWAP</span>
                <span className="col-span-2 text-right">Realized</span>
              </div>
              {closedToday.map((row, i) => {
                const color = row.realized >= 0 ? '#52b788' : '#e05a5e'
                return (
                  <div key={`${row.symbol}-${i}`}
                    style={{ borderTop:'1px solid rgba(255,255,255,0.04)' }}>
                    {/* Desktop: grid layout */}
                    <div className="hidden sm:grid grid-cols-12 px-4 py-3 items-center text-[12px]"
                      style={{ fontFamily:'JetBrains Mono, monospace' }}>
                      <span className="col-span-4 font-semibold dt-text-primary">{row.symbol}</span>
                      <span className="col-span-2 text-right dt-text-secondary">{row.closedQty}</span>
                      <span className="col-span-2 text-right dt-text-secondary">₹{row.buyVwap.toFixed(2)}</span>
                      <span className="col-span-2 text-right dt-text-secondary">₹{row.sellVwap.toFixed(2)}</span>
                      <span className="col-span-2 text-right font-semibold" style={{ color }}>{signedRupees(row.realized)}</span>
                    </div>
                    {/* Mobile: card layout */}
                    <div className="sm:hidden px-4 py-3 text-[12px] space-y-2" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                      <div className="font-semibold dt-text-primary text-[14px]">{row.symbol}</div>
                      <div className="flex justify-between gap-4 text-[11px]">
                        <div>
                          <span className="dt-text-muted">Qty</span> <span className="dt-text-secondary">{row.closedQty}</span>
                        </div>
                        <div>
                          <span className="dt-text-muted">Buy VWAP</span> <span className="dt-text-secondary">₹{row.buyVwap.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="flex justify-between gap-4 text-[11px]">
                        <div>
                          <span className="dt-text-muted">Sell VWAP</span> <span className="dt-text-secondary">₹{row.sellVwap.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="dt-text-muted">Realized</span> <span className="font-semibold" style={{ color }}>{signedRupees(row.realized)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!loading && !error && positions.length === 0 && (
            <div className="text-center py-16">
              <p className="text-4xl mb-3 opacity-20">∅</p>
              <p className="text-base dt-text-muted" style={{ fontFamily:'Cormorant Garamond, serif', fontSize:'18px' }}>No positions today</p>
            </div>
          )}
        </>
      )}

      {squareOff && activeTab && (
        <OrderModal
          isOpen={true}
          onClose={() => setSquareOff(null)}
          symbol={squareOff.symbol}
          initialSide="SELL"
          initialQty={squareOff.qty}
          initialProduct={squareOff.product === 'MIS' ? 'MIS' : 'CNC'}
          ltp={squareOff.ltp}
          dayChangePct={squareOff.dayChangePct}
          accounts={accounts.filter(a => a.name === activeTab)}
          defaultAccount={activeTab}
          onSuccess={() => { setSquareOff(null); load(activeTab) }}
        />
      )}
    </div>
  )
}

function PositionRow({ p, last, marketOpen, onSquareOff }: {
  p: EnrichedPosition; last: boolean; marketOpen: boolean; onSquareOff: () => void
}) {
  const isOpen = p.qty !== 0
  const uColor = p.unrealized >= 0 ? '#52b788' : '#e05a5e'
  const rColor = p.realized > 0 ? '#52b788' : p.realized < 0 ? '#e05a5e' : 'rgba(255,255,255,0.35)'
  const dc = p.dayChangePct
  const dColor = dc === undefined ? 'rgba(255,255,255,0.8)'
    : dc > 0 ? '#52b788' : dc < 0 ? '#e05a5e' : 'rgba(255,255,255,0.7)'
  // Position-level return since entry — what the user wants under each row's P&L.
  // For open positions: (ltp - avg)/avg. For closed: skip (qty is 0).
  const unrealizedPct = isOpen && p.avgPrice > 0 && p.ltp > 0
    ? ((p.ltp - p.avgPrice) / p.avgPrice) * 100
    : null
  const strategyLabel = p.strategyName
    ? p.strategyName.trim()
    : (p.strategyId ? p.strategyId.replace(/[_-]+/g, ' ').trim() : null)
  const strategyText = (strategyLabel || 'MANUAL').toUpperCase()
  const strategyColor = p.strategyColor || '#c9a84c'
  const strategyBadgeColor = strategyLabel ? strategyColor : 'rgba(148,163,184,0.95)'

  const SquareOffBtn = isOpen ? (
    <button onClick={onSquareOff} disabled={!marketOpen}
      title={!marketOpen ? 'Market closed — square-off disabled' : undefined}
      className="px-3 py-1.5 rounded-md text-[10px] font-semibold tracking-wider transition-all hover:scale-105 whitespace-nowrap disabled:cursor-not-allowed disabled:hover:scale-100"
      style={{
        background: marketOpen ? 'rgba(224,90,94,0.12)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${marketOpen ? 'rgba(224,90,94,0.4)' : 'rgba(255,255,255,0.1)'}`,
        color: marketOpen ? '#e05a5e' : 'rgba(255,255,255,0.3)',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
      <span className="sm:hidden">× SQ</span><span className="hidden sm:inline">× SQUARE OFF</span>
    </button>
  ) : (
    <span className="text-[10px]" style={{ color:'rgba(255,255,255,0.25)' }}>—</span>
  )

  return (
    <div className="px-4 py-3 transition-all hover:bg-white/5 text-[12px]"
      style={{ borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.04)', opacity: isOpen ? 1 : 0.55 }}>

      {/* ── Mobile layout: 3-line two-column card ──────────────────────────── */}
      <div className="sm:hidden flex items-start justify-between gap-3">
        {/* Left — symbol + tags, avg, qty */}
        <div className="min-w-0 flex flex-col gap-1" style={{ fontFamily:'JetBrains Mono, monospace' }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[16px] font-semibold truncate dt-text-primary">{p.symbol}</span>
            {!isOpen && (
              <span className="text-[8px] tracking-widest uppercase px-1.5 py-0.5 rounded"
                style={{ background:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.4)' }}>CLOSED</span>
            )}
            <span className="text-[8px] tracking-wider uppercase px-1.5 py-0.5 rounded"
              title={strategyText}
              style={{ background: `${strategyBadgeColor}26`, color: strategyBadgeColor, border: `1px solid ${strategyBadgeColor}59` }}>
              {strategyText}
            </span>
          </div>
          <div className="text-[11px] dt-text-muted">
            Avg <span style={{ color:'rgba(255,255,255,0.75)' }}>{p.avgPrice > 0 ? `₹${p.avgPrice.toFixed(2)}` : '—'}</span>
          </div>
          <div className="text-[11px] dt-text-muted">
            Qty <span style={{ color:'rgba(255,255,255,0.75)' }}>{p.qty}</span>
          </div>
        </div>

        {/* Right — P&L (₹ + %), LTP, button */}
        <div className="shrink-0 flex flex-col items-end gap-1" style={{ fontFamily:'JetBrains Mono, monospace' }}>
          <div className="text-right">
            <div className="text-[15px] font-semibold whitespace-nowrap" style={{ color: isOpen ? uColor : 'rgba(255,255,255,0.35)' }}>
              {isOpen ? signedRupees(p.unrealized) : '—'}
            </div>
            {unrealizedPct !== null && (
              <div className="text-[10px] whitespace-nowrap" style={{ color: uColor, opacity: 0.75 }}>
                {signedPct(unrealizedPct)}
              </div>
            )}
          </div>
          <div className="text-[11px] whitespace-nowrap dt-text-muted">
            LTP <span style={{ color: dColor }}>{p.ltp > 0 ? `₹${p.ltp.toFixed(2)}` : '—'}</span>
            {dc !== undefined && <span className="ml-1.5" style={{ color: dColor }}>{Math.abs(dc).toFixed(2)}%</span>}
          </div>
          <div className="pt-0.5">{SquareOffBtn}</div>
          {p.realized !== 0 && (
            <div className="text-[9px] whitespace-nowrap" style={{ color: rColor }}>realized {signedRupees(p.realized)}</div>
          )}
        </div>
      </div>

      {/* ── Desktop layout (sm+) ───────────────────────────────────────────── */}
      <div className="hidden sm:grid grid-cols-12 items-center">
        <div className="col-span-3 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white/85" style={{ fontFamily:'JetBrains Mono, monospace' }}>{p.symbol}</span>
          {!isOpen && (
            <span className="text-[8px] tracking-widest uppercase px-1.5 py-0.5 rounded"
              style={{ background:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>CLOSED</span>
          )}
          <span className="text-[8px] tracking-wider uppercase px-1.5 py-0.5 rounded"
            title={strategyText}
            style={{ background: `${strategyBadgeColor}26`, color: strategyBadgeColor, border: `1px solid ${strategyBadgeColor}59`, fontFamily:'JetBrains Mono, monospace' }}>
            {strategyText}
          </span>
        </div>
        <span className="col-span-1 text-right text-white/70" style={{ fontFamily:'JetBrains Mono, monospace' }}>{p.qty}</span>
        <span className="col-span-2 text-right text-white/70" style={{ fontFamily:'JetBrains Mono, monospace' }}>
          {p.avgPrice > 0 ? `₹${p.avgPrice.toFixed(2)}` : '—'}
        </span>
        <span className="col-span-2 text-right whitespace-nowrap" style={{ fontFamily:'JetBrains Mono, monospace' }}>
          <div style={{ color: dColor }}>{p.ltp > 0 ? `₹${p.ltp.toFixed(2)}` : '—'}</div>
          {dc !== undefined && (
            <div className="text-[9px] mt-0.5" style={{ color: dColor }}>{Math.abs(dc).toFixed(2)}%</div>
          )}
        </span>
        <span className="col-span-2 text-right" style={{ fontFamily:'JetBrains Mono, monospace' }}>
          <div className="font-semibold" style={{ color: isOpen ? uColor : 'rgba(255,255,255,0.35)' }}>
            {isOpen ? signedRupees(p.unrealized) : '—'}
          </div>
          {unrealizedPct !== null && (
            <div className="text-[9px] mt-0.5" style={{ color: uColor, opacity: 0.75 }}>{signedPct(unrealizedPct)}</div>
          )}
          {p.realized !== 0 && (
            <div className="text-[9px] mt-0.5" style={{ color: rColor }}>realized {signedRupees(p.realized)}</div>
          )}
        </span>
        <div className="col-span-2 text-right">{SquareOffBtn}</div>
      </div>
    </div>
  )
}

function signedPct(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return ''
  const sign = p >= 0 ? '+' : ''
  return `${sign}${p.toFixed(2)}%`
}

function signedRupees(n: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  const abs = Math.abs(Math.round(n)).toLocaleString('en-IN')
  return n >= 0 ? `+₹${abs}` : `-₹${abs}`
}

function AccountTabs({ accounts, connected, active, onSelect, loaded }: {
  accounts: AccountDisplay[]
  connected: string[]
  active: string | null
  onSelect: (n: string) => void
  loaded: boolean
}) {
  if (!loaded) return <p className="text-[11px] dt-text-muted">Loading accounts…</p>
  const connectedAccounts = accounts.filter(a => connected.includes(a.name))
  if (connectedAccounts.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {connectedAccounts.map(acc => {
        const isActive = active === acc.name
        return (
          <button key={acc.name} onClick={() => onSelect(acc.name)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] transition-all"
            style={{
              background: isActive ? `${acc.color}15` : 'rgba(255,255,255,0.02)',
              border: `1px solid ${isActive ? acc.color + '55' : 'rgba(255,255,255,0.08)'}`,
              color: isActive ? acc.color : 'rgba(255,255,255,0.5)',
            }}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background:`${acc.color}20`, color:acc.color, border:`1px solid ${acc.color}40` }}>
              {acc.initials}
            </span>
            <span style={{ fontWeight: isActive ? 500 : 400 }}>{acc.displayName}</span>
          </button>
        )
      })}
    </div>
  )
}
