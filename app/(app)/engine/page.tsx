'use client'
import { useEffect, useState } from 'react'
import OrderModal from '@/components/OrderModal'

interface AccountDisplay { name: string; displayName: string; initials: string; color: string; note: string }

interface Recommendation {
  symbol: string; name: string; price: number; action: string
  strategy: string; source: string; reason: string
  target1: number; target2: number; stopLoss: number
  suggestedQty: number; confidence: string
  dayChangePct?: number     // today's % change from prev close (server may omit)
}

interface EngineScan {
  mode: string
  recommendations: Recommendation[]
  limits: { buysRemaining: number; sellsRemaining: number; canBuy: boolean }
  cashAvailable: number
  generatedAt: string
  message?: string
  priceSource?: 'kite_live' | 'briefing_cmp'
}

type TradeMode = 'auto' | 'manual'

export default function EnginePage() {
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [tradeMode, setTradeMode] = useState<TradeMode>('manual')
  const [scan, setScan] = useState<EngineScan | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/state').then(r => r.json()),
    ]).then(([a, s]) => {
      setAccounts(a.accounts || [])
      setConnected(s.accountsWithToken || [])
      setSelected(s.selectedAccounts || [])
      setTradeMode(s.mode === 'auto' ? 'auto' : 'manual')
    }).catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  async function toggleAccount(name: string) {
    if (!connected.includes(name)) return  // can't trade on un-tokened account
    const next = selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name]
    setSelected(next)
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedAccounts: next }),
    })
  }

  async function runEngine() {
    setLoading(true)
    try {
      const res = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          giftNiftyChangePct: -0.3,
          quotes: {},
          brokerRecs: [],
          cashAvailable: 50000,
          todayBuys: 0, todaySells: 0
        })
      })
      const data = await res.json()
      setScan(data)
    } catch {}
    finally { setLoading(false) }
  }

  async function executeRec(rec: Recommendation): Promise<{ accountResults: { account: string; ok: boolean; msg: string }[] }> {
    if (selected.length === 0) {
      return { accountResults: [{ account: '—', ok: false, msg: 'No account selected' }] }
    }
    const results = await Promise.all(selected.map(async account => {
      try {
        const res = await fetch('/api/zerodha', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account,
            action: 'place_order',
            order: {
              symbol: rec.symbol,
              symbolName: rec.name,
              quantity: rec.suggestedQty,
              transaction_type: 'BUY',
              price: rec.price,        // preflight uses this for funds + per-trade math
              target1: rec.target1,    // for the Trade Executed email
              target2: rec.target2,
              stopLoss: rec.stopLoss,
              source: rec.source,
              reason: rec.reason,
              tag: rec.strategy === 'oscillator' ? 'dt-s1' : 'dt-s2',  // routes to correct monitor
            },
          })
        })
        const data = await res.json()
        if (res.ok && data.data?.order_id) return { account, ok: true, msg: `Order ${data.data.order_id}` }
        if (res.ok) return { account, ok: true, msg: 'Placed' }
        // Preflight failures (422) — surface the gate name + reason.
        if (data.gate) return { account, ok: false, msg: `[${data.gate}] ${data.reason}` }
        return { account, ok: false, msg: data.reason || data.error || `HTTP ${res.status}` }
      } catch (e) {
        return { account, ok: false, msg: 'Network error' }
      }
    }))
    return { accountResults: results }
  }

  const modeColors: Record<string, string> = { catalyst:'#c9a84c', dip:'#52b788', circuit:'#e05a5e' }
  const modeLabels: Record<string, string> = {
    catalyst:"⚡ Catalyst Mode — Strategy 2 (Momentum) · scans 09:30–14:30 IST",
    dip:'📊 Dip Mode — Strategy 1 (Oscillator/EMA)',
    circuit:'🚨 Circuit Breaker — No Trades Today',
  }

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
          Trading <span className="gold-text">Engine</span>
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-[10px] tracking-widest uppercase px-2 py-1 rounded"
            style={{
              background: tradeMode === 'auto' ? 'rgba(82,183,136,0.12)' : 'rgba(201,168,76,0.12)',
              border: `1px solid ${tradeMode === 'auto' ? 'rgba(82,183,136,0.3)' : 'rgba(201,168,76,0.3)'}`,
              color: tradeMode === 'auto' ? '#52b788' : '#c9a84c',
              fontFamily:'JetBrains Mono, monospace',
            }}>
            {tradeMode === 'auto' ? '⚡ Auto' : '✋ Manual'}
          </span>
          <button onClick={runEngine} disabled={loading || selected.length === 0}
            className="px-5 py-2.5 rounded-xl text-[12px] font-semibold tracking-wider transition-all disabled:opacity-40"
            style={{ background:'linear-gradient(135deg, #7a5510, #c9a84c)', color:'#080604' }}>
            {loading ? '↻ Scanning…' : '↻ Refresh & Scan'}
          </button>
        </div>
      </div>

      {/* Account selector */}
      <div className="rounded-xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] tracking-widest uppercase"
            style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
            Execute on
          </p>
          <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.3)' }}>
            {selected.length} of {accounts.filter(a => connected.includes(a.name)).length} connected
          </p>
        </div>

        {!loaded && <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.3)' }}>Loading…</p>}

        {loaded && accounts.length === 0 && (
          <p className="text-[11px]" style={{ color:'rgba(224,90,94,0.7)' }}>No accounts configured.</p>
        )}

        {loaded && accounts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {accounts.map(acc => {
              const isConnected = connected.includes(acc.name)
              const isSelected = selected.includes(acc.name)
              return (
                <button key={acc.name} onClick={() => toggleAccount(acc.name)} disabled={!isConnected}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  title={isConnected ? '' : 'Connect this account in Settings first'}
                  style={{
                    background: isSelected ? `${acc.color}15` : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isSelected ? acc.color + '55' : 'rgba(255,255,255,0.08)'}`,
                    color: isSelected ? acc.color : 'rgba(255,255,255,0.5)',
                  }}>
                  <span className="w-4 h-4 rounded flex items-center justify-center text-[10px]"
                    style={{
                      background: isSelected ? acc.color : 'transparent',
                      border: `1px solid ${isSelected ? acc.color : 'rgba(255,255,255,0.2)'}`,
                      color: '#080604',
                    }}>
                    {isSelected ? '✓' : ''}
                  </span>
                  <span style={{ fontWeight: 500 }}>{acc.initials}</span>
                  <span style={{ opacity: 0.7 }}>{acc.displayName}</span>
                  {!isConnected && <span className="text-[9px] opacity-60">(not connected)</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Auto-mode banner */}
      {tradeMode === 'auto' && (
        <div className="rounded-xl px-4 py-3"
          style={{ background:'rgba(82,183,136,0.06)', border:'1px solid rgba(82,183,136,0.2)' }}>
          <p className="text-[12px]" style={{ color:'#52b788' }}>
            ⚡ Auto mode is on. The cron scans and executes every 5 minutes during market hours.
            You can still use Refresh + Execute below for ad-hoc runs.
          </p>
        </div>
      )}

      {/* Mode + limits */}
      {scan && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap"
          style={{
            background:`rgba(${scan.mode === 'catalyst' ? '201,168,76' : scan.mode === 'dip' ? '82,183,136' : '224,90,94'},0.08)`,
            border:`1px solid rgba(${scan.mode === 'catalyst' ? '201,168,76' : scan.mode === 'dip' ? '82,183,136' : '224,90,94'},0.2)`,
          }}>
          <p className="text-sm font-medium" style={{ color: modeColors[scan.mode] || '#fff' }}>
            {modeLabels[scan.mode] || scan.mode}
          </p>
          <div className="ml-auto flex gap-4 text-[11px]"
            style={{ fontFamily:'JetBrains Mono, monospace', color:'rgba(255,255,255,0.4)' }}>
            <span>Buys left: <span style={{ color:'#52b788' }}>{scan.limits?.buysRemaining ?? '—'}</span></span>
            <span>Sells left: <span style={{ color:'#52b788' }}>{scan.limits?.sellsRemaining ?? '—'}</span></span>
          </div>
        </div>
      )}

      {/* Empty / loading / results */}
      {!scan && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-5xl mb-4 opacity-30">⚡</div>
          <p className="text-base mb-2" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.5)', fontSize:'20px' }}>Ready to scan</p>
          <p className="text-[12px]" style={{ color:'rgba(255,255,255,0.25)' }}>
            {selected.length === 0 ? 'Select at least one account above, then press Refresh & Scan' : 'Press Refresh & Scan to run the strategy engine'}
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="text-3xl mb-3 animate-spin">⚡</div>
            <p className="text-[12px]" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>Scanning…</p>
          </div>
        </div>
      )}

      {scan?.recommendations && scan.recommendations.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[11px] tracking-widest uppercase"
              style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
              {scan.recommendations.length} Signal{scan.recommendations.length > 1 ? 's' : ''} Found
            </h2>
            {scan.priceSource && (
              <span className="text-[10px] tracking-widest uppercase px-2 py-0.5 rounded"
                style={{
                  background: scan.priceSource === 'kite_live' ? 'rgba(82,183,136,0.12)' : 'rgba(224,90,94,0.12)',
                  border: `1px solid ${scan.priceSource === 'kite_live' ? 'rgba(82,183,136,0.3)' : 'rgba(224,90,94,0.3)'}`,
                  color: scan.priceSource === 'kite_live' ? '#52b788' : 'rgba(224,90,94,0.85)',
                  fontFamily:'JetBrains Mono, monospace',
                }}>
                {scan.priceSource === 'kite_live' ? '✓ Kite live prices' : '⚠ Fallback (briefing) prices'}
              </span>
            )}
          </div>
          {scan.recommendations.map((rec, i) => (
            <RecCard key={i} rec={rec} tradeMode={tradeMode} onExecute={executeRec} accountCount={selected.length} />
          ))}
        </div>
      )}

      {scan && scan.recommendations?.length === 0 && !loading && (
        <div className="text-center py-12">
          <p className="text-4xl mb-3 opacity-30">—</p>
          <p className="text-base" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.4)', fontSize:'18px' }}>No signals</p>
          <p className="text-[12px] mt-1" style={{ color:'rgba(255,255,255,0.2)' }}>
            {scan.message || 'No stocks meet entry criteria right now. Check again in 30 minutes.'}
          </p>
        </div>
      )}

      {/* ── FULL SCAN TILES — every List A stock with per-rule pass/fail ── */}
      <EngineTilesSection
        firstAccount={selected[0] || connected[0] || null}
        accounts={accounts}
        connected={connected}
        tradeMode={tradeMode}
      />
    </div>
  )
}

function RecCard({ rec, tradeMode, onExecute, accountCount }: {
  rec: Recommendation
  tradeMode: TradeMode
  onExecute: (r: Recommendation) => Promise<{ accountResults: { account: string; ok: boolean; msg: string }[] }>
  accountCount: number
}) {
  const [executing, setExecuting] = useState(false)
  const [results, setResults] = useState<{ account: string; ok: boolean; msg: string }[] | null>(null)

  async function execute() {
    setExecuting(true)
    const { accountResults } = await onExecute(rec)
    setResults(accountResults)
    setExecuting(false)
  }

  const pnlPct1 = ((rec.target1 - rec.price) / rec.price * 100).toFixed(1)
  const pnlPct2 = ((rec.target2 - rec.price) / rec.price * 100).toFixed(1)
  const slPct   = ((rec.stopLoss - rec.price) / rec.price * 100).toFixed(1)

  return (
    <div className="rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${rec.confidence === 'high' ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.08)'}`,
        background: rec.confidence === 'high' ? 'rgba(201,168,76,0.04)' : 'rgba(255,255,255,0.02)',
      }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor:'rgba(255,255,255,0.06)' }}>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-base text-white" style={{ fontFamily:'JetBrains Mono, monospace' }}>{rec.symbol}</span>
            {rec.confidence === 'high' && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background:'rgba(201,168,76,0.2)', color:'#c9a84c' }}>HIGH CONF</span>}
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background:'rgba(82,183,136,0.15)', color:'#52b788' }}>
              {rec.strategy === 'catalyst' ? '⚡ Catalyst' : '📊 EMA Dip'}
            </span>
          </div>
          <p className="text-[11px] mt-0.5" style={{ color:'rgba(255,255,255,0.4)' }}>{rec.name} · {rec.source}</p>
        </div>
        <div className="text-right">
          {(() => {
            const chg = rec.dayChangePct
            const chgColor = chg === undefined ? 'rgba(255,255,255,0.8)'
              : chg > 0 ? '#52b788' : chg < 0 ? '#e05a5e' : 'rgba(255,255,255,0.7)'
            const arrow = chg === undefined ? '' : chg > 0 ? '▲' : chg < 0 ? '▼' : '─'
            return (
              <>
                <p className="text-xl font-medium" style={{ fontFamily:'JetBrains Mono, monospace', color: chgColor }}>₹{rec.price}</p>
                {chg !== undefined && (
                  <p className="text-[10px]" style={{ color: chgColor, fontFamily:'JetBrains Mono, monospace' }}>
                    {arrow} {Math.abs(chg).toFixed(2)}% today
                  </p>
                )}
                <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.3)' }}>Qty: {rec.suggestedQty}</p>
              </>
            )
          })()}
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-[11px] mb-3" style={{ color:'rgba(255,255,255,0.5)' }}>{rec.reason}</p>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { label:'T1', val:`₹${rec.target1}`, pct:`+${pnlPct1}%`, color:'#52b788' },
            { label:'T2', val:`₹${rec.target2}`, pct:`+${pnlPct2}%`, color:'#2d6a4f' },
            { label:'SL', val:`₹${rec.stopLoss}`, pct:`${slPct}%`, color:'#e05a5e' },
            { label:'Capital', val:`₹${(rec.price * rec.suggestedQty).toFixed(0)}`, pct:'', color:'rgba(255,255,255,0.5)' },
          ].map(item => (
            <div key={item.label} className="rounded-lg p-2 text-center" style={{ background:'rgba(255,255,255,0.03)' }}>
              <p className="text-[9px] mb-1" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{item.label}</p>
              <p className="text-[11px] font-medium" style={{ color:item.color, fontFamily:'JetBrains Mono, monospace' }}>{item.val}</p>
              {item.pct && <p className="text-[9px]" style={{ color:item.color }}>{item.pct}</p>}
            </div>
          ))}
        </div>

        {!results && (
          <button onClick={execute} disabled={executing || accountCount === 0}
            className="w-full py-3 rounded-lg font-bold tracking-wider uppercase text-[12px] transition-all disabled:opacity-40"
            style={{
              background:'linear-gradient(135deg, rgba(82,183,136,0.3), rgba(82,183,136,0.15))',
              border:'1px solid rgba(82,183,136,0.4)',
              color:'#52b788',
            }}>
            {executing
              ? `Placing on ${accountCount} account${accountCount === 1 ? '' : 's'}…`
              : `▶ Execute on ${accountCount} account${accountCount === 1 ? '' : 's'}`}
          </button>
        )}

        {results && (
          <div className="space-y-1.5">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded text-[11px]"
                style={{
                  background: r.ok ? 'rgba(82,183,136,0.08)' : 'rgba(224,90,94,0.08)',
                  border: `1px solid ${r.ok ? 'rgba(82,183,136,0.2)' : 'rgba(224,90,94,0.2)'}`,
                  color: r.ok ? '#52b788' : 'rgba(224,90,94,0.9)',
                }}>
                <span style={{ fontFamily:'JetBrains Mono, monospace' }}>{r.account}</span>
                <span>{r.ok ? '✓' : '✗'} {r.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────── TILES SECTION ───────────────────────────
//
// Full-scan view: every List A stock as a tile, each showing the 8 rules of
// the active strategy (Catalyst or Oscillator) as green / red rows, a score,
// and BUY / SELL actions. This sits below the existing Recommendations
// section — those stay as-is at the top of the page.

interface RuleEval {
  id: string
  label: string
  passed: boolean
  actual: string
  threshold?: string
  skipped?: boolean
}

interface Tile {
  symbol: string
  name: string
  ltp: number
  prevClose: number
  dayChangePct: number
  rules: RuleEval[]
  score: number
  total: number
  holding?: { qty: number; avgPrice: number; pnl: number }
}

interface TilesResponse {
  catalyst: Tile[]
  oscillator: Tile[]
  recommendedTab: 'catalyst' | 'oscillator'
  giftChangePct: number
  catalystScanOpen: boolean
  generatedAt: string
  fetchedAt: string
  message?: string
}

function EngineTilesSection({ firstAccount, accounts, connected, tradeMode }: {
  firstAccount: string | null
  accounts: AccountDisplay[]
  connected: string[]
  tradeMode: TradeMode
}) {
  const [tab, setTab] = useState<'catalyst' | 'oscillator'>('catalyst')
  const [tabManuallySet, setTabManuallySet] = useState(false)
  const [data, setData] = useState<TilesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [orderModal, setOrderModal] = useState<{
    open: boolean; symbol: string; side: 'BUY' | 'SELL'; ltp?: number; dayChangePct?: number; initialQty?: number
  }>({ open: false, symbol: '', side: 'BUY' })

  async function load() {
    if (!firstAccount) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/strategy/tiles?account=${encodeURIComponent(firstAccount)}&_t=${Date.now()}`, {
        method: 'POST', cache: 'no-store',
      })
      const json = await res.json()
      if (res.ok && Array.isArray(json.catalyst)) {
        setData(json)
        if (!tabManuallySet && json.recommendedTab) setTab(json.recommendedTab)
      } else {
        setError(json?.error || json?.message || `HTTP ${res.status}`)
      }
    } catch (e) {
      setError('Failed to load tiles')
    } finally {
      setLoading(false)
    }
  }

  // Initial load + 5-min auto-refresh
  useEffect(() => {
    load()
    const id = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstAccount])

  if (!firstAccount) {
    return (
      <div className="rounded-xl p-5 text-center"
        style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.15)' }}>
        <p className="text-[12px]" style={{ color:'rgba(201,168,76,0.7)' }}>Connect a Kite account in Settings to see the full-scan tiles.</p>
      </div>
    )
  }

  const tiles = data ? (tab === 'catalyst' ? data.catalyst : data.oscillator) : []
  const fullScore = tiles[0]?.total || 8

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.85)' }}>
            Full <span className="gold-text">Scan</span>
          </h2>
          <p className="text-[10px] mt-0.5" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>
            Every List A stock · per-rule pass/fail · auto-refreshes every 5 min
            {data?.fetchedAt && ` · fetched ${new Date(data.fetchedAt).toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' })}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg p-1" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
            {(['catalyst', 'oscillator'] as const).map(t => {
              const active = tab === t
              const isDefault = data?.recommendedTab === t
              return (
                <button key={t} onClick={() => { setTab(t); setTabManuallySet(true) }}
                  className="px-3 py-1.5 rounded-md text-[11px] transition-all"
                  style={{
                    background: active ? 'rgba(201,168,76,0.12)' : 'transparent',
                    border: active ? '1px solid rgba(201,168,76,0.3)' : '1px solid transparent',
                    color: active ? '#c9a84c' : 'rgba(255,255,255,0.5)',
                    fontFamily:'JetBrains Mono, monospace',
                  }}>
                  {t === 'catalyst' ? 'Catalyst' : 'Oscillator'}
                  {isDefault && !active && <span className="ml-1 text-[8px]" style={{ color:'rgba(201,168,76,0.6)' }}>·default</span>}
                </button>
              )
            })}
          </div>
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all"
            style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.2)', color:'#c9a84c' }}>
            {loading ? '↻ …' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg p-3" style={{ background:'rgba(224,90,94,0.05)', border:'1px solid rgba(224,90,94,0.2)' }}>
          <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.85)' }}>✗ {error}</p>
        </div>
      )}

      {tiles.length === 0 && !loading && !error && (
        <div className="text-center py-10">
          <p className="text-[12px]" style={{ color:'rgba(255,255,255,0.35)' }}>No tiles available — connect Kite and reload.</p>
        </div>
      )}

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(tile => (
          <TileCard key={tile.symbol} tile={tile} fullScore={fullScore} tradeMode={tradeMode}
            onBuy={() => setOrderModal({
              open: true, symbol: tile.symbol, side: 'BUY',
              ltp: tile.ltp, dayChangePct: tile.dayChangePct,
            })}
            onSell={() => setOrderModal({
              open: true, symbol: tile.symbol, side: 'SELL',
              ltp: tile.ltp, dayChangePct: tile.dayChangePct,
              initialQty: tile.holding?.qty,
            })}
          />
        ))}
      </div>

      {orderModal.open && firstAccount && (
        <OrderModal
          isOpen={true}
          onClose={() => setOrderModal({ ...orderModal, open: false })}
          symbol={orderModal.symbol}
          initialSide={orderModal.side}
          ltp={orderModal.ltp}
          dayChangePct={orderModal.dayChangePct}
          initialQty={orderModal.initialQty}
          accounts={accounts.filter(a => connected.includes(a.name))}
          defaultAccount={firstAccount}
          onSuccess={() => { setOrderModal({ ...orderModal, open: false }); load() }}
        />
      )}
    </div>
  )
}

function TileCard({ tile, fullScore, tradeMode, onBuy, onSell }: {
  tile: Tile
  fullScore: number
  tradeMode: TradeMode
  onBuy: () => void
  onSell: () => void
}) {
  // Border + BUY-button colour from score
  const fullPass = tile.score === fullScore
  const partialPass = tile.score >= fullScore - 2 && tile.score < fullScore   // 6-7 of 8
  const border = fullPass ? '#c9a84c' : partialPass ? '#f59e0b' : 'rgba(255,255,255,0.08)'
  const cardBg = fullPass ? 'rgba(201,168,76,0.05)' : 'rgba(255,255,255,0.02)'
  const buyBg = fullPass ? 'rgba(201,168,76,0.25)'
    : partialPass ? 'rgba(245,158,11,0.15)'
    : 'rgba(255,255,255,0.04)'
  const buyBd = fullPass ? '#c9a84c' : partialPass ? '#f59e0b' : 'rgba(255,255,255,0.12)'
  const buyColor = fullPass ? '#080604' : partialPass ? '#f59e0b' : 'rgba(255,255,255,0.5)'
  const dayChgColor = tile.dayChangePct > 0 ? '#52b788' : tile.dayChangePct < 0 ? '#e05a5e' : 'rgba(255,255,255,0.55)'
  const dayChgArrow = tile.dayChangePct > 0 ? '▲' : tile.dayChangePct < 0 ? '▼' : '─'

  // In Auto mode, the cron only fires on full-pass tiles. The button still
  // works in Manual contexts. Show "AUTO-FIRES" badge on full-pass tiles when
  // mode = auto so the user knows the cron is handling it.
  const autoFires = tradeMode === 'auto' && fullPass

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: cardBg, border: `1px solid ${border}` }}>
      {/* Header — symbol, LTP, today's % */}
      <div className="px-4 py-3 flex items-start justify-between"
        style={{ borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold truncate" style={{ color:'rgba(255,255,255,0.9)', fontFamily:'JetBrains Mono, monospace' }}>{tile.symbol}</span>
            {autoFires && (
              <span className="text-[8px] tracking-widest uppercase px-1.5 py-0.5 rounded font-semibold"
                style={{ background:'rgba(82,183,136,0.15)', color:'#52b788', border:'1px solid rgba(82,183,136,0.4)', fontFamily:'JetBrains Mono, monospace' }}>
                AUTO-FIRES
              </span>
            )}
          </div>
          <p className="text-[10px] mt-0.5 truncate" style={{ color:'rgba(255,255,255,0.4)' }}>{tile.name}</p>
        </div>
        <div className="text-right ml-2 flex-shrink-0">
          <p className="text-base" style={{ color: dayChgColor, fontFamily:'JetBrains Mono, monospace', fontWeight: 600 }}>
            ₹{tile.ltp.toFixed(2)}
          </p>
          <p className="text-[10px]" style={{ color: dayChgColor, fontFamily:'JetBrains Mono, monospace' }}>
            {dayChgArrow} {Math.abs(tile.dayChangePct).toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Rules */}
      <div className="px-4 py-2.5 space-y-1.5">
        {tile.rules.map(r => (
          <div key={r.id} className="flex items-start gap-2 text-[11px]" style={{ fontFamily:'JetBrains Mono, monospace' }}>
            <span style={{ color: r.skipped ? 'rgba(255,255,255,0.25)' : r.passed ? '#52b788' : '#e05a5e' }}>
              {r.skipped ? '○' : r.passed ? '✓' : '✗'}
            </span>
            <div className="flex-1 min-w-0">
              <span style={{ color: r.skipped ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.7)' }}>{r.label}</span>
              <span className="ml-1" style={{ color:'rgba(255,255,255,0.4)' }}>— {r.actual}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Score */}
      <div className="px-4 py-2 flex items-center justify-between"
        style={{ background:'rgba(255,255,255,0.02)', borderTop:'1px solid rgba(255,255,255,0.05)' }}>
        <span className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>
          Score
        </span>
        <span className="text-[12px]"
          style={{ color: fullPass ? '#c9a84c' : partialPass ? '#f59e0b' : 'rgba(255,255,255,0.5)', fontFamily:'JetBrains Mono, monospace', fontWeight: 600 }}>
          {tile.score} / {tile.total}
        </span>
      </div>

      {/* Holding (if any) */}
      {tile.holding && (
        <div className="px-4 py-2.5" style={{ background:'rgba(96,165,250,0.05)', borderTop:'1px solid rgba(96,165,250,0.15)' }}>
          <div className="flex items-center justify-between text-[10px]" style={{ fontFamily:'JetBrains Mono, monospace' }}>
            <span style={{ color:'rgba(96,165,250,0.85)' }}>HOLDING {tile.holding.qty} × ₹{tile.holding.avgPrice.toFixed(2)}</span>
            <span style={{ color: tile.holding.pnl >= 0 ? '#52b788' : '#e05a5e', fontWeight: 600 }}>
              {tile.holding.pnl >= 0 ? '+' : ''}₹{Math.round(tile.holding.pnl).toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 flex gap-2" style={{ borderTop:'1px solid rgba(255,255,255,0.05)' }}>
        <button onClick={onBuy}
          className="flex-1 py-2 rounded-md text-[11px] font-semibold tracking-wider transition-all"
          style={{ background: buyBg, border: `1px solid ${buyBd}`, color: buyColor }}>
          ▲ BUY
        </button>
        {tile.holding && (
          <button onClick={onSell}
            className="flex-1 py-2 rounded-md text-[11px] font-semibold tracking-wider transition-all"
            style={{ background:'rgba(224,90,94,0.12)', border:'1px solid rgba(224,90,94,0.35)', color:'#e05a5e' }}>
            ▼ SELL
          </button>
        )}
      </div>
    </div>
  )
}
