'use client'
import { useEffect, useState } from 'react'

const C = {
  card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A',
  body: '#475569', muted: '#94A3B8', surface: '#F1F5FE',
  green: '#16A34A', greenBg: '#DCFCE7', red: '#DC2626', redBg: '#FEE2E2',
  amber: '#D97706', amberBg: '#FEF3C7', primary: '#3B82F6',
}
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"

type CheckState = 'idle' | 'running' | 'ok' | 'fail'

interface PingCard {
  id: string
  title: string
  description: string
  autoRun: boolean
  action: () => Promise<{ ok: boolean; detail?: string; error?: string }>
}

interface CustomerRow {
  id: string; name: string; email: string
  tokenStatus: 'connected' | 'expired' | 'missing'
  tokenExpiresAt: string | null
  cronMode: string
  availableFunds: number | null
  availablePct: number | null
  heartbeatRunning: boolean
  heartbeatAt: string | null
  heartbeatAgeMin: number | null
  activeStrategies: number
  needsReminder: boolean
  comment: string | null
  syncStatus: 'in_sync' | 'out_of_sync' | 'unknown'
  syncDetail?: string
}

function fmt(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function fundsBadge(pct: number | null): { color: string; bg: string; label: string } {
  if (pct === null) return { color: C.muted, bg: C.surface, label: '—' }
  if (pct > 30) return { color: C.green, bg: C.greenBg, label: `${pct.toFixed(0)}%` }
  if (pct > 10) return { color: C.amber, bg: C.amberBg, label: `${pct.toFixed(0)}%` }
  return { color: C.red, bg: C.redBg, label: `${pct.toFixed(0)}%` }
}

function PingCardUI({ card }: { card: PingCard }) {
  const [state, setState] = useState<CheckState>('idle')
  const [detail, setDetail] = useState<string>('')

  async function run() {
    setState('running')
    try {
      const r = await card.action()
      setState(r.ok ? 'ok' : 'fail')
      setDetail(r.detail ?? r.error ?? '')
    } catch (e) {
      setState('fail')
      setDetail(String(e))
    }
  }

  useEffect(() => { if (card.autoRun) run() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stateColor = state === 'ok' ? C.green : state === 'fail' ? C.red : state === 'running' ? C.amber : C.muted
  const stateBg = state === 'ok' ? C.greenBg : state === 'fail' ? C.redBg : state === 'running' ? C.amberBg : C.surface

  return (
    <div style={{ background: C.card, border: `1px solid ${state === 'ok' ? '#86EFAC' : state === 'fail' ? '#FCA5A5' : C.border}`, borderRadius: 12, padding: '16px 20px', boxShadow: '0 2px 8px rgba(30,58,138,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <p style={{ margin: 0, fontFamily: SORA, fontWeight: 700, fontSize: 15, color: C.heading }}>{card.title}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted, fontFamily: INTER }}>{card.description}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {state !== 'idle' && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: stateBg, color: stateColor, fontFamily: INTER }}>
              {state === 'running' ? '⟳ checking…' : state === 'ok' ? '✓ OK' : '✗ Failed'}
            </span>
          )}
          <button onClick={run} disabled={state === 'running'} style={{
            padding: '6px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: state === 'running' ? C.surface : C.primary, color: state === 'running' ? C.muted : '#fff',
            fontFamily: INTER, fontWeight: 600, fontSize: 12, cursor: state === 'running' ? 'not-allowed' : 'pointer',
          }}>
            {state === 'running' ? '…' : card.autoRun && state !== 'idle' ? '↻ Recheck' : 'Run Test'}
          </button>
        </div>
      </div>
      {detail && (
        <p style={{ margin: 0, fontSize: 11, fontFamily: MONO, color: state === 'fail' ? C.red : C.body, background: C.surface, padding: '6px 10px', borderRadius: 6 }}>
          {detail}
        </p>
      )}
    </div>
  )
}

export default function HealthCheckPanel() {
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [custLoading, setCustLoading] = useState(true)
  const [custError, setCustError] = useState('')
  const [search, setSearch] = useState('')
  const [reminding, setReminding] = useState<string | null>(null)
  const [reminderResult, setReminderResult] = useState<Record<string, string>>({})
  const [reconciling, setReconciling] = useState<string | null>(null)
  const [reconcileResult, setReconcileResult] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/dalgo/admin/health/customers', { cache: 'no-store' })
      .then(r => r.json())
      .then(async d => {
        if (d.error) { setCustError(d.error); return }
        const rows: CustomerRow[] = d.customers ?? []
        // Fetch sync status for each customer in parallel (best-effort)
        const withSync = await Promise.all(rows.map(async c => {
          try {
            const sr = await fetch(`/api/dalgo/admin/reconcile?customerId=${c.id}`, { cache: 'no-store' }).then(r => r.json())
            return {
              ...c,
              syncStatus: sr.inSync == null ? 'unknown' : sr.inSync ? 'in_sync' : 'out_of_sync',
              syncDetail: sr.inSync === false
                ? `${sr.inKiteNotTracked?.length ?? 0} in Kite not tracked, ${sr.trackedNotInKite?.length ?? 0} tracked not in Kite`
                : undefined,
            } as CustomerRow
          } catch {
            return { ...c, syncStatus: 'unknown' } as CustomerRow
          }
        }))
        setCustomers(withSync)
      })
      .catch(e => setCustError(String(e)))
      .finally(() => setCustLoading(false))
  }, [])

  async function sendReminder(customerId: string) {
    setReminding(customerId)
    try {
      const r = await fetch('/api/dalgo/admin/health/reminder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      })
      const d = await r.json()
      setReminderResult(prev => ({ ...prev, [customerId]: d.ok ? '✓ Sent' : `✗ ${d.error ?? 'Failed'}` }))
    } catch (e) {
      setReminderResult(prev => ({ ...prev, [customerId]: `✗ ${String(e)}` }))
    } finally {
      setReminding(null)
    }
  }

  async function triggerReconcile(customerId: string) {
    setReconciling(customerId)
    try {
      const r = await fetch('/api/dalgo/admin/reconcile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      })
      const d = await r.json()
      setReconcileResult(prev => ({ ...prev, [customerId]: d.ok ? '✓ Synced' : `✗ ${d.error ?? 'Failed'}` }))
      if (d.ok) setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, syncStatus: 'in_sync', syncDetail: undefined } : c))
    } catch (e) {
      setReconcileResult(prev => ({ ...prev, [customerId]: `✗ ${String(e)}` }))
    } finally {
      setReconciling(null)
    }
  }

  const pingCards: PingCard[] = [
    {
      id: 'db',
      title: 'Database Connection',
      description: 'Pings Supabase and counts profiles',
      autoRun: true,
      action: () => fetch('/api/dalgo/admin/health/ping?type=db', { cache: 'no-store' }).then(r => r.json()),
    },
    {
      id: 'ai',
      title: 'AI Provider',
      description: `Tests the configured AI provider (${process.env.NEXT_PUBLIC_AI_PROVIDER ?? 'see AI_PROVIDER env'}) with a simple ping`,
      autoRun: true,
      action: () => fetch('/api/dalgo/admin/health/ping?type=ai', { cache: 'no-store' }).then(r => r.json()),
    },
    {
      id: 'zerodha',
      title: 'Zerodha API',
      description: 'Fetches RELIANCE LTP using the primary account credentials',
      autoRun: true,
      action: () => fetch('/api/dalgo/admin/health/ping?type=zerodha', { cache: 'no-store' }).then(r => r.json()),
    },
    {
      id: 'email',
      title: 'Email (Resend)',
      description: `Sends a test email to the configured health check address`,
      autoRun: false,
      action: () => fetch('/api/dalgo/admin/health/ping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email' }),
      }).then(r => r.json()),
    },
  ]

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ fontFamily: INTER }}>
      {/* System health cards */}
      <h2 style={{ fontFamily: SORA, fontSize: 18, fontWeight: 700, color: C.heading, margin: '0 0 14px' }}>System Health</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12, marginBottom: 32 }}>
        {pingCards.map(card => <PingCardUI key={card.id} card={card} />)}
      </div>

      {/* Customer table */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <h2 style={{ fontFamily: SORA, fontSize: 18, fontWeight: 700, color: C.heading, margin: 0 }}>
          Customer Health {!custLoading && <span style={{ fontSize: 14, fontWeight: 400, color: C.muted }}>({customers.length})</span>}
        </h2>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search customers…"
          style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: INTER, fontSize: 13, color: C.heading, background: C.card, outline: 'none', minWidth: 220 }}
        />
      </div>

      {custError && (
        <div style={{ background: C.redBg, border: `1px solid #FCA5A5`, borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 12, color: C.red, fontFamily: INTER }}>⚠ {custError}</p>
        </div>
      )}

      {custLoading && <p style={{ color: C.muted, fontSize: 13, fontFamily: INTER }}>Loading customer data…</p>}

      {!custLoading && filtered.length === 0 && !custError && (
        <p style={{ color: C.muted, fontSize: 13, fontFamily: INTER }}>No customers found.</p>
      )}

      {!custLoading && filtered.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(30,58,138,0.04)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#EFF6FF' }}>
                  {['Name', 'Broker', 'Cron', 'Heartbeat', 'Funds Available', 'Strategies', 'Sync', 'Action', 'Comment'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: C.heading, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => {
                  const tokenOk = c.tokenStatus === 'connected'
                  const funds = fundsBadge(c.availablePct)
                  return (
                    <tr key={c.id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.surface }}>
                      <td style={{ padding: '10px 14px' }}>
                        <p style={{ margin: 0, fontWeight: 600, color: C.heading }}>{c.name}</p>
                        <p style={{ margin: '1px 0 0', fontSize: 11, color: C.muted }}>{c.email}</p>
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: tokenOk ? C.green : C.red, display: 'inline-block' }} />
                          <span style={{ fontSize: 12, color: tokenOk ? C.green : C.red, fontWeight: 600 }}>
                            {tokenOk ? 'Connected' : c.tokenStatus === 'expired' ? 'Expired' : 'Missing'}
                          </span>
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, fontFamily: INTER,
                          color: c.cronMode === 'auto' ? C.green : C.amber,
                          background: c.cronMode === 'auto' ? C.greenBg : C.amberBg,
                        }}>
                          {c.cronMode === 'auto' ? '⚡ Auto' : '✋ Manual'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.heartbeatRunning ? C.green : C.red, display: 'inline-block' }} />
                          <span style={{ fontSize: 12, color: c.heartbeatRunning ? C.green : C.red, fontWeight: 600 }}>
                            {c.heartbeatRunning ? 'Running' : 'Not running'}
                          </span>
                        </span>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                          {c.heartbeatAt ? `${c.heartbeatAgeMin ?? '—'}m ago` : 'never'}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        {c.availableFunds != null ? (
                          <span>
                            <span style={{ fontFamily: MONO, color: C.body }}>{fmt(c.availableFunds)}</span>
                            {' '}
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: funds.bg, color: funds.color }}>
                              {funds.label}
                            </span>
                          </span>
                        ) : <span style={{ color: C.muted }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: MONO, color: C.body }}>{c.activeStrategies}</td>
      {/* Sync status + Reconcile button */}
                      <td style={{ padding: '10px 14px' }}>
                        {reconcileResult[c.id] ? (
                          <span style={{ fontSize: 11, color: reconcileResult[c.id].startsWith('✓') ? C.green : C.red, fontFamily: INTER, fontWeight: 600 }}>{reconcileResult[c.id]}</span>
                        ) : c.syncStatus === 'out_of_sync' ? (
                          <button onClick={() => triggerReconcile(c.id)} disabled={reconciling === c.id} title={c.syncDetail}
                            style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${C.amber}`, background: C.amberBg, color: C.amber, fontFamily: INTER, fontWeight: 600, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {reconciling === c.id ? '…' : '⚡ Reconcile'}
                          </button>
                        ) : c.syncStatus === 'unknown' ? (
                          <span style={{ fontSize: 11, color: C.muted, fontFamily: INTER }}>
                            Market closed
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: c.syncStatus === 'in_sync' ? C.green : C.muted, fontWeight: 600 }}>
                            {c.syncStatus === 'in_sync' ? '✓ In sync' : '—'}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {reminderResult[c.id] ? (
                          <span style={{ fontSize: 11, color: reminderResult[c.id].startsWith('✓') ? C.green : C.red, fontFamily: INTER, fontWeight: 600 }}>
                            {reminderResult[c.id]}
                          </span>
                        ) : c.needsReminder ? (
                          <button onClick={() => sendReminder(c.id)} disabled={reminding === c.id} style={{
                            padding: '5px 12px', borderRadius: 6, border: `1px solid ${C.amber}`, background: C.amberBg,
                            color: C.amber, fontFamily: INTER, fontWeight: 600, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
                          }}>
                            {reminding === c.id ? '…' : '📧 Send Reminder'}
                          </button>
                        ) : <span style={{ color: C.muted, fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 14px', maxWidth: 200 }}>
                        {c.comment ? (
                          <span style={{ fontSize: 11, color: C.red, fontFamily: INTER }} title={c.comment}>
                            {c.comment.slice(0, 60)}{c.comment.length > 60 ? '…' : ''}
                          </span>
                        ) : <span style={{ color: C.muted, fontSize: 12 }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
