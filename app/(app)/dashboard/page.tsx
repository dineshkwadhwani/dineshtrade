'use client'
import { useState, useEffect } from 'react'

interface MarketData {
  globalIndices: Array<{ name: string; value: string; change: string; direction: string }>
  giftNifty: { value: string; change: string; direction: string; impliedOpen: string; signal: string }
  indiaOutlook: { bias: string; expectedRange: string; keyFactors: string[]; support: string; resistance: string; strategy: string }
  topRecommendations: Array<{ symbol: string; name: string; action: string; source: string; reason: string }>
  headline: string
}

function StatCard({ label, value, sub, color = '#c9a84c', up }: any) {
  return (
    <div className="rounded-xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
      <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>{label}</p>
      <p className="text-xl font-semibold" style={{ color, fontFamily:'JetBrains Mono, monospace' }}>{value}</p>
      {sub && <p className="text-[11px] mt-1" style={{ color:'rgba(255,255,255,0.3)' }}>{sub}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const [market, setMarket] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState('')

  async function fetchMarket() {
    setLoading(true)
    try {
      const res = await fetch('/api/market')
      const json = await res.json()
      // Only render if the payload has the required top-level fields — guards
      // against partial/malformed responses crashing the page.
      const d = json.data
      if (json.success && d?.giftNifty && d?.indiaOutlook && Array.isArray(d?.globalIndices)) {
        setMarket(d)
        setLastUpdated(new Date().toLocaleTimeString('en-IN', { timeZone:'Asia/Kolkata' }))
      }
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { fetchMarket() }, [])

  return (
    <div className="space-y-6 pb-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
            Morning <span className="gold-text">Briefing</span>
          </h1>
          {lastUpdated && <p className="text-[10px] mt-1" style={{ color:'rgba(201,168,76,0.4)', fontFamily:'JetBrains Mono, monospace' }}>Updated {lastUpdated} IST</p>}
        </div>
        <button onClick={fetchMarket} disabled={loading}
          className="px-4 py-2 rounded-lg text-[11px] font-medium tracking-wider transition-all disabled:opacity-40"
          style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.2)', color:'#c9a84c' }}>
          {loading ? '↻ Loading…' : '↻ Refresh'}
        </button>
      </div>

      {loading && !market && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="text-3xl mb-3 animate-spin">↻</div>
            <p className="text-[12px]" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>Fetching live market data…</p>
          </div>
        </div>
      )}

      {market && (
        <>
          {/* Headline */}
          <div className="rounded-xl px-4 py-3" style={{ background:'rgba(201,168,76,0.06)', border:'1px solid rgba(201,168,76,0.12)' }}>
            <p className="text-sm" style={{ color:'rgba(255,255,255,0.7)', fontFamily:'Cormorant Garamond, serif', fontSize:'16px', fontStyle:'italic' }}>
              {market.headline}
            </p>
          </div>

          {/* GIFT Nifty + India Outlook */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl p-4 col-span-2 sm:col-span-1"
              style={{ background: market.giftNifty.direction === 'up' ? 'rgba(82,183,136,0.06)' : 'rgba(224,90,94,0.06)',
                       border: `1px solid ${market.giftNifty.direction === 'up' ? 'rgba(82,183,136,0.2)' : 'rgba(224,90,94,0.2)'}` }}>
              <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>GIFT Nifty</p>
              <p className="text-3xl font-light" style={{ fontFamily:'JetBrains Mono, monospace', color: market.giftNifty.direction === 'up' ? '#52b788' : '#e05a5e' }}>
                {market.giftNifty.value}
              </p>
              <p className="text-sm mt-1" style={{ color: market.giftNifty.direction === 'up' ? '#52b788' : '#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
                {market.giftNifty.direction === 'up' ? '▲' : '▼'} {market.giftNifty.change}
              </p>
              <p className="text-[11px] mt-2" style={{ color:'rgba(255,255,255,0.5)' }}>{market.giftNifty.impliedOpen}</p>
            </div>

            <div className="rounded-xl p-4 col-span-2 sm:col-span-1"
              style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>India Outlook</p>
              <p className="text-lg font-medium mb-1" style={{ color:'#e8c97a', textTransform:'capitalize' }}>{market.indiaOutlook.bias}</p>
              <p className="text-[11px] mb-2" style={{ color:'rgba(255,255,255,0.5)', fontFamily:'JetBrains Mono, monospace' }}>Range: {market.indiaOutlook.expectedRange}</p>
              <div className="flex gap-3 text-[10px]" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                <span style={{ color:'#52b788' }}>S: {market.indiaOutlook.support}</span>
                <span style={{ color:'#e05a5e' }}>R: {market.indiaOutlook.resistance}</span>
              </div>
            </div>
          </div>

          {/* Global Indices */}
          <div>
            <h2 className="text-[11px] tracking-widest uppercase mb-3" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>Global Indices</h2>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {market.globalIndices.map((idx, i) => (
                <div key={i} className="rounded-lg p-3"
                  style={{ background:'rgba(255,255,255,0.03)', border:`1px solid ${idx.direction === 'up' ? 'rgba(82,183,136,0.15)' : idx.direction === 'down' ? 'rgba(224,90,94,0.15)' : 'rgba(255,255,255,0.06)'}` }}>
                  <p className="text-[9px] truncate mb-1" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>{idx.name}</p>
                  <p className="text-[13px] font-medium" style={{ fontFamily:'JetBrains Mono, monospace', color: idx.direction === 'up' ? '#52b788' : idx.direction === 'down' ? '#e05a5e' : 'rgba(255,255,255,0.7)' }}>
                    {idx.direction === 'up' ? '▲' : idx.direction === 'down' ? '▼' : '─'} {idx.change}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{idx.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Strategy */}
          <div className="rounded-xl p-4" style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.1)' }}>
            <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color:'rgba(201,168,76,0.4)', fontFamily:'JetBrains Mono, monospace' }}>Today's Strategy</p>
            <p className="text-sm" style={{ color:'rgba(255,255,255,0.6)' }}>{market.indiaOutlook.strategy}</p>
          </div>

          {/* Top Recommendations */}
          {market.topRecommendations?.length > 0 && (
            <div>
              <h2 className="text-[11px] tracking-widest uppercase mb-3" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>Broker Picks Today</h2>
              <div className="space-y-2">
                {market.topRecommendations.map((rec, i) => (
                  <div key={i} className="rounded-lg px-4 py-3 flex items-center justify-between"
                    style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(82,183,136,0.15)' }}>
                    <div>
                      <span className="text-sm font-semibold text-white" style={{ fontFamily:'JetBrains Mono, monospace' }}>{rec.symbol}</span>
                      <span className="text-[11px] ml-2" style={{ color:'rgba(255,255,255,0.4)' }}>{rec.name}</span>
                      <p className="text-[11px] mt-0.5" style={{ color:'rgba(255,255,255,0.3)' }}>{rec.reason}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] px-2 py-0.5 rounded" style={{ background:'rgba(82,183,136,0.15)', color:'#52b788' }}>{rec.action}</span>
                      <p className="text-[9px] mt-1" style={{ color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace' }}>{rec.source}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
