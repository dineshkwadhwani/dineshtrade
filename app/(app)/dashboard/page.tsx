'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

interface MarketData {
  globalIndices: Array<{ name: string; value: string; change: string; direction: string }>
  giftNifty: { value: string; change: string; direction: string; impliedOpen: string; signal: string }
  indiaOutlook: { bias: string; expectedRange: string; keyFactors: string[]; support: string; resistance: string; strategy: string }
  topRecommendations: Array<{ symbol: string; name: string; action: string; source: string; reason: string }>
  headline: string
}

interface AccountDisplay { name: string; displayName: string; initials: string; color: string; note: string }

function fmtPnl(v: number): string {
  const abs = Math.round(Math.abs(v)).toLocaleString('en-IN')
  return v >= 0 ? `+₹${abs}` : `-₹${abs}`
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

// localStorage key — scoped to today's IST date so it auto-rotates daily.
function todayISTKey(): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const y = ist.getFullYear()
  const m = String(ist.getMonth() + 1).padStart(2, '0')
  const d = String(ist.getDate()).padStart(2, '0')
  return `dineshtrade:dailyReport:${y}-${m}-${d}`
}

// Clear any older daily-report keys (yesterday and earlier) on the side.
function pruneOldCache(currentKey: string) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith('dineshtrade:dailyReport:') && k !== currentKey) {
        localStorage.removeItem(k)
      }
    }
  } catch {}
}

export default function DashboardPage() {
  const [market, setMarket] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState('')
  const [fromCache, setFromCache] = useState(false)

  async function fetchMarket(opts: { force?: boolean } = {}) {
    const cacheKey = todayISTKey()

    // Cache check — unless caller forced a fresh fetch
    if (!opts.force) {
      try {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const parsed = JSON.parse(cached)
          if (parsed?.data?.giftNifty && parsed?.data?.indiaOutlook) {
            setMarket(parsed.data)
            setLastUpdated(parsed.generatedAt
              ? new Date(parsed.generatedAt).toLocaleTimeString('en-IN', { timeZone:'Asia/Kolkata' })
              : 'cached')
            setFromCache(true)
            setLoading(false)
            return
          }
        }
      } catch {}
    }

    setLoading(true)
    setFromCache(false)
    try {
      const res = await fetch('/api/market')
      const json = await res.json()
      const d = json.data
      if (json.success && d?.giftNifty && d?.indiaOutlook && Array.isArray(d?.globalIndices)) {
        setMarket(d)
        setLastUpdated(new Date().toLocaleTimeString('en-IN', { timeZone:'Asia/Kolkata' }))
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ data: d, generatedAt: json.generatedAt || new Date().toISOString() }))
          pruneOldCache(cacheKey)
        } catch {}
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
          {lastUpdated && (
            <p className="text-[10px] mt-1" style={{ color:'rgba(201,168,76,0.4)', fontFamily:'JetBrains Mono, monospace' }}>
              Updated {lastUpdated} IST{fromCache ? ' · cached' : ''}
            </p>
          )}
        </div>
        <button onClick={() => fetchMarket({ force: true })} disabled={loading}
          className="px-4 py-2 rounded-lg text-[11px] font-medium tracking-wider transition-all disabled:opacity-40"
          style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.2)', color:'#c9a84c' }}>
          {loading ? '↻ Loading…' : '↻ Refresh'}
        </button>
      </div>

      <AccountSummary />

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
          <h2 className="text-[11px] tracking-widest uppercase pt-2"
            style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
            Morning Briefing
          </h2>
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

function AccountSummary() {
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [margins, setMargins] = useState<any>(null)
  const [holdings, setHoldings] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/state').then(r => r.json()),
    ]).then(([a, s]) => {
      setAccounts(a.accounts || [])
      const conn: string[] = s.accountsWithToken || []
      setConnected(conn)
      if (conn.length > 0) setActive(conn[0])
    }).catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    if (!active) { setMargins(null); setHoldings([]); return }
    setLoading(true)
    Promise.all([
      fetch(`/api/zerodha?account=${encodeURIComponent(active)}&action=margins`).then(r => r.json()),
      fetch(`/api/zerodha?account=${encodeURIComponent(active)}&action=holdings`).then(r => r.json()),
    ]).then(([m, h]) => {
      setMargins(m?.data || null)
      setHoldings(Array.isArray(h?.data) ? h.data : [])
    }).catch(() => {})
      .finally(() => setLoading(false))
  }, [active])

  const connectedAccounts = accounts.filter(a => connected.includes(a.name))
  const activeAcc = accounts.find(a => a.name === active)

  if (!loaded || connectedAccounts.length === 0) return null

  const available = margins?.equity?.available?.live_balance ?? margins?.equity?.available?.cash ?? null
  // Kite splits long qty across `quantity` (T+1 settled) and `t1_quantity`
  // (bought today, still settling). Sum both to reflect the actual long position.
  const totals = holdings.reduce((acc, h: any) => {
    const q = (h.quantity || 0) + (h.t1_quantity || 0)
    acc.invested += (h.average_price || 0) * q
    acc.pnl      += (h.pnl || 0)
    acc.dayPnl   += (h.day_change || 0) * q
    return acc
  }, { invested:0, pnl:0, dayPnl:0 })

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-[11px] tracking-widest uppercase"
          style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
          Portfolio Snapshot
        </h2>
        {connectedAccounts.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {connectedAccounts.map(acc => {
              const isActive = active === acc.name
              return (
                <button key={acc.name} onClick={() => setActive(acc.name)}
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
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Available Funds"
          value={available !== null ? `₹${Math.round(available).toLocaleString('en-IN')}` : (loading ? '…' : '—')}
          color={activeAcc?.color || '#c9a84c'} />
        <StatCard
          label="Invested"
          value={holdings.length > 0 ? `₹${Math.round(totals.invested).toLocaleString('en-IN')}` : (loading ? '…' : '—')} />
        <StatCard
          label="Today's P&L"
          value={holdings.length > 0 ? fmtPnl(totals.dayPnl) : (loading ? '…' : '—')}
          color={holdings.length > 0 ? (totals.dayPnl >= 0 ? '#52b788' : '#e05a5e') : '#c9a84c'} />
        <StatCard
          label="Overall P&L"
          value={holdings.length > 0 ? fmtPnl(totals.pnl) : (loading ? '…' : '—')}
          color={holdings.length > 0 ? (totals.pnl >= 0 ? '#52b788' : '#e05a5e') : '#c9a84c'} />
      </div>

      <Link href="/holdings" className="inline-block text-[11px] mt-1 hover:underline"
        style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
        View all holdings →
      </Link>
    </div>
  )
}
