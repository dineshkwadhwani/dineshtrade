'use client'
import { useEffect, useState } from 'react'

interface SnapshotData {
  portfolioValue: number | null
  investedValue: number | null
  availableFunds: number | null
}

const C = { card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', muted: '#94A3B8' }
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"

function fmtRupees(n: number | null) {
  if (n == null) return '—'
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Tile({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(30,58,138,0.04)' }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px', fontFamily: INTER }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: C.heading, margin: 0, fontFamily: SORA }}>{value}</p>
      {sub && <p style={{ fontSize: 11, fontWeight: 600, color: subColor ?? C.muted, margin: '4px 0 0', fontFamily: INTER }}>{sub}</p>}
    </div>
  )
}

export default function DashboardLiveTiles() {
  const [data, setData] = useState<SnapshotData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dalgo/customer/snapshot', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData({ portfolioValue: null, investedValue: null, availableFunds: null }))
      .finally(() => setLoading(false))
  }, [])

  const pv = loading ? '…' : fmtRupees(data?.portfolioValue ?? null)
  const iv = loading ? '…' : fmtRupees(data?.investedValue ?? null)
  const af = loading ? '…' : fmtRupees(data?.availableFunds ?? null)

  const unrealizedPnl = (data?.portfolioValue != null && data?.investedValue != null)
    ? data.portfolioValue - data.investedValue
    : null
  const pnlStr = unrealizedPnl == null ? undefined
    : `${unrealizedPnl >= 0 ? '+' : ''}₹${Math.abs(unrealizedPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} unrealised`
  const pnlColor = unrealizedPnl == null ? C.muted : unrealizedPnl >= 0 ? '#16A34A' : '#DC2626'

  return (
    <>
      <Tile label="Funds Available" value={af} />
      <Tile label="Invested Value" value={iv} />
      <Tile label="Portfolio Value" value={pv} sub={pnlStr} subColor={pnlColor} />
    </>
  )
}
