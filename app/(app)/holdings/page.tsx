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
  // Maps "ACCOUNT:SYMBOL" → strategy info from the unified position store.
  // Holdings not in the store render as OOS (pre-existing / not auto-managed).
  const [posTags, setPosTags] = useState<Map<string, { strategyId: string; strategyName: string; strategyColor: string; strategyType?: string }>>(new Map())
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

  // Fetch margins + holdings + unified position store whenever active tab changes.
  // The position store tags each holding with its managing strategy (CATALYST,
  // MARKET BOOM, ACCUMULATOR, …). Holdings not in the store render as OOS.
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
      const tagMap = new Map<string, { strategyId: string; strategyName: string; strategyColor: string; strategyType?: string }>()
      for (const p of (sRes?.positions || []) as any[]) {
        tagMap.set(`${String(p.account).toUpperCase()}:${String(p.symbol).toUpperCase()}`, {
          strategyId: p.strategyId,
          strategyName: p.strategyName,
          strategyColor: p.strategyColor,
          strategyType: p.strategyType,
        })
      }
      setPosTags(tagMap)
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
          {holdings.length > 0 && (() => {
            // % vs Invested for each P&L hero. Current's % is the same as Overall (capital appreciation).
            const inv = totals.invested
            const overallPct = inv > 0 ? (totals.pnl / inv) * 100 : null
            const dayPct     = inv > 0 ? (totals.dayPnl / inv) * 100 : null
            const currentPct = inv > 0 ? ((totals.current - inv) / inv) * 100 : null
            return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label:'Invested',    val:`₹${Math.round(totals.invested).toLocaleString('en-IN')}`, sub: undefined,         color:'rgba(255,255,255,0.7)' },
                { label:'Current',     val:`₹${Math.round(totals.current).toLocaleString('en-IN')}`,  sub: fmtSignedPct(currentPct), subColor: currentPct !== null && currentPct >= 0 ? '#52b788' : '#e05a5e', color:'#c9a84c' },
                { label:'Overall P&L', val: fmtPnl(totals.pnl),    sub: fmtSignedPct(overallPct), color: totals.pnl >= 0 ? '#52b788' : '#e05a5e' },
                { label:"Today's P&L", val: fmtPnl(totals.dayPnl), sub: fmtSignedPct(dayPct),     color: totals.dayPnl >= 0 ? '#52b788' : '#e05a5e' },
              ].map(s => (
                <div key={s.label} className="rounded-xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{s.label}</p>
                  <p className="text-lg font-semibold" style={{ color:s.color, fontFamily:'JetBrains Mono, monospace' }}>{s.val}</p>
                  {s.sub && <p className="text-[11px] mt-1" style={{ color: (s as any).subColor ?? s.color, opacity: 0.7, fontFamily:'JetBrains Mono, monospace' }}>{s.sub}</p>}
                </div>
              ))}
            </div>
            )
          })()}

          {/* Holdings cards — card-per-holding, two-column layout on mobile */}
          {holdings.length > 0 && (
            <div className="space-y-3">
              {holdings.map((h, i) => {
                const tag = posTags.get(`${(activeTab || '').toUpperCase()}:${h.tradingsymbol.toUpperCase()}`)
                const isManaged = !!tag
                const badgeLabel = isManaged ? tag!.strategyName.toUpperCase().slice(0, 14) : 'OOS'
                const badgeColor = isManaged ? tag!.strategyColor : 'rgba(255,255,255,0.4)'
                const badgeTitle = isManaged
                  ? `${tag!.strategyName} managed — auto-exit per strategy params (see Settings).`
                  : 'Out of System — not auto-managed. Bought outside DineshTrade, or transitioned-out. Manual Sell still works.'
                const pnlColor = h.pnl >= 0 ? '#52b788' : '#e05a5e'
                const dayColor = h.day_change_percentage >= 0 ? '#52b788' : '#e05a5e'
                const isT1Only = (h.t1_quantity || 0) > 0 && (h.quantity || 0) === 0
                const qty = totalQty(h)
                const pnlPct = h.average_price > 0 ? ((h.last_price - h.average_price) / h.average_price) * 100 : 0
                return (
                  <div key={`${h.tradingsymbol}-${i}`} className="rounded-xl p-4"
                    style={{ background:'#100e0a', border:'1px solid rgba(255,255,255,0.08)' }}>
                    {/* Top row: symbol + badge left, P&L right */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-bold text-white/90 text-[15px]" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                          {h.tradingsymbol}
                        </span>
                        {isT1Only && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded tracking-wider"
                            style={{ background:'rgba(96,165,250,0.12)', color:'rgba(96,165,250,0.8)', border:'1px solid rgba(96,165,250,0.25)' }}
                            title="In T+1 settlement — sellable next trading day">T1</span>
                        )}
                        <span title={badgeTitle}
                          className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0 tracking-wider"
                          style={{
                            background: isManaged ? `${badgeColor}26` : 'rgba(255,255,255,0.05)',
                            color: badgeColor,
                            border: `1px solid ${isManaged ? `${badgeColor}59` : 'rgba(255,255,255,0.1)'}`,
                          }}>
                          {badgeLabel}
                        </span>
                      </div>
                      <div className="text-right ml-3 flex-shrink-0">
                        <p className="text-[15px] font-semibold" style={{ color: pnlColor, fontFamily:'JetBrains Mono, monospace' }}>{fmtPnl(h.pnl)}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: pnlColor, fontFamily:'JetBrains Mono, monospace', opacity:0.8 }}>
                          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                        </p>
                      </div>
                    </div>

                    {/* Detail row: two columns */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mb-3" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                      <div style={{ color:'rgba(255,255,255,0.45)' }}>
                        Avg <span style={{ color:'rgba(255,255,255,0.75)' }}>₹{h.average_price.toFixed(2)}</span>
                      </div>
                      <div className="text-right" style={{ color:'rgba(255,255,255,0.45)' }}>
                        LTP <span style={{ color:'rgba(255,255,255,0.85)' }}>₹{h.last_price.toFixed(2)}</span>
                      </div>
                      <div style={{ color:'rgba(255,255,255,0.45)' }}>
                        Qty <span style={{ color:'rgba(255,255,255,0.75)' }}>{qty}</span>
                      </div>
                      <div className="text-right" style={{ color: dayColor }}>
                        {h.day_change_percentage >= 0 ? '▲' : '▼'} {Math.abs(h.day_change_percentage).toFixed(2)}% today
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setOrderModal({ open: true, symbol: h.tradingsymbol, side: 'BUY', ltp: h.last_price, dayChangePct: h.day_change_percentage })}
                        disabled={!market.open}
                        title={!market.open ? 'Market closed' : undefined}
                        className="px-3 py-1.5 rounded text-[10px] font-semibold tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ background:'rgba(82,183,136,0.12)', border:'1px solid rgba(82,183,136,0.3)', color:'#52b788' }}>
                        Buy
                      </button>
                      <button
                        onClick={() => setOrderModal({ open: true, symbol: h.tradingsymbol, side: 'SELL', ltp: h.last_price, initialQty: qty, dayChangePct: h.day_change_percentage })}
                        disabled={!market.open}
                        title={!market.open ? 'Market closed' : undefined}
                        className="px-3 py-1.5 rounded text-[10px] font-semibold tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ background:'rgba(224,90,94,0.12)', border:'1px solid rgba(224,90,94,0.3)', color:'#e05a5e' }}>
                        Sell
                      </button>
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

function fmtSignedPct(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return ''
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
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
