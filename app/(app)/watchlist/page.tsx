'use client'
import { useState, useEffect } from 'react'
import watchlistData from '@/config/watchlist.json'
import OrderModal from '@/components/OrderModal'

interface AccountDisplay { name: string; displayName: string; initials: string; color: string; note: string }

export default function WatchlistPage() {
  const [activeTab, setActiveTab] = useState<'A'|'B'>('A')
  const [search, setSearch] = useState('')
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [activeAccount, setActiveAccount] = useState<string | null>(null)
  const [heldSymbols, setHeldSymbols] = useState<Set<string>>(new Set())
  const [holdingsLoading, setHoldingsLoading] = useState(false)
  const [quotes, setQuotes] = useState<Record<string, { ltp: number; changePct: number }>>({})
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [orderModal, setOrderModal] = useState<{
    open: boolean; symbol: string; name?: string; side: 'BUY' | 'SELL'; ltp?: number
  }>({ open: false, symbol: '', side: 'BUY' })

  const raw = activeTab === 'A' ? watchlistData.listA : watchlistData.listB
  const filtered = raw.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.nse.toLowerCase().includes(search.toLowerCase())
  )

  // Load accounts + connection state
  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/state').then(r => r.json()),
    ]).then(([a, s]) => {
      setAccounts(a.accounts || [])
      const conn: string[] = s.accountsWithToken || []
      setConnected(conn)
      if (conn.length > 0) setActiveAccount(conn[0])
    }).catch(() => {})
  }, [])

  // Fetch holdings when active account changes
  useEffect(() => {
    if (!activeAccount) {
      setHeldSymbols(new Set())
      return
    }
    setHoldingsLoading(true)
    fetch(`/api/zerodha?account=${encodeURIComponent(activeAccount)}&action=holdings`)
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data?.data) ? data.data : []
        setHeldSymbols(new Set(list.map((h: any) => String(h.tradingsymbol).toUpperCase())))
      })
      .catch(() => setHeldSymbols(new Set()))
      .finally(() => setHoldingsLoading(false))
  }, [activeAccount])

  // Fetch live LTPs for the whole watchlist (List A + List B) — one batched /quote call
  useEffect(() => {
    if (!activeAccount) {
      setQuotes({})
      return
    }
    const allSymbols = [
      ...watchlistData.listA.map(s => s.nse.toUpperCase()),
      ...watchlistData.listB.map(s => s.nse.toUpperCase()),
    ]
    const symParam = allSymbols.map(s => `NSE:${s}`).join(',')
    setQuotesLoading(true)
    fetch(`/api/zerodha?account=${encodeURIComponent(activeAccount)}&action=quote&symbols=${encodeURIComponent(symParam)}`)
      .then(r => r.json())
      .then(data => {
        const kiteQuotes: Record<string, any> = data?.data || {}
        const out: Record<string, { ltp: number; changePct: number }> = {}
        for (const [key, q] of Object.entries(kiteQuotes)) {
          const symbol = key.replace(/^NSE:/, '')
          const ltp = Number(q.last_price)
          const prevClose = Number(q.ohlc?.close)
          const changePct = prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0
          if (ltp > 0) out[symbol] = { ltp, changePct }
        }
        setQuotes(out)
      })
      .catch(() => setQuotes({}))
      .finally(() => setQuotesLoading(false))
  }, [activeAccount])

  const connectedAccounts = accounts.filter(a => connected.includes(a.name))
  const activeColor = accounts.find(a => a.name === activeAccount)?.color || '#c9a84c'

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
          Watch<span className="gold-text">list</span>
        </h1>
        <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace' }}>
          Config-locked · Edit watchlist.json to add stocks
        </p>
      </div>

      {/* Account picker — visible only when 2+ accounts connected */}
      {connectedAccounts.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[10px] tracking-widest uppercase"
            style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
            Holdings highlight:
          </p>
          <div className="flex gap-2 flex-wrap">
            {connectedAccounts.map(acc => {
              const isActive = activeAccount === acc.name
              return (
                <button key={acc.name} onClick={() => setActiveAccount(acc.name)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] transition-all"
                  style={{
                    background: isActive ? `${acc.color}15` : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isActive ? acc.color + '55' : 'rgba(255,255,255,0.08)'}`,
                    color: isActive ? acc.color : 'rgba(255,255,255,0.45)',
                  }}>
                  <span style={{ fontWeight: 500 }}>{acc.initials}</span>
                  <span>{acc.displayName}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* List A / B tabs */}
      <div className="flex gap-2">
        {(['A','B'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-lg text-[12px] font-medium tracking-wider transition-all ${activeTab === tab ? 'text-[#080604]' : 'text-white/40 hover:text-white/60'}`}
            style={{
              background: activeTab === tab ? 'linear-gradient(135deg, #8a6a1a, #c9a84c)' : 'rgba(255,255,255,0.04)',
              border: activeTab === tab ? 'none' : '1px solid rgba(255,255,255,0.08)',
            }}>
            List {tab} <span className="ml-1.5 opacity-60">({tab === 'A' ? watchlistData.listA.length : watchlistData.listB.length})</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search stocks…"
        className="w-full px-4 py-3 rounded-xl text-sm outline-none"
        style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.8)' }} />

      {/* Legend */}
      <div className="flex gap-4 text-[10px] flex-wrap items-center" style={{ color:'rgba(255,255,255,0.3)' }}>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background:`${activeColor}55` }}></span>
          Currently holding{activeAccount ? ` in ${activeAccount}` : ''}
        </span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#52b788]"></span> Positive today</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#e05a5e]"></span> Negative today</span>
        {quotesLoading && (
          <span style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>· loading live prices…</span>
        )}
        {!quotesLoading && Object.keys(quotes).length > 0 && (
          <span style={{ color:'#52b788', fontFamily:'JetBrains Mono, monospace' }}>· {Object.keys(quotes).length} live</span>
        )}
      </div>

      {/* Stock list */}
      <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.06)' }}>
        <div className="grid px-4 py-2 text-[9px] tracking-widest uppercase items-center"
          style={{
            gridTemplateColumns: '1.1fr 1.6fr 0.9fr 0.8fr 0.5fr 0.9fr',
            background:'rgba(255,255,255,0.02)', color:'rgba(255,255,255,0.25)',
            fontFamily:'JetBrains Mono, monospace', borderBottom:'1px solid rgba(255,255,255,0.06)',
          }}>
          <span>Symbol</span>
          <span>Name</span>
          <span className="text-right">LTP</span>
          <span className="text-right">Today</span>
          <span className="text-right">Trades</span>
          <span className="text-right">Action</span>
        </div>
        {filtered.map((s, i) => {
          const sym = s.nse.toUpperCase()
          const held = heldSymbols.has(sym)
          const q = quotes[sym]
          const dir: 'up' | 'down' | 'flat' = !q ? 'flat' : q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : 'flat'
          const priceColor = dir === 'up' ? '#52b788' : dir === 'down' ? '#e05a5e' : 'rgba(255,255,255,0.55)'
          return (
            <div key={s.nse}
              className="grid px-4 py-3 items-center transition-all hover:bg-white/5"
              style={{
                gridTemplateColumns: '1.1fr 1.6fr 0.9fr 0.8fr 0.5fr 0.9fr',
                borderBottom: i < filtered.length-1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                background: held ? `${activeColor}12` : 'transparent',
              }}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-semibold truncate" style={{ fontFamily:'JetBrains Mono, monospace', color: priceColor }}>{s.nse}</span>
                {held && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background:`${activeColor}25`, color: activeColor, border:`1px solid ${activeColor}50` }}>
                    HELD
                  </span>
                )}
              </div>
              <span className="text-[11px] truncate" style={{ color:'rgba(255,255,255,0.45)' }}>{s.name}</span>
              <span className="text-right text-sm" style={{ fontFamily:'JetBrains Mono, monospace', color: priceColor }}>
                {q ? `₹${q.ltp.toFixed(2)}` : '—'}
              </span>
              <span className="text-right text-[11px]" style={{ fontFamily:'JetBrains Mono, monospace', color: priceColor }}>
                {q
                  ? `${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '─'} ${Math.abs(q.changePct).toFixed(2)}%`
                  : '—'}
              </span>
              <span className="text-right text-[11px]" style={{ color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace' }}>
                {s.trades}
              </span>
              <div className="flex gap-1 justify-end">
                <button onClick={() => setOrderModal({ open: true, symbol: sym, name: s.name, side: 'BUY', ltp: q?.ltp })}
                  disabled={!activeAccount}
                  className="px-2 py-1 rounded text-[10px] font-semibold tracking-wider transition-all disabled:opacity-30"
                  style={{ background: 'rgba(82,183,136,0.12)', border: '1px solid rgba(82,183,136,0.3)', color: '#52b788' }}>
                  Buy
                </button>
                <button onClick={() => setOrderModal({ open: true, symbol: sym, name: s.name, side: 'SELL', ltp: q?.ltp })}
                  disabled={!activeAccount}
                  className="px-2 py-1 rounded text-[10px] font-semibold tracking-wider transition-all disabled:opacity-30"
                  style={{ background: 'rgba(224,90,94,0.12)', border: '1px solid rgba(224,90,94,0.3)', color: '#e05a5e' }}>
                  Sell
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <OrderModal
        isOpen={orderModal.open}
        onClose={() => setOrderModal({ ...orderModal, open: false })}
        symbol={orderModal.symbol}
        symbolName={orderModal.name}
        initialSide={orderModal.side}
        ltp={orderModal.ltp}
        accounts={connectedAccounts}
        defaultAccount={activeAccount ?? undefined}
        onSuccess={() => {
          // Refresh holdings highlight after a successful order
          if (activeAccount) {
            fetch(`/api/zerodha?account=${encodeURIComponent(activeAccount)}&action=holdings`)
              .then(r => r.json())
              .then(d => {
                const list = Array.isArray(d?.data) ? d.data : []
                setHeldSymbols(new Set(list.map((h: any) => String(h.tradingsymbol).toUpperCase())))
              })
              .catch(() => {})
          }
        }} />

      <p className="text-[10px] text-center pb-2" style={{ color:'rgba(255,255,255,0.2)' }}>
        {connectedAccounts.length === 0
          ? 'Connect at least one account in Settings to see live prices + HOLDING highlight'
          : `${heldSymbols.size} held in ${activeAccount} · ${Object.keys(quotes).length} live quotes from Kite`}
      </p>
    </div>
  )
}
