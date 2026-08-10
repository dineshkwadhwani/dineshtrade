'use client'
import { useState, useEffect } from 'react'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8', primary: '#3B82F6', green: '#16A34A', greenBg: '#DCFCE7', red: '#DC2626', redBg: '#FEE2E2', amber: '#D97706', amberBg: '#FEF3C7' }
const INTER = "'Inter', sans-serif"
const SORA = "'Sora', sans-serif"

type Strategy = { id: string; name: string; type: string }
type BacktestSummary = { totalTrades: number; closedTrades: number; openTrades: number; wins: number; losses: number; winRate: number; realizedPnl: number; unrealizedMtm: number; netPnl: number; totalCharges: number; maxDrawdownPct: number; avgHoldDays: number }
type BacktestTrade = { symbol: string; entryDate: string; exitDate: string | null; entryPrice: number; exitPrice: number | null; quantity: number; netPnl: number; status: 'closed' | 'open' | 'target1' | 'target2' | 'handoff' }
type HistoryEntry = { runId: string; timestamp: string; strategyName: string; strategyType: string; netProfitRupees: number; netProfitPct: number; winRate: number; closedTrades: number; openTrades: number; avgHoldDays: number }

function fmt(n: number, d = 2) { return n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }) }
function fmtPct(n: number) { return (n >= 0 ? '+' : '') + fmt(n) + '%' }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) }

function StatCard({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'green' | 'red' | 'amber' }) {
  const col = tone === 'green' ? C.green : tone === 'red' ? C.red : tone === 'amber' ? C.amber : C.heading
  const bg = tone === 'green' ? C.greenBg : tone === 'red' ? C.redBg : tone === 'amber' ? C.amberBg : C.bg
  return (
    <div style={{ background: bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px' }}>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 700, color: col, fontFamily: SORA }}>{value}</p>
    </div>
  )
}

export default function BacktestTab({ strategies, targetCustomerId }: {
  strategies: Strategy[]
  targetCustomerId?: string
}) {
  const [strategyId, setStrategyId] = useState(strategies[0]?.id ?? '')
  const [runAll, setRunAll] = useState(false)
  const [days, setDays] = useState(60)
  const [initialCapital, setInitialCapital] = useState(50000)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ summary: BacktestSummary; trades: BacktestTrade[]; analysis?: string | null } | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [showTrades, setShowTrades] = useState(false)

  const apiBase = '/api/dalgo/customer/backtest'

  useEffect(() => {
    const url = targetCustomerId ? `${apiBase}?targetCustomerId=${targetCustomerId}` : apiBase
    fetch(url).then(r => r.json()).then(d => setHistory(d.history ?? [])).catch(() => {}).finally(() => setLoadingHistory(false))
  }, [targetCustomerId])

  async function runBacktest() {
    setRunning(true); setError(''); setResult(null)
    try {
      const res = await fetch(apiBase, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyKey: runAll ? undefined : strategyId, runAllActive: runAll, days, initialCapital, ...(targetCustomerId ? { targetCustomerId } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Backtest failed.'); return }
      const r = data.result
      const strats = Array.isArray(r?.results) ? r.results : [r]
      const combined = strats[0]
      setResult({ summary: combined?.summary, trades: combined?.trades ?? [], analysis: data.analysis })
      // Refresh history
      const hUrl = targetCustomerId ? `${apiBase}?targetCustomerId=${targetCustomerId}` : apiBase
      fetch(hUrl).then(hr => hr.json()).then(d => setHistory(d.history ?? [])).catch(() => {})
    } catch (e) { setError(String(e)) }
    finally { setRunning(false) }
  }

  const s = result?.summary

  return (
    <div style={{ fontFamily: INTER, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Config form */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <h2 style={{ fontFamily: SORA, fontSize: 14, fontWeight: 700, color: C.heading, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Run Backtest</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Strategy</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={runAll ? '__all__' : strategyId} onChange={e => { if (e.target.value === '__all__') { setRunAll(true) } else { setRunAll(false); setStrategyId(e.target.value) } }}
                style={{ padding: '8px 12px', fontFamily: INTER, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.body, background: C.bg, cursor: 'pointer', outline: 'none', flex: 1, minWidth: 160 }}>
                <option value="__all__">All Active Strategies</option>
                {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ flex: '0 0 100px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Days</label>
            <input type="number" value={days} min={10} max={180} onChange={e => setDays(Number(e.target.value))}
              style={{ width: '100%', padding: '8px 12px', fontFamily: INTER, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.body, background: C.bg, boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div style={{ flex: '0 0 140px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Initial Capital (₹)</label>
            <input type="number" value={initialCapital} min={10000} step={10000} onChange={e => setInitialCapital(Number(e.target.value))}
              style={{ width: '100%', padding: '8px 12px', fontFamily: INTER, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.body, background: C.bg, boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <button onClick={runBacktest} disabled={running}
            style={{ padding: '9px 24px', background: running ? '#93C5FD' : C.primary, color: '#fff', border: 'none', borderRadius: 8, fontFamily: INTER, fontWeight: 600, fontSize: 14, cursor: running ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {running ? '⏳ Running…' : '▶ Run Backtest'}
          </button>
        </div>
        {error && <p style={{ fontSize: 13, color: C.red, margin: '10px 0 0' }}>{error}</p>}
      </div>

      {/* Results */}
      {s && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <StatCard label="Net P&L" value={`₹${fmt(s.netPnl)}`} tone={s.netPnl >= 0 ? 'green' : 'red'} />
            <StatCard label="Realized P&L" value={`₹${fmt(s.realizedPnl)}`} tone={s.realizedPnl >= 0 ? 'green' : 'red'} />
            <StatCard label="Open MTM" value={`₹${fmt(s.unrealizedMtm)}`} tone={s.unrealizedMtm >= 0 ? 'green' : 'red'} />
            <StatCard label="Win Rate" value={`${fmt(s.winRate * 100, 1)}%`} tone={s.winRate >= 0.7 ? 'green' : s.winRate >= 0.5 ? 'amber' : 'red'} />
            <StatCard label="Closed Trades" value={s.closedTrades} />
            <StatCard label="Open Trades" value={s.openTrades} />
            <StatCard label="Max Drawdown" value={`${fmt(s.maxDrawdownPct, 1)}%`} tone={s.maxDrawdownPct > 20 ? 'red' : s.maxDrawdownPct > 10 ? 'amber' : 'green'} />
            <StatCard label="Avg Hold Days" value={`${fmt(s.avgHoldDays, 1)}d`} />
            <StatCard label="Charges" value={`₹${fmt(s.totalCharges)}`} />
          </div>

          {/* AI Analysis */}
          {result?.analysis && (
            <div style={{ background: '#EFF6FF', border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <p style={{ fontFamily: SORA, fontSize: 13, fontWeight: 700, color: C.heading, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>AI Analysis</p>
              <p style={{ fontSize: 13, color: C.body, margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{result.analysis}</p>
            </div>
          )}

          {/* Trade list */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setShowTrades(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: SORA, fontWeight: 700, fontSize: 14, color: C.heading }}>
              <span>Trades ({result.trades.length})</span>
              <span style={{ color: C.muted, fontSize: 12, transform: showTrades ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
            </button>
            {showTrades && result.trades.length > 0 && (
              <div style={{ overflowX: 'auto', borderTop: `1px solid ${C.border}` }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#EFF6FF' }}>
                      {['Symbol', 'Entry', 'Exit', 'Qty', 'Entry ₹', 'Exit ₹', 'Net P&L', 'Status'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: C.heading, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                        <td style={{ padding: '7px 12px', fontWeight: 600, color: C.heading }}>{t.symbol}</td>
                        <td style={{ padding: '7px 12px', color: C.muted }}>{fmtDate(t.entryDate)}</td>
                        <td style={{ padding: '7px 12px', color: C.muted }}>{t.exitDate ? fmtDate(t.exitDate) : '—'}</td>
                        <td style={{ padding: '7px 12px', color: C.body }}>{t.quantity}</td>
                        <td style={{ padding: '7px 12px', color: C.body }}>₹{fmt(t.entryPrice)}</td>
                        <td style={{ padding: '7px 12px', color: C.body }}>{t.exitPrice ? `₹${fmt(t.exitPrice)}` : '—'}</td>
                        <td style={{ padding: '7px 12px', fontWeight: 600, color: t.netPnl >= 0 ? C.green : C.red }}>₹{fmt(t.netPnl)}</td>
                        <td style={{ padding: '7px 12px' }}>
                          <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: t.status === 'closed' ? C.greenBg : C.bg, color: t.status === 'closed' ? C.green : C.muted }}>
                            {t.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* History */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <h2 style={{ fontFamily: SORA, fontSize: 14, fontWeight: 700, color: C.heading, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Run History {loadingHistory ? '…' : `(${history.length})`}
        </h2>
        {history.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 14 }}>{loadingHistory ? 'Loading…' : 'No backtest runs yet.'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#EFF6FF' }}>
                  {['Date', 'Strategy', 'Net P&L', 'Realized', 'Win Rate', 'Trades', 'Avg Hold'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: C.heading, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.slice().reverse().map((h, i) => (
                  <tr key={h.runId} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                    <td style={{ padding: '8px 12px', color: C.muted, fontSize: 12 }}>{fmtDate(h.timestamp)}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: C.heading }}>{h.strategyName}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: h.netProfitRupees >= 0 ? C.green : C.red }}>₹{fmt(h.netProfitRupees)} <span style={{ fontSize: 11 }}>({fmtPct(h.netProfitPct)})</span></td>
                    <td style={{ padding: '8px 12px', color: C.body }}>₹{fmt(h.netProfitRupees)}</td>
                    <td style={{ padding: '8px 12px', color: h.winRate >= 0.7 ? C.green : h.winRate >= 0.5 ? C.amber : C.red, fontWeight: 600 }}>{fmt(h.winRate * 100, 1)}%</td>
                    <td style={{ padding: '8px 12px', color: C.body }}>{h.closedTrades}C / {h.openTrades}O</td>
                    <td style={{ padding: '8px 12px', color: C.body }}>{fmt(h.avgHoldDays, 1)}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
