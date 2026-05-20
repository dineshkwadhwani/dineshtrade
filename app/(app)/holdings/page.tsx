'use client'
import { useEffect, useState } from 'react'
import OrderModal from '@/components/OrderModal'
import { isMarketOpen } from '@/lib/market'

interface AccountDisplay { name: string; displayName: string; initials: string; color: string; note: string }

interface Holding {
  tradingsymbol: string
  exchange: string
  product: string
  // Kite splits long qty across two fields. `quantity` = T+1 settled (sellable
  // via CNC right now). `t1_quantity` = bought today, still in settlement —
  // becomes `quantity` next trading day. Total long = quantity + t1_quantity.
  quantity: number
  t1_quantity?: number
  average_price: number
  last_price: number
  close_price: number
  pnl: number
  day_change: number
  day_change_percentage: number
}

function totalQty(h: Holding): number {
  return (h.quantity || 0) + (h.t1_quantity || 0)
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
  const [s1Symbols, setS1Symbols] = useState<Set<string>>(new Set())   // "ACCOUNT:SYMBOL" keys in strategy1.json
  const [loaded, setLoaded] = useState(false)
  const [orderModal, setOrderModal] = useState<{
    open: boolean; symbol: string; name?: string; side: 'BUY' | 'SELL'; ltp?: number; initialQty?: number; dayChangePct?: number
  }>({ open: false, symbol: '', side: 'SELL' })

  const [market, setMarket] = useState(() => isMarketOpen())
  useEffect(() => {
    const id = setInterval(() => setMarket(isMarketOpen()), 60_000)
    return () => clearInterval(id)
  }, [])

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

  // Fetch margins + holdings + Strategy 1 registry whenever active tab changes.
  // The S1 registry is used to label each holding as S1-managed or OOS (out-of-system).
  async function load(account: string) {
    setLoading(true)
    setError('')
    setMargins(null)
    setHoldings([])
    try {
      const [mRes, hRes, sRes] = await Promise.all([
        fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=margins`).then(r => r.json()),
        fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=holdings`).then(r => r.json()),
        fetch('/api/strategy/positions').then(r => r.json()).catch(() => ({ positions: [] })),
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
      const s1Set = new Set<string>(
        (sRes?.positions || []).map((p: any) => `${p.account}:${String(p.symbol).toUpperCase()}`)
      )
      setS1Symbols(s1Set)
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
      const q = totalQty(h)
      acc.invested += h.average_price * q
      acc.current  += h.last_price * q
      acc.pnl      += h.pnl
      acc.dayPnl   += h.day_change * q
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
                  gridTemplateColumns: '1.4fr 0.5fr 0.8fr 0.8fr 0.8fr 0.65fr 1fr',
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
                const isS1 = s1Symbols.has(`${activeTab}:${h.tradingsymbol.toUpperCase()}`)
                return (
                <div key={`${h.tradingsymbol}-${i}`}
                  style={{ borderBottom: i < holdings.length-1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <div className="grid items-center px-4 py-3 text-[12px] transition-all hover:bg-white/5"
                    style={{ gridTemplateColumns: '1.4fr 0.5fr 0.8fr 0.8fr 0.8fr 0.65fr 1fr' }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-white/80 truncate" style={{ fontFamily:'JetBrains Mono, monospace' }}>{h.tradingsymbol}</span>
                      <span
                        title={isS1
                          ? 'Strategy 1 managed — auto-exit at 20-EMA recovery (T1) and EMA + 3% (T2)'
                          : 'Out of System — not auto-managed. Bought outside DineshTrade, or transitioned-out. Manual Sell still works.'}
                        className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0 tracking-wider"
                        style={{
                          background: isS1 ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.05)',
                          color:      isS1 ? '#c9a84c' : 'rgba(255,255,255,0.4)',
                          border:    `1px solid ${isS1 ? 'rgba(201,168,76,0.35)' : 'rgba(255,255,255,0.1)'}`,
                        }}>
                        {isS1 ? 'S1' : 'OOS'}
                      </span>
                    </div>
                    <span className="text-right text-white/60" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                      {totalQty(h)}
                      {(h.t1_quantity || 0) > 0 && (h.quantity || 0) === 0 && (
                        <span className="ml-1 text-[9px]" style={{ color:'rgba(96,165,250,0.7)' }} title="In T+1 settlement — sellable next trading day">T1</span>
                      )}
                    </span>
                    <span className="text-right text-white/50" style={{ fontFamily:'JetBrains Mono, monospace' }}>₹{h.average_price.toFixed(2)}</span>
                    <span className="text-right text-white/70" style={{ fontFamily:'JetBrains Mono, monospace' }}>₹{h.last_price.toFixed(2)}</span>
                    <span className="text-right" style={{ color: h.pnl >= 0 ? '#52b788' : '#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
                      {fmtPnl(h.pnl)}
                    </span>
                    <span className="text-right text-[11px]" style={{ color: h.day_change >= 0 ? '#52b788' : '#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
                      {h.day_change_percentage >= 0 ? '▲' : '▼'} {Math.abs(h.day_change_percentage).toFixed(2)}%
                    </span>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setOrderModal({ open: true, symbol: h.tradingsymbol, side: 'BUY', ltp: h.last_price, dayChangePct: h.day_change_percentage })}
                        disabled={!market.open}
                        title={!market.open ? 'Market closed' : undefined}
                        className="px-2 py-1 rounded text-[10px] font-semibold tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ background:'rgba(82,183,136,0.12)', border:'1px solid rgba(82,183,136,0.3)', color:'#52b788' }}>
                        <span className="sm:hidden">B</span><span className="hidden sm:inline">Buy</span>
                      </button>
                      <button onClick={() => setOrderModal({ open: true, symbol: h.tradingsymbol, side: 'SELL', ltp: h.last_price, initialQty: totalQty(h), dayChangePct: h.day_change_percentage })}
                        disabled={!market.open}
                        title={!market.open ? 'Market closed' : undefined}
                        className="px-2 py-1 rounded text-[10px] font-semibold tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ background:'rgba(224,90,94,0.12)', border:'1px solid rgba(224,90,94,0.3)', color:'#e05a5e' }}>
                        <span className="sm:hidden">S</span><span className="hidden sm:inline">Sell</span>
                      </button>
                    </div>
                  </div>
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

      <OrderModal
        isOpen={orderModal.open}
        onClose={() => setOrderModal({ ...orderModal, open: false })}
        symbol={orderModal.symbol}
        symbolName={orderModal.name}
        initialSide={orderModal.side}
        ltp={orderModal.ltp}
        dayChangePct={orderModal.dayChangePct}
        initialQty={orderModal.initialQty}
        accounts={accounts.filter(a => connected.includes(a.name))}
        defaultAccount={activeTab ?? undefined}
        onSuccess={() => {
          // Refresh funds + holdings after a successful order
          if (activeTab) load(activeTab)
        }} />
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
