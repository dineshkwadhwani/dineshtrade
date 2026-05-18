'use client'
import { useState, useEffect } from 'react'
import watchlistData from '@/config/watchlist.json'

interface AccountDisplay { name: string; displayName: string; initials: string; color: string; note: string }

export default function WatchlistPage() {
  const [activeTab, setActiveTab] = useState<'A'|'B'>('A')
  const [search, setSearch] = useState('')
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [activeAccount, setActiveAccount] = useState<string | null>(null)
  const [heldSymbols, setHeldSymbols] = useState<Set<string>>(new Set())
  const [holdingsLoading, setHoldingsLoading] = useState(false)

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
      <div className="flex gap-4 text-[10px] flex-wrap" style={{ color:'rgba(255,255,255,0.3)' }}>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background:`${activeColor}55` }}></span>
          Currently holding{activeAccount ? ` in ${activeAccount}` : ''}
        </span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#52b788]"></span> Positive today (needs paid Kite)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#e05a5e]"></span> Negative today (needs paid Kite)</span>
      </div>

      {/* Stock list */}
      <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.06)' }}>
        <div className="grid grid-cols-[1.2fr_2fr_1fr_1fr] px-4 py-2 text-[9px] tracking-widest uppercase"
          style={{ background:'rgba(255,255,255,0.02)', color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <span>Symbol</span><span>Name</span><span className="text-right">Price</span><span className="text-right">Trades</span>
        </div>
        {filtered.map((s, i) => {
          const held = heldSymbols.has(s.nse.toUpperCase())
          return (
            <div key={s.nse}
              className="grid grid-cols-[1.2fr_2fr_1fr_1fr] px-4 py-3 items-center transition-all hover:bg-white/5"
              style={{
                borderBottom: i < filtered.length-1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                background: held ? `${activeColor}12` : 'transparent',
              }}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-semibold truncate" style={{ fontFamily:'JetBrains Mono, monospace', color:'rgba(255,255,255,0.85)' }}>{s.nse}</span>
                {held && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background:`${activeColor}25`, color: activeColor, border:`1px solid ${activeColor}50` }}>
                    HOLDING
                  </span>
                )}
              </div>
              <span className="text-[11px] truncate" style={{ color:'rgba(255,255,255,0.45)' }}>{s.name}</span>
              <span className="text-right text-sm" style={{ fontFamily:'JetBrains Mono, monospace', color:'rgba(255,255,255,0.3)' }}>—</span>
              <span className="text-right text-[11px]" style={{ color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace' }}>
                {s.trades}
              </span>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-center pb-2" style={{ color:'rgba(255,255,255,0.2)' }}>
        {connectedAccounts.length === 0
          ? 'Connect at least one account in Settings to see the HOLDING highlight'
          : holdingsLoading
          ? 'Loading holdings…'
          : `${heldSymbols.size} held in ${activeAccount}. Live prices unlock with the paid Kite Connect plan.`}
      </p>
    </div>
  )
}
