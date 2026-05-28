'use client'
import { useEffect, useState } from 'react'

interface MarginsResponse {
  equity?: {
    net?: number
    available?: { cash?: number; live_balance?: number; opening_balance?: number }
    utilised?: { debits?: number }
  }
}

// Reusable "Available Funds" card. Fetches on mount + when the user clicks
// Refresh — no auto-poll (per user preference). The `compact` prop renders
// it as a single horizontal row for top-of-page placement.
export default function FundsCard({ account, compact = false }: { account: string | null; compact?: boolean }) {
  const [margins, setMargins] = useState<MarginsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetchedAt, setFetchedAt] = useState<string>('')

  async function load() {
    if (!account) return
    setLoading(true); setError('')
    try {
      const r = await fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=margins&_t=${Date.now()}`, { cache: 'no-store' })
      const d = await r.json()
      if (r.ok) {
        setMargins(d.data || null)
        setFetchedAt(new Date().toISOString())
      } else {
        setError(d?.error || `HTTP ${r.status}`)
      }
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  if (!account) return null

  const available = margins?.equity?.available?.live_balance ?? margins?.equity?.available?.cash ?? null
  const used = margins?.equity?.utilised?.debits ?? null
  const net = margins?.equity?.net ?? null
  const fmt = (n: number | null) => n === null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`

  return (
    <div className="dt-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-[11px] tracking-widest uppercase"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Funds · {account}
        </p>
        <div className="flex items-center gap-2">
          {fetchedAt && (
            <span className="dt-text-muted text-[9px]" style={{ fontFamily:'JetBrains Mono, monospace' }}>
              fetched {new Date(fetchedAt).toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' })}
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
        <p className="text-[11px] mb-2" style={{ color:'rgba(224,90,94,0.85)' }}>✗ {error}</p>
      )}

      <div className={compact ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-1 sm:grid-cols-3 gap-3'}>
        <FundCell label="Available" value={fmt(available)} accent="#c9a84c" big />
        <FundCell label="Used margin" value={fmt(used)} accent="rgba(255,255,255,0.7)" />
        <FundCell label="Net equity" value={fmt(net)} accent="rgba(255,255,255,0.7)" />
      </div>
    </div>
  )
}

function FundCell({ label, value, accent, big }: { label: string; value: string; accent: string; big?: boolean }) {
  return (
    <div className="dt-card-inner rounded-lg p-3">
      <p className="dt-text-muted text-[9px] tracking-widest uppercase mb-1" style={{ fontFamily:'JetBrains Mono, monospace' }}>{label}</p>
      <p style={{ color: accent, fontFamily:'JetBrains Mono, monospace', fontSize: big ? 22 : 16, fontWeight: 600 }}>{value}</p>
    </div>
  )
}
