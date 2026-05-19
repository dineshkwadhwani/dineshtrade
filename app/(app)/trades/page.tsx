'use client'
import { useEffect, useState } from 'react'
import type { DailyReport, EnrichedTrade, EnrichedMissed } from '@/lib/retrospective'
import FundsCard from '@/components/FundsCard'

interface AccountDisplay { name: string; displayName: string; initials: string; color: string; note: string }

interface Order {
  order_id: string
  tradingsymbol: string
  transaction_type: string
  quantity: number
  filled_quantity?: number
  average_price: number
  status: string
  order_timestamp?: string
  product: string
  exchange?: string
  status_message?: string
}

type View = 'orders' | 'retro'

export default function TradesPage() {
  const [view, setView] = useState<View>('orders')

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
          {view === 'orders'
            ? <>Today's <span className="gold-text">Orders</span></>
            : <span className="gold-text">Retrospective</span>}
        </h1>
        <div className="flex gap-1 rounded-lg p-1" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
          {[
            { id:'orders' as View, label:"Today's Orders" },
            { id:'retro'  as View, label:'Retrospective' },
          ].map(t => {
            const active = view === t.id
            return (
              <button key={t.id} onClick={() => setView(t.id)}
                className="px-4 py-1.5 rounded-md text-[11px] transition-all"
                style={{
                  background: active ? 'rgba(201,168,76,0.12)' : 'transparent',
                  border: active ? '1px solid rgba(201,168,76,0.3)' : '1px solid transparent',
                  color: active ? '#c9a84c' : 'rgba(255,255,255,0.5)',
                  fontFamily:'JetBrains Mono, monospace',
                }}>
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {view === 'orders' ? <OrdersView /> : <RetrospectiveView />}
    </div>
  )
}

// ─────────────────────────── Today's Orders ───────────────────────────

function OrdersView() {
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/state').then(r => r.json()),
    ]).then(([a, s]) => {
      setAccounts(a.accounts || [])
      const conn: string[] = s.accountsWithToken || []
      setConnected(conn)
      if (conn.length > 0) setActiveTab(conn[0])
    }).catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  async function load(account: string) {
    setLoading(true)
    setError('')
    setOrders([])
    try {
      const res = await fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=orders`).then(r => r.json())
      if (res.error) setError(res.error)
      else if (Array.isArray(res.data)) setOrders(res.data)
    } catch {
      setError('Failed to load orders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab) load(activeTab)
  }, [activeTab])

  const buys  = orders.filter(o => o.transaction_type === 'BUY')
  const sells = orders.filter(o => o.transaction_type === 'SELL')
  const totalBuyValue  = buys.reduce((s, o) => s + (o.average_price * (o.filled_quantity ?? o.quantity)), 0)
  const totalSellValue = sells.reduce((s, o) => s + (o.average_price * (o.filled_quantity ?? o.quantity)), 0)
  const dayPnL = totalSellValue - totalBuyValue

  const activeAccount = accounts.find(a => a.name === activeTab)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        {activeTab && (
          <button onClick={() => load(activeTab)} disabled={loading}
            className="px-4 py-2 rounded-lg text-[11px] font-medium transition-all"
            style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.2)', color:'#c9a84c' }}>
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        )}
      </div>

      <AccountTabs accounts={accounts} connected={connected} active={activeTab} onSelect={setActiveTab} loaded={loaded} />

      {activeTab && <FundsCard account={activeTab} />}

      {loaded && connected.length === 0 && (
        <div className="rounded-xl p-6 text-center"
          style={{ background:'rgba(201,168,76,0.05)', border:'1px solid rgba(201,168,76,0.15)' }}>
          <p className="text-4xl mb-3 opacity-20">⚙</p>
          <p className="text-sm mb-1" style={{ color:'rgba(201,168,76,0.7)' }}>No accounts connected</p>
          <p className="text-[12px]" style={{ color:'rgba(255,255,255,0.4)' }}>Go to Settings, paste today's Kite access token, and Connect.</p>
        </div>
      )}

      {activeTab && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label:'Buys Today',  val: buys.length, color:'#52b788' },
              { label:'Sells Today', val: sells.length, color:'#e05a5e' },
              { label:'Capital Used', val:`₹${Math.round(totalBuyValue).toLocaleString('en-IN')}`, color: activeAccount?.color || '#c9a84c' },
              { label:"Day P&L", val: dayPnL >= 0 ? `+₹${Math.round(dayPnL).toLocaleString('en-IN')}` : `-₹${Math.round(Math.abs(dayPnL)).toLocaleString('en-IN')}`, color: dayPnL >= 0 ? '#52b788' : '#e05a5e' },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{s.label}</p>
                <p className="text-xl font-semibold" style={{ color:s.color, fontFamily:'JetBrains Mono, monospace' }}>{s.val}</p>
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-xl p-4" style={{ background:'rgba(224,90,94,0.05)', border:'1px solid rgba(224,90,94,0.2)' }}>
              <p className="text-sm" style={{ color:'rgba(224,90,94,0.85)' }}>✗ {error}</p>
            </div>
          )}

          {orders.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="grid grid-cols-6 px-4 py-2 text-[9px] tracking-widest uppercase"
                style={{ background:'rgba(255,255,255,0.02)', color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                <span>Time</span>
                <span>Symbol</span>
                <span>Type</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Price</span>
                <span className="text-right">Status</span>
              </div>
              {orders.map((o, i) => (
                <div key={o.order_id}
                  className="grid grid-cols-6 px-4 py-3 items-center text-[12px] transition-all hover:bg-white/5"
                  style={{ borderBottom: i < orders.length-1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <span className="text-white/40 text-[10px]" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                    {fmtTime(o.order_timestamp)}
                  </span>
                  <span className="font-semibold text-white/80" style={{ fontFamily:'JetBrains Mono, monospace' }}>{o.tradingsymbol}</span>
                  <span className="font-medium" style={{ color: o.transaction_type === 'BUY' ? '#52b788' : '#e05a5e' }}>
                    {o.transaction_type === 'BUY' ? '▲ BUY' : '▼ SELL'}
                  </span>
                  <span className="text-right text-white/60" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                    {o.filled_quantity ?? o.quantity}{o.filled_quantity !== undefined && o.filled_quantity !== o.quantity ? `/${o.quantity}` : ''}
                  </span>
                  <span className="text-right text-white/60" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                    {o.average_price ? `₹${o.average_price.toFixed(2)}` : '—'}
                  </span>
                  <span className="text-right text-[10px]" style={{ color: statusColor(o.status), fontFamily:'JetBrains Mono, monospace' }}>
                    {o.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && orders.length === 0 && (
            <div className="text-center py-16">
              <p className="text-4xl mb-3 opacity-20">≡</p>
              <p className="text-base" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.35)', fontSize:'18px' }}>No orders today</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────── Retrospective ───────────────────────────

function RetrospectiveView() {
  const [dates, setDates] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [report, setReport] = useState<DailyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/journal/dates').then(r => r.json()).then(r => {
      const ds: string[] = r.dates || []
      setDates(ds)
      if (ds.length > 0) setSelected(ds[0])
    }).catch(() => setError('Failed to load journal dates'))
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true); setError(''); setReport(null)
    fetch(`/api/journal/${selected}`).then(r => r.json()).then(r => {
      if (r.error) setError(r.error)
      else setReport(r.report)
    }).catch(() => setError('Failed to load report'))
      .finally(() => setLoading(false))
  }, [selected])

  if (dates.length === 0 && !error) {
    return (
      <div className="rounded-xl p-6 text-center"
        style={{ background:'rgba(201,168,76,0.05)', border:'1px solid rgba(201,168,76,0.15)' }}>
        <p className="text-4xl mb-3 opacity-20">≡</p>
        <p className="text-sm mb-1" style={{ color:'rgba(201,168,76,0.7)' }}>No journal entries yet</p>
        <p className="text-[12px]" style={{ color:'rgba(255,255,255,0.4)' }}>
          Once Auto mode runs (or a manual trade closes), the day will appear here at 15:35 IST.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>
          Date
        </span>
        <select value={selected || ''} onChange={e => setSelected(e.target.value)}
          className="px-3 py-2 rounded-lg text-[12px]"
          style={{
            background:'rgba(255,255,255,0.03)', border:'1px solid rgba(201,168,76,0.25)',
            color:'#c9a84c', fontFamily:'JetBrains Mono, monospace',
          }}>
          {dates.map(d => <option key={d} value={d} style={{ background:'#100e0a', color:'#c9a84c' }}>{d}</option>)}
        </select>
        {loading && <span className="text-[10px]" style={{ color:'rgba(255,255,255,0.3)' }}>↻ Loading…</span>}
      </div>

      {error && (
        <div className="rounded-xl p-4" style={{ background:'rgba(224,90,94,0.05)', border:'1px solid rgba(224,90,94,0.2)' }}>
          <p className="text-sm" style={{ color:'rgba(224,90,94,0.85)' }}>✗ {error}</p>
        </div>
      )}

      {report && <ReportBody r={report} />}
    </div>
  )
}

function ReportBody({ r }: { r: DailyReport }) {
  const pnlColor = r.totalPnl >= 0 ? '#52b788' : '#e05a5e'
  const winRate = r.tradesCount > 0 ? `${Math.round(100 * r.wins / r.tradesCount)}%` : '—'
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
          {r.displayDate}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Trades" value={String(r.tradesCount)} color="#c9a84c" />
        <StatCard label="Win Rate" value={winRate} color="#c9a84c" />
        <StatCard label="Total P&L" value={signedRupees(r.totalPnl)} color={pnlColor} />
        <StatCard label="Capital" value={`₹${Math.round(r.capitalDeployed).toLocaleString('en-IN')}`} color="#c9a84c" />
      </div>

      {r.trades.length > 0 && (
        <Section title={`Trade-by-trade (${r.trades.length})`}>
          <div className="space-y-3">
            {r.trades.map((t, i) => <TradeCard key={i} t={t} />)}
          </div>
        </Section>
      )}

      {r.missedSignals.length > 0 && (
        <Section title={`Missed signals (${r.missedSignals.length})`}>
          <div className="rounded-xl overflow-hidden" style={{ background:'#100e0a', border:'1px solid rgba(255,255,255,0.08)' }}>
            <div className="grid grid-cols-12 px-4 py-2.5 text-[9px] tracking-widest uppercase"
              style={{ background:'rgba(255,255,255,0.02)', color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
              <span className="col-span-2">Time</span>
              <span className="col-span-2">Symbol</span>
              <span className="col-span-5">Reason</span>
              <span className="col-span-3 text-right">Outcome</span>
            </div>
            {r.missedSignals.map((m, i) => <MissedRow key={i} m={m} />)}
          </div>
        </Section>
      )}

      <Section title={`Strategy health (30-day rolling${r.rolling30.sampleSize > 0 ? `, n=${r.rolling30.sampleSize}` : ''})`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Win Rate (target 70%)"
            value={r.rolling30.winRate === null ? '—' : `${r.rolling30.winRate.toFixed(0)}%`}
            color={rateColor(r.rolling30.winRate, 70, 50)} />
          <StatCard label="Avg Gain/Trade"
            value={r.rolling30.avgGainPct === null ? '—' : `${r.rolling30.avgGainPct >= 0 ? '+' : ''}${r.rolling30.avgGainPct.toFixed(2)}%`}
            color={rateColor(r.rolling30.avgGainPct, 1.5, 0.5)} />
          <StatCard label="Delivery Open"
            value={String(r.rolling30.deliveryOpen)}
            color={r.rolling30.deliveryOpen > 5 ? '#f59e0b' : '#c9a84c'} />
          <StatCard label="Capital Eff."
            value={r.rolling30.capitalEfficiency === null ? '—' : `${r.rolling30.capitalEfficiency >= 0 ? '+' : ''}${r.rolling30.capitalEfficiency.toFixed(2)}%`}
            color={r.rolling30.capitalEfficiency === null ? 'rgba(255,255,255,0.55)' : (r.rolling30.capitalEfficiency >= 0 ? '#52b788' : '#e05a5e')} />
        </div>
      </Section>

      {r.fineTuning.length > 0 && (
        <Section title="Fine-tuning signals">
          <div className="rounded-xl p-5" style={{ background:'#100e0a', border:'1px solid rgba(255,255,255,0.08)' }}>
            <ul className="list-disc pl-5 space-y-2 text-[12px] leading-relaxed" style={{ color:'rgba(255,255,255,0.85)' }}>
              {r.fineTuning.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        </Section>
      )}

      {r.trades.length === 0 && r.missedSignals.length === 0 && (
        <div className="text-center py-12">
          <p className="text-4xl mb-3 opacity-20">∅</p>
          <p className="text-base" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.35)', fontSize:'18px' }}>
            No activity recorded on this date
          </p>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] tracking-widest uppercase mb-3" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>{title}</p>
      {children}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.15)' }}>
      <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{label}</p>
      <p className="text-xl font-semibold" style={{ color, fontFamily:'JetBrains Mono, monospace' }}>{value}</p>
    </div>
  )
}

function TradeCard({ t }: { t: EnrichedTrade }) {
  const pnlColor = t.pnlRupees >= 0 ? '#52b788' : '#e05a5e'
  const vColor = verdictColor(t.verdict)
  const vLabel = verdictLabel(t.verdict)
  const leftOnTable = (t.finalLeftOnTable ?? t.leftOnTable) || 0
  const dayHigh = t.finalDayHigh ?? t.dayHighAfterEntry
  const heldMin = t.entryTime && t.exitTime
    ? Math.max(0, Math.round((new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()) / 60000))
    : null
  return (
    <div className="rounded-xl p-4" style={{ background:'#100e0a', border:'1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-base font-bold" style={{ color:'rgba(255,255,255,0.85)', fontFamily:'JetBrains Mono, monospace' }}>{t.symbol}</p>
          <p className="text-[10px] mt-0.5" style={{ color:'rgba(255,255,255,0.35)' }}>
            {t.account} · {t.qty} sh · {t.strategy}{heldMin !== null ? ` · ${heldMin} min` : ''}
          </p>
        </div>
        <span className="px-2 py-1 rounded text-[9px] font-semibold tracking-widest"
          style={{ background:`${vColor}22`, color:vColor, border:`1px solid ${vColor}66`, fontFamily:'JetBrains Mono, monospace' }}>
          {vLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]" style={{ fontFamily:'JetBrains Mono, monospace' }}>
        <div style={{ color:'rgba(255,255,255,0.55)' }}>Entry <span style={{ color:'rgba(255,255,255,0.85)' }}>₹{t.entryPrice.toFixed(2)}</span></div>
        <div style={{ color:'rgba(255,255,255,0.55)' }}>Exit <span style={{ color:'rgba(255,255,255,0.85)' }}>₹{t.exitPrice.toFixed(2)}</span></div>
        <div style={{ color:'rgba(255,255,255,0.55)' }}>P&L <span style={{ color:pnlColor, fontWeight:600 }}>{signedRupees(t.pnlRupees)} ({t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%)</span></div>
        <div style={{ color:'rgba(255,255,255,0.55)' }}>Day high <span style={{ color:'rgba(255,255,255,0.85)' }}>₹{dayHigh.toFixed(2)}</span></div>
        <div className="col-span-2" style={{ color:'rgba(255,255,255,0.55)' }}>
          Left on table <span style={{ color: leftOnTable > 0 ? '#f59e0b' : 'rgba(255,255,255,0.35)' }}>{leftOnTable > 0 ? `₹${leftOnTable.toFixed(2)}` : '—'}</span>
        </div>
      </div>
      {t.notes && <p className="text-[10px] mt-3 italic" style={{ color:'rgba(255,255,255,0.35)' }}>{t.notes}</p>}
    </div>
  )
}

function MissedRow({ m }: { m: EnrichedMissed }) {
  const oColor = m.outcome === 'missed_opportunity' ? '#f59e0b' : m.outcome === 'good_miss' ? '#52b788' : 'rgba(255,255,255,0.55)'
  const oLabel = m.outcome === 'missed_opportunity' ? 'MISSED OPPORTUNITY' : m.outcome === 'good_miss' ? 'GOOD MISS' : 'UNKNOWN'
  return (
    <div className="grid grid-cols-12 px-4 py-3 items-center text-[11px]"
      style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', fontFamily:'JetBrains Mono, monospace' }}>
      <span className="col-span-2" style={{ color:'rgba(255,255,255,0.5)' }}>{m.time}</span>
      <span className="col-span-2 font-semibold" style={{ color:'rgba(255,255,255,0.85)' }}>{m.symbol}</span>
      <span className="col-span-5 text-[10px]" style={{ color:'rgba(255,255,255,0.5)' }}>{m.reasonSkipped}</span>
      <span className="col-span-3 text-right">
        <span className="px-2 py-1 rounded text-[8px] font-semibold tracking-widest"
          style={{ background:`${oColor}22`, color:oColor, border:`1px solid ${oColor}66` }}>
          {oLabel}
        </span>
      </span>
    </div>
  )
}

// ─────────────────────────── Helpers ───────────────────────────

function signedRupees(n: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  const abs = Math.abs(Math.round(n)).toLocaleString('en-IN')
  return n >= 0 ? `+₹${abs}` : `-₹${abs}`
}

function verdictColor(v: string): string {
  if (v === 'correct_exit') return '#52b788'
  if (v === 'early_exit')   return '#f59e0b'
  if (v === 'delivery')     return '#60a5fa'
  return 'rgba(255,255,255,0.55)'
}
function verdictLabel(v: string): string {
  if (v === 'correct_exit') return 'CORRECT EXIT'
  if (v === 'early_exit')   return 'EARLY EXIT'
  if (v === 'delivery')     return 'DELIVERY'
  if (v === 'manual')       return 'MANUAL'
  return v.toUpperCase()
}
function rateColor(v: number | null, good: number, ok: number): string {
  if (v === null) return 'rgba(255,255,255,0.55)'
  if (v >= good) return '#52b788'
  if (v >= ok) return '#f59e0b'
  return '#e05a5e'
}

function statusColor(s: string): string {
  if (s === 'COMPLETE') return '#52b788'
  if (s === 'REJECTED' || s === 'CANCELLED') return '#e05a5e'
  return '#c9a84c'
}

function fmtTime(ts?: string): string {
  if (!ts) return '—'
  const m = ts.match(/(\d{2}):(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : ts.slice(0, 5)
}

function AccountTabs({ accounts, connected, active, onSelect, loaded }: {
  accounts: AccountDisplay[]
  connected: string[]
  active: string | null
  onSelect: (n: string) => void
  loaded: boolean
}) {
  if (!loaded) return <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.3)' }}>Loading accounts…</p>
  const connectedAccounts = accounts.filter(a => connected.includes(a.name))
  if (connectedAccounts.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {connectedAccounts.map(acc => {
        const isActive = active === acc.name
        return (
          <button key={acc.name} onClick={() => onSelect(acc.name)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] transition-all"
            style={{
              background: isActive ? `${acc.color}15` : 'rgba(255,255,255,0.02)',
              border: `1px solid ${isActive ? acc.color + '55' : 'rgba(255,255,255,0.08)'}`,
              color: isActive ? acc.color : 'rgba(255,255,255,0.5)',
            }}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background:`${acc.color}20`, color:acc.color, border:`1px solid ${acc.color}40` }}>
              {acc.initials}
            </span>
            <span style={{ fontWeight: isActive ? 500 : 400 }}>{acc.displayName}</span>
          </button>
        )
      })}
    </div>
  )
}
