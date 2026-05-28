'use client'
import { useEffect, useRef, useState } from 'react'

interface CapitalSnapshot {
  account: string
  available: number
  reserve: number
  maxDeployable: number
  deployed: number
  remaining: number
  liveCapital: number
  reconciliationBase: number | null
  explainedCapital: number | null
  reconciliationResidual: number | null
  netRealizedPnl: number
  liveUnrealizedPnl: number
  livePnl: number
  maxDeployPct: number
  fetchedAt: string
}

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
  const fmtSigned = (n: number) => `${n >= 0 ? '+' : '-'}₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`
  const dep = snap ? (snap.maxDeployable > 0 ? (snap.deployed / snap.maxDeployable) * 100 : 0) : 0

  // Tooltip content for Live Capital — shows the hidden reconciliation detail
  const liveCapitalTooltip = snap && snap.reconciliationBase !== null
    ? `Funded base ₹${Math.round(snap.reconciliationBase).toLocaleString('en-IN')} · Ledger adj ${snap.reconciliationResidual !== null ? fmtSigned(snap.reconciliationResidual) : '—'}`
    : undefined

  return (
    <div className="rounded-xl overflow-hidden" style={{ background:'rgba(201,168,76,0.04)', border:'1px solid var(--dt-border-gold)' }}>
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center justify-between"
        style={{ background:'rgba(201,168,76,0.06)', borderBottom:'1px solid rgba(201,168,76,0.12)' }}>
        <p className="text-[10px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
          Capital · {account}
          {snap && (
            <span className="ml-2" style={{ color:'var(--dt-text-muted)' }}>
              · {snap.maxDeployPct}% deployable · {100 - snap.maxDeployPct}% reserve
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          {snap?.fetchedAt && (
            <span className="text-[9px]" style={{ color:'var(--dt-text-muted)', fontFamily:'JetBrains Mono, monospace' }}>
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

      {error && <p className="text-[11px] px-4 py-2" style={{ color:'rgba(224,90,94,0.85)' }}>✗ {error}</p>}

      {/* Row 1 — Cash position */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background:'var(--dt-border)' }}>
        <Cell label="Available" value={snap ? fmt(snap.available) : '—'} sub="from Kite" color="#c9a84c" />
        <Cell label="Deployed" value={snap ? fmt(snap.deployed) : '—'}
          sub={snap ? `${dep.toFixed(0)}% of cap` : ''}
          color={dep > 90 ? '#e05a5e' : dep > 75 ? '#f59e0b' : '#52b788'} />
        <Cell label="Reserve" value={snap ? fmt(snap.reserve) : '—'} sub={snap ? `${100 - snap.maxDeployPct}% buffer` : ''} color="var(--dt-text-primary)" />
        <Cell label="Remaining" value={snap ? fmt(snap.remaining) : '—'} sub="for new entries" color={snap && snap.remaining > 0 ? '#52b788' : 'var(--dt-text-muted)'} />
      </div>

      {/* Divider */}
      <div style={{ height:1, background:'var(--dt-border)' }} />

      {/* Row 2 — P&L */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background:'var(--dt-border)' }}>
        <Cell label="Realized P&L" value={snap ? fmtSigned(snap.netRealizedPnl) : '—'} sub="net of charges" color={snap && snap.netRealizedPnl >= 0 ? '#52b788' : '#e05a5e'} />
        <Cell label="Unrealized MTM" value={snap ? fmtSigned(snap.liveUnrealizedPnl) : '—'} sub="open holdings" color={snap && snap.liveUnrealizedPnl >= 0 ? '#52b788' : '#e05a5e'} />
        <Cell label="Net MTM" value={snap ? fmtSigned(snap.livePnl) : '—'} sub="realized + unrealized" color={snap && snap.livePnl >= 0 ? '#52b788' : '#e05a5e'} />
        <Cell label="Live Capital" value={snap ? fmt(snap.liveCapital) : '—'} sub="available + deployed" color="var(--dt-text-primary)" tooltip={liveCapitalTooltip} />
      </div>
    </div>
  )
}

function Cell({ label, value, sub, color, tooltip }: {
  label: string; value: string; sub?: string; color: string; tooltip?: string
}) {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  return (
    <div ref={ref} className="p-3 relative" style={{ background:'#100e0a' }}
      onMouseEnter={() => tooltip && setShow(true)}
      onMouseLeave={() => setShow(false)}>
      <p className="text-[9px] tracking-widest uppercase mb-1"
        style={{ color:'var(--dt-text-muted)', fontFamily:'JetBrains Mono, monospace' }}>
        {label}
      </p>
      <p style={{ color, fontFamily:'JetBrains Mono, monospace', fontSize: 18, fontWeight: 600 }}>{value}</p>
      {sub && (
        <p className="text-[9px] mt-0.5" style={{ color:'var(--dt-text-muted)', fontFamily:'JetBrains Mono, monospace' }}>
          {sub}
        </p>
      )}
      {tooltip && show && (
        <div className="absolute bottom-full left-0 mb-1 z-20 px-2.5 py-1.5 rounded-md text-[10px] whitespace-nowrap pointer-events-none"
          style={{ background:'#1a1610', border:'1px solid rgba(201,168,76,0.25)', color:'var(--dt-text-secondary)', fontFamily:'JetBrains Mono, monospace' }}>
          {tooltip}
        </div>
      )}
    </div>
  )
}
