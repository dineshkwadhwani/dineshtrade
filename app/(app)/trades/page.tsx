'use client'
import { useState, useEffect } from 'react'

interface Order {
  order_id: string; tradingsymbol: string; transaction_type: string
  quantity: number; average_price: number; status: string
  order_timestamp: string; product: string
}

export default function TradesPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function fetchOrders() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/zerodha?action=orders&accessToken=')
      const data = await res.json()
      if (data.data) {
        setOrders(data.data)
      } else {
        setError(data.error || 'Connect Zerodha in Settings to see live orders')
      }
    } catch {
      setError('Connect Zerodha in Settings to see live orders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOrders() }, [])

  const buys  = orders.filter(o => o.transaction_type === 'BUY')
  const sells = orders.filter(o => o.transaction_type === 'SELL')
  const totalBuyValue  = buys.reduce((s, o) => s + (o.average_price * o.quantity), 0)
  const totalSellValue = sells.reduce((s, o) => s + (o.average_price * o.quantity), 0)
  const dayPnL = totalSellValue - totalBuyValue

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
          Today's <span className="gold-text">Trades</span>
        </h1>
        <button onClick={fetchOrders} disabled={loading}
          className="px-4 py-2 rounded-lg text-[11px] font-medium transition-all"
          style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.2)', color:'#c9a84c' }}>
          {loading ? '↻ Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Buys Today', val: buys.length, color:'#52b788' },
          { label:'Sells Today', val: sells.length, color:'#e05a5e' },
          { label:'Capital Used', val:`₹${totalBuyValue.toLocaleString('en-IN', {maximumFractionDigits:0})}`, color:'#c9a84c' },
          { label:"Day P&L", val: dayPnL >= 0 ? `+₹${dayPnL.toFixed(0)}` : `-₹${Math.abs(dayPnL).toFixed(0)}`, color: dayPnL >= 0 ? '#52b788' : '#e05a5e' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{s.label}</p>
            <p className="text-xl font-semibold" style={{ color:s.color, fontFamily:'JetBrains Mono, monospace' }}>{s.val}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-xl p-4 text-center" style={{ background:'rgba(201,168,76,0.05)', border:'1px solid rgba(201,168,76,0.15)' }}>
          <p className="text-sm" style={{ color:'rgba(201,168,76,0.6)' }}>⚙ {error}</p>
        </div>
      )}

      {orders.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.06)' }}>
          <div className="grid grid-cols-5 px-4 py-2 text-[9px] tracking-widest uppercase"
            style={{ background:'rgba(255,255,255,0.02)', color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            <span>Symbol</span><span>Type</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Status</span>
          </div>
          {orders.map((o, i) => (
            <div key={o.order_id}
              className="grid grid-cols-5 px-4 py-3 items-center text-sm transition-all hover:bg-white/5"
              style={{ borderBottom: i < orders.length-1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <span className="font-semibold text-white/80" style={{ fontFamily:'JetBrains Mono, monospace' }}>{o.tradingsymbol}</span>
              <span className="text-xs font-medium" style={{ color: o.transaction_type === 'BUY' ? '#52b788' : '#e05a5e' }}>
                {o.transaction_type === 'BUY' ? '▲ BUY' : '▼ SELL'}
              </span>
              <span className="text-right text-white/60" style={{ fontFamily:'JetBrains Mono, monospace' }}>{o.quantity}</span>
              <span className="text-right text-white/60" style={{ fontFamily:'JetBrains Mono, monospace' }}>₹{o.average_price}</span>
              <span className="text-right text-[10px]" style={{ color: o.status === 'COMPLETE' ? '#52b788' : o.status === 'REJECTED' ? '#e05a5e' : '#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                {o.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {!error && orders.length === 0 && !loading && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3 opacity-20">≡</p>
          <p className="text-base" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.35)', fontSize:'20px' }}>No trades yet today</p>
        </div>
      )}
    </div>
  )
}
