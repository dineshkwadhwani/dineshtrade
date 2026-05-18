'use client'
import { useEffect, useState } from 'react'

interface AccountDisplay { name: string; displayName: string; initials: string; color: string; note: string }

interface Order {
  order_id: string
  tradingsymbol: string
  transaction_type: string
  quantity: number
  filled_quantity?: number
  average_price: number
  status: string
  order_timestamp?: string
  product: string
  exchange?: string
  status_message?: string
}

export default function OrdersPage() {
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

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

  async function load(account: string) {
    setLoading(true)
    setError('')
    setOrders([])
    try {
      const res = await fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=orders`).then(r => r.json())
      if (res.error) setError(res.error)
      else if (Array.isArray(res.data)) setOrders(res.data)
    } catch {
      setError('Failed to load orders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab) load(activeTab)
  }, [activeTab])

  const buys  = orders.filter(o => o.transaction_type === 'BUY')
  const sells = orders.filter(o => o.transaction_type === 'SELL')
  const totalBuyValue  = buys.reduce((s, o) => s + (o.average_price * (o.filled_quantity ?? o.quantity)), 0)
  const totalSellValue = sells.reduce((s, o) => s + (o.average_price * (o.filled_quantity ?? o.quantity)), 0)
  const dayPnL = totalSellValue - totalBuyValue

  const activeAccount = accounts.find(a => a.name === activeTab)

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
          Today's <span className="gold-text">Orders</span>
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

      {loaded && connected.length === 0 && (
        <div className="rounded-xl p-6 text-center"
          style={{ background:'rgba(201,168,76,0.05)', border:'1px solid rgba(201,168,76,0.15)' }}>
          <p className="text-4xl mb-3 opacity-20">⚙</p>
          <p className="text-sm mb-1" style={{ color:'rgba(201,168,76,0.7)' }}>No accounts connected</p>
          <p className="text-[12px]" style={{ color:'rgba(255,255,255,0.4)' }}>Go to Settings, paste today's Kite access token, and Connect.</p>
        </div>
      )}

      {activeTab && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label:'Buys Today',  val: buys.length, color:'#52b788' },
              { label:'Sells Today', val: sells.length, color:'#e05a5e' },
              { label:'Capital Used', val:`₹${Math.round(totalBuyValue).toLocaleString('en-IN')}`, color: activeAccount?.color || '#c9a84c' },
              { label:"Day P&L", val: dayPnL >= 0 ? `+₹${Math.round(dayPnL).toLocaleString('en-IN')}` : `-₹${Math.round(Math.abs(dayPnL)).toLocaleString('en-IN')}`, color: dayPnL >= 0 ? '#52b788' : '#e05a5e' },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{s.label}</p>
                <p className="text-xl font-semibold" style={{ color:s.color, fontFamily:'JetBrains Mono, monospace' }}>{s.val}</p>
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-xl p-4" style={{ background:'rgba(224,90,94,0.05)', border:'1px solid rgba(224,90,94,0.2)' }}>
              <p className="text-sm" style={{ color:'rgba(224,90,94,0.85)' }}>✗ {error}</p>
            </div>
          )}

          {orders.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="grid grid-cols-6 px-4 py-2 text-[9px] tracking-widest uppercase"
                style={{ background:'rgba(255,255,255,0.02)', color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                <span>Time</span>
                <span>Symbol</span>
                <span>Type</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Price</span>
                <span className="text-right">Status</span>
              </div>
              {orders.map((o, i) => (
                <div key={o.order_id}
                  className="grid grid-cols-6 px-4 py-3 items-center text-[12px] transition-all hover:bg-white/5"
                  style={{ borderBottom: i < orders.length-1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <span className="text-white/40 text-[10px]" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                    {fmtTime(o.order_timestamp)}
                  </span>
                  <span className="font-semibold text-white/80" style={{ fontFamily:'JetBrains Mono, monospace' }}>{o.tradingsymbol}</span>
                  <span className="font-medium" style={{ color: o.transaction_type === 'BUY' ? '#52b788' : '#e05a5e' }}>
                    {o.transaction_type === 'BUY' ? '▲ BUY' : '▼ SELL'}
                  </span>
                  <span className="text-right text-white/60" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                    {o.filled_quantity ?? o.quantity}{o.filled_quantity !== undefined && o.filled_quantity !== o.quantity ? `/${o.quantity}` : ''}
                  </span>
                  <span className="text-right text-white/60" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                    {o.average_price ? `₹${o.average_price.toFixed(2)}` : '—'}
                  </span>
                  <span className="text-right text-[10px]" style={{ color: statusColor(o.status), fontFamily:'JetBrains Mono, monospace' }}>
                    {o.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && orders.length === 0 && (
            <div className="text-center py-16">
              <p className="text-4xl mb-3 opacity-20">≡</p>
              <p className="text-base" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.35)', fontSize:'18px' }}>No orders today</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function statusColor(s: string): string {
  if (s === 'COMPLETE') return '#52b788'
  if (s === 'REJECTED' || s === 'CANCELLED') return '#e05a5e'
  return '#c9a84c'
}

function fmtTime(ts?: string): string {
  if (!ts) return '—'
  // Kite returns "2026-05-18 09:25:14"
  const m = ts.match(/(\d{2}):(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : ts.slice(0, 5)
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
