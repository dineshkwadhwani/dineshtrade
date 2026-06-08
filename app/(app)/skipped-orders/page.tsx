'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DailyReport, EnrichedMissed } from '@/lib/retrospective'

interface AccountDisplay {
  name: string
  displayName: string
}

export default function SkippedOrdersPage() {
  const [dates, setDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [accountFilter, setAccountFilter] = useState('')
  const [report, setReport] = useState<DailyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/journal/dates').then(r => r.json()).catch(() => ({ dates: [] })),
      fetch('/api/accounts').then(r => r.json()).catch(() => ({ accounts: [] })),
    ]).then(([datesData, accountsData]) => {
      const nextDates = Array.isArray(datesData.dates) ? datesData.dates : []
      setDates(nextDates)
      setSelectedDate(nextDates[0] || '')
      setAccounts(Array.isArray(accountsData.accounts) ? accountsData.accounts : [])
    }).catch(() => setError('Failed to load skipped-order filters'))
  }, [])

  useEffect(() => {
    if (!selectedDate) return
    setLoading(true)
    setError('')
    fetch(`/api/journal/${selectedDate}`).then(r => r.json()).then(data => {
      if (data.error) {
        setReport(null)
        setError(data.error)
        return
      }
      setReport(data.report || null)
    }).catch(() => {
      setReport(null)
      setError('Failed to load skipped-order report')
    }).finally(() => setLoading(false))
  }, [selectedDate])

  const skipped = useMemo(() => {
    const base = report?.missedSignals || []
    return accountFilter ? base.filter(item => item.account === accountFilter) : base
  }, [report, accountFilter])

  const summary = useMemo(() => {
    return Object.values(skipped.reduce<Record<string, { reason: string; count: number }>>((acc, item) => {
      const key = item.reasonSkipped.trim() || 'Unknown reason'
      if (!acc[key]) acc[key] = { reason: key, count: 0 }
      acc[key].count += item.count || 1
      return acc
    }, {})).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
  }, [skipped])

  return (
    <div className="space-y-5 pb-4 max-w-7xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-light dt-text-primary" style={{ fontFamily:'Cormorant Garamond, serif' }}>
          <span className="gold-text">Skipped Orders</span>
        </h1>
      </div>

      <div className="rounded-xl p-5 dt-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[11px] tracking-widest uppercase mb-2" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
              Auto-BUY Skip Report
            </h2>
            <p className="text-[12px] max-w-3xl dt-text-muted">
              This page shows strategy signals that reached the auto-BUY path but were blocked before the order was sent to Zerodha. Reasons come directly from the journaled skip record.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color:'rgba(201,168,76,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
              Date
            </label>
            <select
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-[12px] outline-none"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              {dates.map(date => (
                <option key={date} value={date}>{date}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color:'rgba(201,168,76,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
              Account
            </label>
            <select
              value={accountFilter}
              onChange={e => setAccountFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-[12px] outline-none"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              <option value="">All accounts</option>
              {accounts.map(account => (
                <option key={account.name} value={account.name}>{account.displayName || account.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading && <p className="text-[11px] dt-text-muted">Loading skipped orders…</p>}

      {error && (
        <div className="rounded-lg p-3" style={{ background:'rgba(224,90,94,0.06)', border:'1px solid rgba(224,90,94,0.25)' }}>
          <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)' }}>✗ {error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MiniStat label="Skipped Signals" value={String(skipped.length)} color="#f59e0b" sub="deduped by symbol" />
        <MiniStat label="Reasons" value={String(summary.length)} color="#60a5fa" sub="unique skip causes" />
        <MiniStat label="Date" value={report?.displayDate || '—'} color="rgba(255,255,255,0.82)" sub={accountFilter || 'all accounts'} />
      </div>

      {summary.length > 0 && (
        <div className="rounded-xl overflow-hidden dt-card">
          <div className="px-4 py-2.5 dt-border-b flex items-center justify-between gap-3">
            <p className="text-[11px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              Reason Summary
            </p>
            <p className="text-[10px] dt-text-muted">Grouped by skip reason</p>
          </div>
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[9px] tracking-widest uppercase dt-table-head" style={{ fontFamily:'JetBrains Mono, monospace' }}>
            <span className="col-span-9">Reason</span>
            <span className="col-span-3 text-right">Count</span>
          </div>
          {summary.map(item => (
            <div key={item.reason} className="grid grid-cols-12 gap-2 px-4 py-3 text-[12px] dt-table-row">
              <span className="col-span-9 dt-text-primary">{item.reason}</span>
              <span className="col-span-3 text-right" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>{item.count}</span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl overflow-hidden dt-card">
        <div className="px-4 py-2.5 dt-border-b flex items-center justify-between gap-3">
          <p className="text-[11px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
            Skipped Orders ({skipped.length})
          </p>
          <p className="text-[10px] dt-text-muted">Auto-BUY recommendations blocked before broker placement</p>
        </div>
        {skipped.length > 0 ? (
          <>
            <div className="grid grid-cols-12 px-4 py-2.5 text-[9px] tracking-widest uppercase dt-table-head" style={{ fontFamily:'JetBrains Mono, monospace' }}>
              <span className="col-span-2">Time</span>
              <span className="col-span-2">Account</span>
              <span className="col-span-2">Symbol</span>
              <span className="col-span-4">Reason</span>
              <span className="col-span-2 text-right">Outcome</span>
            </div>
            {skipped.map((item, index) => <SkippedRow key={`${item.account}:${item.symbol}:${item.firstTime}:${index}`} item={item} />)}
          </>
        ) : (
          <div className="px-4 py-5 text-[12px] dt-text-muted">
            No skipped auto-BUY orders were journaled for the selected filters.
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div className="rounded-xl p-4 dt-card-gold">
      <p className="text-[9px] tracking-widest uppercase mb-2 dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>{label}</p>
      <p className="text-xl font-semibold" style={{ color, fontFamily:'JetBrains Mono, monospace' }}>{value}</p>
      <p className="text-[9px] mt-1 dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>{sub}</p>
    </div>
  )
}

function SkippedRow({ item }: { item: EnrichedMissed }) {
  const outcomeColor = item.outcome === 'missed_opportunity' ? '#f59e0b' : item.outcome === 'good_miss' ? '#52b788' : 'rgba(255,255,255,0.55)'
  const outcomeLabel = item.outcome === 'missed_opportunity' ? 'MISSED OPPORTUNITY' : item.outcome === 'good_miss' ? 'GOOD MISS' : 'UNKNOWN'
  const accountLabel = item.account.length > 14 ? `${item.account.slice(0, 12)}…` : item.account
  return (
    <div className="grid grid-cols-12 px-4 py-3 items-start text-[11px] dt-table-row" style={{ fontFamily:'JetBrains Mono, monospace' }}>
      <span className="col-span-2 dt-text-secondary">
        {item.count > 1 ? (
          <>
            <div>{item.firstTime}–{item.lastTime}</div>
            <div className="text-[9px] mt-0.5 dt-text-muted">×{item.count} times</div>
          </>
        ) : item.firstTime}
      </span>
      <span className="col-span-2 dt-text-secondary">{accountLabel}</span>
      <span className="col-span-2 font-semibold dt-text-primary">{item.symbol}</span>
      <span className="col-span-4 text-[10px] dt-text-secondary">{item.reasonSkipped}</span>
      <span className="col-span-2 text-right">
        <span className="px-2 py-1 rounded text-[8px] font-semibold tracking-widest" style={{ background:`${outcomeColor}22`, color:outcomeColor, border:`1px solid ${outcomeColor}66` }}>
          {outcomeLabel}
        </span>
      </span>
    </div>
  )
}