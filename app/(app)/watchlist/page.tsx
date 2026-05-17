'use client'
import { useState, useEffect } from 'react'
import watchlistData from '@/config/watchlist.json'

interface StockRow {
  nse: string; name: string; trades: number
  price?: number; change?: number; changePct?: number; holding?: boolean
}

export default function WatchlistPage() {
  const [activeTab, setActiveTab] = useState<'A'|'B'>('A')
  const [stocks, setStocks] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const raw = activeTab === 'A' ? watchlistData.listA : watchlistData.listB

  const filtered = raw.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.nse.toLowerCase().includes(search.toLowerCase())
  )

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

      {/* Tabs */}
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
      <div className="flex gap-4 text-[10px]" style={{ color:'rgba(255,255,255,0.3)' }}>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#52b788]"></span> Positive today</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#e05a5e]"></span> Negative today</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{background:'rgba(201,168,76,0.3)'}}></span> Currently holding</span>
      </div>

      {/* Stock list */}
      <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.06)' }}>
        <div className="grid grid-cols-4 px-4 py-2 text-[9px] tracking-widest uppercase"
          style={{ background:'rgba(255,255,255,0.02)', color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <span>Symbol</span><span>Name</span><span className="text-right">Price</span><span className="text-right">Change</span>
        </div>
        {filtered.map((s, i) => (
          <div key={s.nse}
            className="grid grid-cols-4 px-4 py-3 items-center transition-all hover:bg-white/5"
            style={{
              borderBottom: i < filtered.length-1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              background: s.trades > 50 ? 'rgba(201,168,76,0.03)' : 'transparent',
            }}>
            <div>
              <span className="text-sm font-semibold" style={{ fontFamily:'JetBrains Mono, monospace', color:'rgba(255,255,255,0.85)' }}>{s.nse}</span>
              {s.trades > 50 && <span className="ml-1.5 text-[8px] px-1.5 py-0.5 rounded" style={{ background:'rgba(201,168,76,0.15)', color:'#c9a84c' }}>CORE</span>}
            </div>
            <span className="text-[11px]" style={{ color:'rgba(255,255,255,0.45)' }}>{s.name}</span>
            <span className="text-right text-sm" style={{ fontFamily:'JetBrains Mono, monospace', color:'rgba(255,255,255,0.6)' }}>—</span>
            <span className="text-right text-[11px]" style={{ color:'rgba(255,255,255,0.2)', fontFamily:'JetBrains Mono, monospace' }}>
              {s.trades} trades
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-center pb-2" style={{ color:'rgba(255,255,255,0.2)' }}>
        Live prices load when Zerodha is connected in Settings · Stocks in blue background are currently held
      </p>
    </div>
  )
}
