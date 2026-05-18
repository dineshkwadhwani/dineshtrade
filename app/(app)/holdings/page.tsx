'use client'
import { useEffect, useState } from 'react'

interface AccountDisplay { name: string; displayName: string; initials: string; color: string; note: string }

interface Holding {
  tradingsymbol: string
  exchange: string
  product: string
  quantity: number
  average_price: number
  last_price: number
  close_price: number
  pnl: number
  day_change: number
  day_change_percentage: number
}

interface MarginsAvailable {
  cash?: number
  live_balance?: number
  opening_balance?: number
}

interface MarginsResponse {
  equity?: { net?: number; available?: MarginsAvailable; utilised?: { debits?: number } }
}

export default function HoldingsPage() {
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [margins, setMargins] = useState<MarginsResponse | null>(null)
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [loaded, setLoaded] = useState(false)
  const [sellBusy, setSellBusy] = useState<Record<string, boolean>>({})
  const [sellResult, setSellResult] = useState<Record<string, { ok: boolean; msg: string }>>({})

  async function sellHolding(h: Holding) {
    if (!activeTab) return
    const key = h.tradingsymbol
    const proceed = window.confirm(
      `SELL ${h.quantity} × ${h.tradingsymbol} at MARKET for ${activeTab}?\n\n` +
      `Avg: ₹${h.average_price.toFixed(2)}   LTP: ₹${h.last_price.toFixed(2)}\n` +
      `Est P&L on this leg: ${h.pnl >= 0 ? '+' : ''}₹${Math.round(h.pnl)}`
    )
    if (!proceed) return
    setSellBusy(b => ({ ...b, [key]: true }))
    setSellResult(r => ({ ...r, [key]: { ok: false, msg: '' } }))
    try {
      const res = await fetch('/api/zerodha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: activeTab,
          action: 'place_order',
          order: {
            symbol: h.tradingsymbol,
            quantity: h.quantity,
            transaction_type: 'SELL',
            price: h.last_price,
            source: 'Manual Sell (Holdings)',
            reason: `Manual exit. Avg ₹${h.average_price.toFixed(2)} → LTP ₹${h.last_price.toFixed(2)} (${h.pnl >= 0 ? '+' : ''}₹${Math.round(h.pnl)})`,
          },
        }),
      })
      const data = await res.json()
      if (res.ok && data.data?.order_id) {
        setSellResult(r => ({ ...r, [key]: { ok: true, msg: `✓ Order ${data.data.order_id}` } }))
      } else if (data.gate) {
        setSellResult(r => ({ ...r, [key]: { ok: false, msg: `✗ [${data.gate}] ${data.reason}` } }))
      } else {
        setSellResult(r => ({ ...r, [key]: { ok: false, msg: `✗ ${data.message || data.error || `HTTP ${res.status}`}` } }))
      }
    } catch (e) {
      setSellResult(r => ({ ...r, [key]: { ok: false, msg: '✗ Network error' } }))
    } finally {
      setSellBusy(b => ({ ...b, [key]: false }))
    }
  }

  // Initial load — accounts + connection set
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

  // Fetch margins + holdings whenever the active tab changes
  async function load(account: string) {
    setLoading(true)
    setError('')
    setMargins(null)
    setHoldings([])
    try {
      const [mRes, hRes] = await Promise.all([
        fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=margins`).then(r => r.json()),
        fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=holdings`).then(r => r.json()),
      ])
      if (mRes.error) {
        setError(mRes.error)
      } else {
        setMargins(mRes.data || null)
      }
      if (hRes.error && !mRes.error) {
        setError(hRes.error)
      } else if (Array.isArray(hRes.data)) {
        setHoldings(hRes.data)
      }
    } catch {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab) load(activeTab)
  }, [activeTab])

  const activeAccount = accounts.find(a => a.name === activeTab)
  const availableCash = margins?.equity?.available?.live_balance ?? margins?.equity?.available?.cash ?? null
  const usedMargin = margins?.equity?.utilised?.debits ?? null
  const netEquity = margins?.equity?.net ?? null

  const totals = holdings.reduce(
    (acc, h) => {
      acc.invested += h.average_price * h.quantity
      acc.current  += h.last_price * h.quantity
      acc.pnl      += h.pnl
      acc.dayPnl   += h.day_change * h.quantity
      return acc
    },
    { invested: 0, current: 0, pnl: 0, dayPnl: 0 }
  )

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
          Current <span className="gold-text">Holdings</span>
        </h1>
        {activeTab && (
          <button onClick={() => load(activeTab)} disabled={loading}
            className="px-4 py-2 rounded-lg text-[11px] font-medium transition-all"
            style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.2)', color:'#c9a84c' }}>
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        )}
      </div>

      <AccountTabs accounts={accounts} connected={connected} active={activeTab} onSelect={setActiveTab} loaded={loaded} />

      {loaded && connected.length === 0 && <NoneConnectedHint />}

      {activeTab && (
        <>
          {/* AVAILABLE FUNDS — first line per spec */}
          <div className="rounded-xl p-5"
            style={{
              background: activeAccount ? `${activeAccount.color}08` : 'rgba(201,168,76,0.05)',
              border: `1px solid ${activeAccount ? activeAccount.color + '33' : 'rgba(201,168,76,0.15)'}`,
            }}>
            <p className="text-[10px] tracking-widest uppercase mb-2"
              style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
              Available Funds
            </p>
            <p className="text-3xl font-light"
              style={{ color: activeAccount?.color || '#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              {availableCash !== null ? `₹${Math.round(availableCash).toLocaleString('en-IN')}` : (loading ? '…' : '—')}
            </p>
            <div className="grid grid-cols-2 gap-4 mt-3 text-[11px]" style={{ fontFamily:'JetBrains Mono, monospace' }}>
              <div>
                <span style={{ color:'rgba(255,255,255,0.3)' }}>Used Margin: </span>
                <span style={{ color:'rgba(255,255,255,0.6)' }}>{usedMargin !== null ? `₹${Math.round(usedMargin).toLocaleString('en-IN')}` : '—'}</span>
              </div>
              <div>
                <span style={{ color:'rgba(255,255,255,0.3)' }}>Net Equity: </span>
                <span style={{ color:'rgba(255,255,255,0.6)' }}>{netEquity !== null ? `₹${Math.round(netEquity).toLocaleString('en-IN')}` : '—'}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-xl p-4" style={{ background:'rgba(224,90,94,0.05)', border:'1px solid rgba(224,90,94,0.2)' }}>
              <p className="text-sm" style={{ color:'rgba(224,90,94,0.85)' }}>✗ {error}</p>
            </div>
          )}

          {/* Holdings totals row */}
          {holdings.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label:'Invested', val:`₹${Math.round(totals.invested).toLocaleString('en-IN')}`, color:'rgba(255,255,255,0.7)' },
                { label:'Current',  val:`₹${Math.round(totals.current).toLocaleString('en-IN')}`,  color:'#c9a84c' },
                { label:'Overall P&L', val: fmtPnl(totals.pnl), color: totals.pnl >= 0 ? '#52b788' : '#e05a5e' },
                { label:"Today's P&L", val: fmtPnl(totals.dayPnl), color: totals.dayPnl >= 0 ? '#52b788' : '#e05a5e' },
              ].map(s => (
                <div key={s.label} className="rounded-xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{s.label}</p>
                  <p className="text-lg font-semibold" style={{ color:s.color, fontFamily:'JetBrains Mono, monospace' }}>{s.val}</p>
                </div>
              ))}
            </div>
          )}

          {/* Holdings table */}
          {holdings.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="grid items-center px-4 py-2 text-[9px] tracking-widest uppercase"
                style={{
                  gridTemplateColumns: '1.3fr 0.55fr 0.85fr 0.85fr 0.85fr 0.7fr 0.85fr',
                  background:'rgba(255,255,255,0.02)', color:'rgba(255,255,255,0.25)',
                  fontFamily:'JetBrains Mono, monospace', borderBottom:'1px solid rgba(255,255,255,0.06)',
                }}>
                <span>Symbol</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Avg</span>
                <span className="text-right">LTP</span>
                <span className="text-right">P&L</span>
                <span className="text-right">Today</span>
                <span className="text-right">Action</span>
              </div>
              {holdings.map((h, i) => {
                const key = h.tradingsymbol
                const busy = !!sellBusy[key]
                const result = sellResult[key]
                return (
                  <div key={`${h.tradingsymbol}-${i}`}
                    style={{ borderBottom: i < holdings.length-1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                    <div className="grid items-center px-4 py-3 text-[12px] transition-all hover:bg-white/5"
                      style={{ gridTemplateColumns: '1.3fr 0.55fr 0.85fr 0.85fr 0.85fr 0.7fr 0.85fr' }}>
                      <span className="font-semibold text-white/80" style={{ fontFamily:'JetBrains Mono, monospace' }}>{h.tradingsymbol}</span>
                      <span className="text-right text-white/60" style={{ fontFamily:'JetBrains Mono, monospace' }}>{h.quantity}</span>
                      <span className="text-right text-white/50" style={{ fontFamily:'JetBrains Mono, monospace' }}>₹{h.average_price.toFixed(2)}</span>
                      <span className="text-right text-white/70" style={{ fontFamily:'JetBrains Mono, monospace' }}>₹{h.last_price.toFixed(2)}</span>
                      <span className="text-right" style={{ color: h.pnl >= 0 ? '#52b788' : '#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
                        {fmtPnl(h.pnl)}
                      </span>
                      <span className="text-right text-[11px]" style={{ color: h.day_change >= 0 ? '#52b788' : '#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
                        {h.day_change_percentage >= 0 ? '▲' : '▼'} {Math.abs(h.day_change_percentage).toFixed(2)}%
                      </span>
                      <span className="text-right">
                        <button onClick={() => sellHolding(h)} disabled={busy}
                          className="px-3 py-1 rounded text-[10px] font-semibold tracking-wider uppercase transition-all disabled:opacity-40"
                          style={{
                            background:'rgba(224,90,94,0.12)',
                            border:'1px solid rgba(224,90,94,0.3)',
                            color:'#e05a5e',
                          }}>
                          {busy ? '…' : 'Sell'}
                        </button>
                      </span>
                    </div>
                    {result && result.msg && (
                      <div className="px-4 pb-2 text-[11px]"
                        style={{ color: result.ok ? '#52b788' : 'rgba(224,90,94,0.85)' }}>
                        {result.msg}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!loading && !error && holdings.length === 0 && availableCash !== null && (
            <div className="text-center py-12">
              <p className="text-4xl mb-3 opacity-20">◎</p>
              <p className="text-base" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.35)', fontSize:'18px' }}>No holdings in this account</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function fmtPnl(v: number): string {
  const abs = Math.round(Math.abs(v)).toLocaleString('en-IN')
  return v >= 0 ? `+₹${abs}` : `-₹${abs}`
}

function AccountTabs({ accounts, connected, active, onSelect, loaded }: {
  accounts: AccountDisplay[]
  connected: string[]
  active: string | null
  onSelect: (n: string) => void
  loaded: boolean
}) {
  if (!loaded) return <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.3)' }}>Loading accounts…</p>
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

function NoneConnectedHint() {
  return (
    <div className="rounded-xl p-6 text-center"
      style={{ background:'rgba(201,168,76,0.05)', border:'1px solid rgba(201,168,76,0.15)' }}>
      <p className="text-4xl mb-3 opacity-20">⚙</p>
      <p className="text-sm mb-1" style={{ color:'rgba(201,168,76,0.7)' }}>No accounts connected</p>
      <p className="text-[12px]" style={{ color:'rgba(255,255,255,0.4)' }}>Go to Settings, paste today's Kite access token, and Connect.</p>
    </div>
  )
}
