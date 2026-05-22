'use client'
import { useEffect, useState } from 'react'

interface CapitalSnapshot {
  account: string
  available: number
  reserve: number
  maxDeployable: number
  deployed: number
  remaining: number
  maxDeployPct: number
  fetchedAt: string
}

// Header bar for the Trading Engine page: Available · Deployed · Reserve ·
// Remaining deployable. Fetches on mount + when the user clicks Refresh. The
// 'Reserve' cell is the `100 − maxDeployPct`% buffer that Auto mode will
// never deploy (default 20%).
export default function CapitalBar({ account }: { account: string | null }) {
  const [snap, setSnap] = useState<CapitalSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    if (!account) return
    setLoading(true); setError('')
    try {
      const r = await fetch(`/api/capital?account=${encodeURIComponent(account)}&_t=${Date.now()}`, { cache: 'no-store' })
      const d = await r.json()
      if (r.ok) setSnap(d)
      else setError(d?.error || `HTTP ${r.status}`)
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  if (!account) return null

  const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
  const dep = snap ? (snap.maxDeployable > 0 ? (snap.deployed / snap.maxDeployable) * 100 : 0) : 0

  return (
    <div className="rounded-xl overflow-hidden" style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.18)' }}>
      <div className="px-4 py-2.5 flex items-center justify-between"
        style={{ background:'rgba(201,168,76,0.06)', borderBottom:'1px solid rgba(201,168,76,0.12)' }}>
        <p className="text-[10px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
          Capital · {account}
          {snap && <span className="ml-2" style={{ color:'rgba(255,255,255,0.4)' }}>
            · {snap.maxDeployPct}% deployable cap · {(100 - snap.maxDeployPct)}% reserve
          </span>}
        </p>
        <div className="flex items-center gap-2">
          {snap?.fetchedAt && (
            <span className="text-[9px]" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>
              fetched {new Date(snap.fetchedAt).toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' })}
            </span>
          )}
          <button onClick={load} disabled={loading}
            className="px-2.5 py-1 rounded-md text-[10px] font-medium transition-all"
            style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c' }}>
            {loading ? '↻' : '↻ Refresh'}
          </button>
        </div>
      </div>
      {error && (
        <p className="text-[11px] px-4 py-2" style={{ color:'rgba(224,90,94,0.85)' }}>✗ {error}</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background:'rgba(255,255,255,0.04)' }}>
        <Cell label="Available" value={snap ? fmt(snap.available) : '—'} sub="from Kite" color="#c9a84c" />
        <Cell label="Overall Deployed" value={snap ? fmt(snap.deployed) : '—'}
          sub={snap ? `${dep.toFixed(0)}% of cap` : ''}
          color={dep > 90 ? '#e05a5e' : dep > 75 ? '#f59e0b' : '#52b788'} />
        <Cell label="Reserve" value={snap ? fmt(snap.reserve) : '—'} sub={snap ? `${(100 - snap.maxDeployPct)}% buffer` : ''} color="rgba(255,255,255,0.6)" />
        <Cell label="Remaining deployable" value={snap ? fmt(snap.remaining) : '—'} sub="for new entries" color={snap && snap.remaining > 0 ? '#52b788' : 'rgba(255,255,255,0.4)'} />
      </div>
    </div>
  )
}

function Cell({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="p-3" style={{ background:'#100e0a' }}>
      <p className="text-[9px] tracking-widest uppercase mb-1" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{label}</p>
      <p style={{ color, fontFamily:'JetBrains Mono, monospace', fontSize: 18, fontWeight: 600 }}>{value}</p>
      {sub && <p className="text-[9px] mt-0.5" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>{sub}</p>}
    </div>
  )
}
