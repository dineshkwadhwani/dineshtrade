'use client'
import { useEffect, useState } from 'react'

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A',
  body: '#475569', muted: '#94A3B8', primary: '#3B82F6',
  green: '#16A34A', greenBg: '#DCFCE7', red: '#DC2626', redBg: '#FEE2E2',
  amber: '#D97706', amberBg: '#FEF3C7', surface: '#F1F5FE',
}
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CustomerOption {
  id: string
  name: string
  email: string
  kiteStatus?: string
  cronMode?: string
}

interface EngineStatus {
  cronMode: 'auto' | 'manual'
  kiteConnected: boolean
  marketOpen: boolean
  marketStatus: string
  buyCap: number
  sellCap: number
  buysToday: number
  sellsToday: number
  strategies: Array<{ id: string; name: string; type: string; scanIntervalMin: number; active: boolean }>
  instanceHealth: { lastCronTickAt: string | null; kiteTokenStatus: string } | null
}

interface Recommendation {
  symbol: string
  name: string
  price: number
  dayChangePct?: number
  action: string
  strategy: string
  source: string
  reason: string
  target1: number
  target2: number
  suggestedQty: number
  confidence: 'normal' | 'high'
}

interface ScanResult {
  mode: string
  recommendations: Recommendation[]
  message?: string
  giftChangePct?: number
  generatedAt: string
  error?: string
}

interface KiteOrder {
  order_id: string
  tradingsymbol: string
  transaction_type: 'BUY' | 'SELL' | string
  quantity: number
  filled_quantity?: number
  average_price: number
  status: string
  order_timestamp?: string
  tag?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtTime(ts?: string): string {
  if (!ts) return '—'
  const m = ts.match(/(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : ts.slice(0, 5)
}

function fmtLastTick(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'unknown'
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

function strategyBadgeStyle(strategyId: string, strategyType?: string) {
  const type = strategyType ?? (strategyId === 'accumulator' ? 'dip' : strategyId === 'catalyst' ? 'momentum' : 'pivotal')
  if (type === 'dip') return { color: '#166534', bg: '#DCFCE7' }
  if (type === 'momentum') return { color: '#1D4ED8', bg: '#EFF6FF' }
  return { color: '#92400E', bg: '#FFFBEB' }
}

function strategyLabel(id: string, name?: string): string {
  if (id === 'accumulator') return `📊 ${name ?? 'Accumulator'}`
  if (id === 'catalyst') return `⚡ ${name ?? 'Catalyst'}`
  return `🔶 ${name ?? id}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatTile({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 18px', boxShadow: '0 2px 8px rgba(30,58,138,0.04)' }}>
      <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: INTER }}>{label}</p>
      <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: accent ?? C.heading, fontFamily: SORA }}>{value}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted, fontFamily: INTER }}>{sub}</p>}
    </div>
  )
}

function RecCard({ rec, canBuy, onExecute }: {
  rec: Recommendation
  canBuy: boolean
  onExecute: (rec: Recommendation) => Promise<{ ok: boolean; msg: string }>
}) {
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const badge = strategyBadgeStyle(rec.strategy)
  const pct1 = ((rec.target1 - rec.price) / rec.price * 100).toFixed(1)
  const pct2 = ((rec.target2 - rec.price) / rec.price * 100).toFixed(1)

  async function handleExecute() {
    setBusy(true)
    const r = await onExecute(rec)
    setResult(r)
    setBusy(false)
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${rec.confidence === 'high' ? '#FCD28A' : C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(30,58,138,0.04)' }}>
      <div style={{ padding: '14px 18px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 16, color: C.heading }}>{rec.symbol}</span>
            {rec.confidence === 'high' && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontFamily: INTER }}>HIGH CONF</span>}
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: badge.bg, color: badge.color, fontFamily: INTER }}>
              {strategyLabel(rec.strategy)}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: INTER }}>{rec.name} · {rec.source}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ margin: 0, fontFamily: MONO, fontWeight: 700, fontSize: 18, color: rec.dayChangePct != null ? (rec.dayChangePct > 0 ? C.green : rec.dayChangePct < 0 ? C.red : C.body) : C.heading }}>
            ₹{rec.price}
          </p>
          {rec.dayChangePct != null && (
            <p style={{ margin: '2px 0 0', fontSize: 11, fontFamily: MONO, color: rec.dayChangePct > 0 ? C.green : rec.dayChangePct < 0 ? C.red : C.body }}>
              {rec.dayChangePct > 0 ? '▲' : '▼'} {Math.abs(rec.dayChangePct).toFixed(2)}%
            </p>
          )}
          <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted, fontFamily: INTER }}>Qty: {rec.suggestedQty}</p>
        </div>
      </div>
      <div style={{ padding: '12px 18px' }}>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: C.body, fontFamily: INTER }}>{rec.reason}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'T1', val: `₹${rec.target1}`, pct: `+${pct1}%`, color: C.green },
            { label: 'T2', val: `₹${rec.target2}`, pct: `+${pct2}%`, color: '#15803D' },
            { label: 'Capital', val: `₹${(rec.price * rec.suggestedQty).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, pct: '', color: C.body },
          ].map(item => (
            <div key={item.label} style={{ background: C.surface, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 2px', fontSize: 9, fontWeight: 600, color: C.muted, textTransform: 'uppercase', fontFamily: INTER }}>{item.label}</p>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: item.color, fontFamily: MONO }}>{item.val}</p>
              {item.pct && <p style={{ margin: '1px 0 0', fontSize: 9, color: item.color, fontFamily: INTER }}>{item.pct}</p>}
            </div>
          ))}
        </div>
        {!result ? (
          <button onClick={handleExecute} disabled={busy || !canBuy} style={{
            width: '100%', padding: '10px 0', borderRadius: 8,
            border: canBuy ? `1px solid ${C.green}` : `1px solid ${C.border}`,
            background: canBuy ? C.greenBg : C.surface,
            color: canBuy ? C.green : C.muted,
            fontFamily: INTER, fontWeight: 700, fontSize: 13,
            cursor: canBuy && !busy ? 'pointer' : 'not-allowed',
            opacity: busy ? 0.7 : 1,
          }}>
            {busy ? 'Placing order…' : !canBuy ? '🔒 Market closed' : '▶ Execute BUY'}
          </button>
        ) : (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: result.ok ? C.greenBg : C.redBg, border: `1px solid ${result.ok ? C.green : C.red}`, color: result.ok ? C.green : C.red, fontFamily: INTER, fontSize: 13, fontWeight: 600 }}>
            {result.ok ? '✓' : '✗'} {result.msg}
          </div>
        )}
      </div>
    </div>
  )
}

function OrderRow({ order, isLast }: { order: KiteOrder; isLast: boolean }) {
  const isBuy = order.transaction_type === 'BUY'
  const isComplete = order.status === 'COMPLETE'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '60px 1.2fr 70px 60px 80px 80px', alignItems: 'center', padding: '9px 16px', borderBottom: isLast ? 'none' : `1px solid ${C.border}`, gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>{fmtTime(order.order_timestamp)}</span>
      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: C.heading }}>{order.tradingsymbol}</span>
      <span style={{ fontWeight: 700, fontSize: 12, color: isBuy ? C.green : C.red }}>{isBuy ? '▲ BUY' : '▼ SELL'}</span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: C.body, textAlign: 'right' }}>×{order.filled_quantity ?? order.quantity}</span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: C.body, textAlign: 'right' }}>₹{order.average_price?.toFixed(2) ?? '—'}</span>
      <span style={{ fontFamily: INTER, fontSize: 10, fontWeight: 600, textAlign: 'right', color: isComplete ? C.green : order.status === 'REJECTED' || order.status === 'CANCELLED' ? C.red : C.amber }}>
        {order.status}
      </span>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export default function PrivilegedEnginePanel({ customers }: { customers: CustomerOption[] }) {
  const [selectedId, setSelectedId] = useState<string>(customers[0]?.id ?? '')
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [orders, setOrders] = useState<KiteOrder[]>([])
  const [scanning, setScanning] = useState(false)

  const selectedCustomer = customers.find(c => c.id === selectedId)

  function qs() {
    return selectedId ? `?targetCustomerId=${encodeURIComponent(selectedId)}` : ''
  }

  async function loadStatus() {
    if (!selectedId) return
    try {
      const r = await fetch(`/api/dalgo/customer/engine/status${qs()}`, { cache: 'no-store' })
      const d = await r.json()
      if (!d.error) setStatus(d)
    } catch {}
  }

  async function loadOrders() {
    if (!selectedId) return
    try {
      const r = await fetch(`/api/dalgo/customer/engine/orders${qs()}`, { cache: 'no-store' })
      const d = await r.json()
      if (Array.isArray(d.orders)) setOrders(d.orders)
    } catch {}
  }

  useEffect(() => {
    setStatus(null); setScan(null); setOrders([])
    if (!selectedId) return
    loadStatus()
    loadOrders()
    const id = setInterval(loadOrders, 30_000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  async function handleScan() {
    setScanning(true); setScan(null)
    try {
      const r = await fetch('/api/dalgo/customer/engine/scan', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCustomerId: selectedId }),
      })
      const d = await r.json()
      setScan(d)
      loadOrders(); loadStatus()
    } catch (e) {
      setScan({ mode: 'error', recommendations: [], message: String(e), error: String(e), generatedAt: new Date().toISOString() })
    } finally {
      setScanning(false)
    }
  }

  async function executeOrder(rec: Recommendation): Promise<{ ok: boolean; msg: string }> {
    const r = await fetch('/api/dalgo/customer/engine/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetCustomerId: selectedId,
        symbol: rec.symbol, quantity: rec.suggestedQty, price: rec.price,
        strategyId: rec.strategy, target1: rec.target1, target2: rec.target2,
        source: rec.source, reason: rec.reason, tag: `dt-${rec.strategy}`,
      }),
    })
    const data = await r.json()
    if (!r.ok) return { ok: false, msg: data.reason ?? data.error ?? `HTTP ${r.status}` }
    loadOrders(); loadStatus()
    return { ok: true, msg: `Order placed${data.orderId ? ` · ${data.orderId}` : ''}` }
  }

  const completedOrders = orders.filter(o => o.status === 'COMPLETE')
  const pendingOrders = orders.filter(o => ['OPEN', 'TRIGGER PENDING', 'AMO REQ RECEIVED'].includes(o.status))
  const buysToday = completedOrders.filter(o => o.transaction_type === 'BUY')
  const sellsToday = completedOrders.filter(o => o.transaction_type === 'SELL')
  const activeStrategies = status?.strategies.filter(s => s.active) ?? []
  const canBuy = (status?.kiteConnected ?? false) && (status?.marketOpen ?? false)

  const recsByStrategy = scan?.recommendations.reduce<Record<string, Recommendation[]>>((acc, rec) => {
    acc[rec.strategy] = acc[rec.strategy] ?? []
    acc[rec.strategy].push(rec)
    return acc
  }, {}) ?? {}

  if (customers.length === 0) {
    return <p style={{ fontSize: 14, color: C.muted, fontFamily: INTER }}>No customers assigned.</p>
  }

  return (
    <div style={{ fontFamily: INTER }}>
      {/* ── Customer selector ── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px', marginBottom: 20, boxShadow: '0 2px 8px rgba(30,58,138,0.04)' }}>
        <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: INTER }}>
          Running engine for
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            style={{
              padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: C.card, color: C.heading, fontFamily: SORA, fontWeight: 600, fontSize: 14,
              cursor: 'pointer', minWidth: 240,
            }}
          >
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
            ))}
          </select>
          {selectedCustomer && (
            <div style={{ display: 'flex', gap: 8 }}>
              {selectedCustomer.kiteStatus && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, fontFamily: INTER,
                  color: selectedCustomer.kiteStatus === 'connected' ? C.green : C.red,
                  background: selectedCustomer.kiteStatus === 'connected' ? C.greenBg : C.redBg,
                }}>
                  Kite: {selectedCustomer.kiteStatus}
                </span>
              )}
              {selectedCustomer.cronMode && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, fontFamily: INTER,
                  color: selectedCustomer.cronMode === 'auto' ? C.green : C.amber,
                  background: selectedCustomer.cronMode === 'auto' ? C.greenBg : C.amberBg,
                }}>
                  {selectedCustomer.cronMode === 'auto' ? '⚡ Auto' : '✋ Manual'}
                </span>
              )}
            </div>
          )}
          <button onClick={handleScan} disabled={scanning || !selectedId} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', marginLeft: 'auto',
            background: scanning ? C.surface : `linear-gradient(135deg, ${C.primary}, #60A5FA)`,
            color: scanning ? C.muted : '#fff',
            fontFamily: INTER, fontWeight: 700, fontSize: 13,
            cursor: scanning ? 'not-allowed' : 'pointer',
          }}>
            {scanning ? '↻ Scanning…' : '↻ Refresh & Scan'}
          </button>
        </div>
      </div>

      {/* ── Status tiles ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatTile label="Market" value={status?.marketOpen ? '🟢 Open' : status ? '🔴 Closed' : '…'} sub={status?.marketStatus ?? '—'} accent={status?.marketOpen ? C.green : C.red} />
        <StatTile label="Kite" value={status == null ? '…' : status.kiteConnected ? 'Connected' : 'Disconnected'} sub={status?.kiteConnected ? 'Ready to trade' : 'Not connected'} accent={status?.kiteConnected ? C.green : C.red} />
        <StatTile label="BUYs today" value={`${buysToday.length} / ${status?.buyCap ?? '—'}`} sub={status ? `${Math.max(0, status.buyCap - buysToday.length)} remaining` : undefined} accent={C.green} />
        <StatTile label="SELLs today" value={`${sellsToday.length} / ${status?.sellCap ?? '—'}`} sub={status ? `${Math.max(0, status.sellCap - sellsToday.length)} remaining` : undefined} accent={C.red} />
      </div>

      {/* ── Auto mode banner ── */}
      {status?.cronMode === 'auto' && (
        <div style={{ background: C.greenBg, border: `1px solid ${C.green}40`, borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: C.green, fontFamily: INTER }}>
            ⚡ Auto mode — scans running for this customer.
            {activeStrategies.length > 0 && ` ${activeStrategies.map(s => `${s.name} every ${s.scanIntervalMin}m`).join(', ')}.`}
            {' '}You can still run a manual scan above.
          </p>
          {status.instanceHealth && (
            <p style={{ margin: '6px 0 0', fontSize: 11, color: C.green, opacity: 0.7, fontFamily: MONO }}>
              Last cron tick: {fmtLastTick(status.instanceHealth.lastCronTickAt)} · Token: {status.instanceHealth.kiteTokenStatus}
            </p>
          )}
        </div>
      )}

      {/* ── Scan results ── */}
      {scan && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 8, marginBottom: 14,
            background: scan.mode === 'dip' ? C.greenBg : scan.mode === 'catalyst' ? '#EFF6FF' : scan.mode === 'circuit' ? C.redBg : C.surface,
            border: `1px solid ${scan.mode === 'dip' ? C.green : scan.mode === 'catalyst' ? C.primary : scan.mode === 'circuit' ? C.red : C.border}40`,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, fontFamily: INTER, color: scan.mode === 'dip' ? C.green : scan.mode === 'catalyst' ? C.primary : scan.mode === 'circuit' ? C.red : C.body }}>
              {scan.mode === 'dip' ? '📊 Dip Mode' : scan.mode === 'catalyst' ? '⚡ Catalyst Mode' : scan.mode === 'circuit' ? '🚨 Circuit Breaker' : scan.mode === 'error' ? '⚠ Error' : scan.mode}
            </span>
            {scan.giftChangePct != null && <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>GIFT Nifty {scan.giftChangePct > 0 ? '+' : ''}{scan.giftChangePct.toFixed(2)}%</span>}
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{fmtTime(scan.generatedAt)}</span>
          </div>
          {scan.message && <p style={{ margin: '0 0 12px', fontSize: 12, color: C.muted, fontFamily: INTER, fontStyle: 'italic' }}>{scan.message}</p>}
          {scan.error && (
            <div style={{ background: C.redBg, border: `1px solid ${C.red}40`, borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 12, color: C.red, fontFamily: INTER }}>Error: {scan.error}</p>
            </div>
          )}
          {scan.recommendations.length === 0 && !scan.error && (
            <p style={{ fontSize: 13, color: C.muted, fontFamily: INTER }}>No recommendations from this scan.</p>
          )}
          {Object.entries(recsByStrategy).map(([stratId, recs]) => {
            const stratInfo = activeStrategies.find(s => s.id === stratId)
            const badge = strategyBadgeStyle(stratId, stratInfo?.type)
            return (
              <div key={stratId} style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderLeft: `3px solid ${badge.color}`, paddingLeft: 10, marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: badge.color, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {strategyLabel(stratId, stratInfo?.name)}
                  </h3>
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{recs.length} rec{recs.length !== 1 ? 's' : ''}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                  {recs.map((rec, i) => <RecCard key={i} rec={rec} canBuy={canBuy} onExecute={executeOrder} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!scan && !scanning && (
        <div style={{ padding: '16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20, color: C.primary, opacity: 0.4 }}>⚡</span>
          <p style={{ margin: 0, fontSize: 13, color: C.muted, fontFamily: INTER }}>
            Select a customer above, then click Refresh &amp; Scan to run the strategy engine.
          </p>
        </div>
      )}

      {/* ── Today's orders ── */}
      {(completedOrders.length > 0 || pendingOrders.length > 0) && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(30,58,138,0.04)', marginTop: 8 }}>
          {pendingOrders.length > 0 && (
            <>
              <div style={{ padding: '8px 16px', background: C.amberBg, borderBottom: `1px solid ${C.amber}40` }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.amber, fontFamily: INTER, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pending · {pendingOrders.length}</span>
              </div>
              {pendingOrders.map((o, i) => <OrderRow key={o.order_id} order={o} isLast={i === pendingOrders.length - 1 && completedOrders.length === 0} />)}
            </>
          )}
          {completedOrders.length > 0 && (
            <>
              <div style={{ padding: '8px 16px', background: C.surface, borderBottom: `1px solid ${C.border}`, borderTop: pendingOrders.length > 0 ? `1px solid ${C.border}` : undefined }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, fontFamily: INTER, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Executed today · {completedOrders.length}</span>
              </div>
              {completedOrders.map((o, i) => <OrderRow key={o.order_id} order={o} isLast={i === completedOrders.length - 1} />)}
            </>
          )}
        </div>
      )}
    </div>
  )
}
