'use client'
import { useEffect, useRef, useState } from 'react'

const C = {
  card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A',
  body: '#475569', muted: '#94A3B8', primary: '#3B82F6',
  green: '#16A34A', greenBg: '#DCFCE7', red: '#DC2626', redBg: '#FEE2E2',
  amber: '#D97706', amberBg: '#FEF3C7', surface: '#F1F5FE',
}
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"

interface EngineStatus {
  cronMode: 'auto' | 'manual'
  kiteConnected: boolean
  marketOpen: boolean
  marketStatus: string
  buyCap: number; sellCap: number; perTrade: number; maxPositions: number
  buysToday: number; sellsToday: number
  strategies: Array<{ id: string; name: string; type: string; scanIntervalMin: number; active: boolean }>
  instanceHealth: { lastCronTickAt: string | null; kiteTokenStatus: string } | null
}

interface RuleEval { id: string; label: string; passed: boolean; actual: string; threshold?: string; skipped?: boolean }

interface Tile {
  symbol: string; name: string; ltp: number; prevClose: number; dayChangePct: number
  rules: RuleEval[]; score: number; total: number
  holding?: { qty: number; avgPrice: number; pnl: number }
}

interface StrategyInfo { id: string; name: string; type: string; color: string; scanIntervalMin: number }

interface TilesResult {
  tilesByStrategy: Record<string, Tile[]>
  activeStrategies: StrategyInfo[]
  recommendedTab: string
  giftChangePct: number
  catalystScanOpen: boolean
  generatedAt: string
  error?: string
}

interface KiteOrder {
  order_id: string; tradingsymbol: string; transaction_type: string
  quantity: number; filled_quantity?: number; average_price: number
  status: string; order_timestamp?: string; tag?: string
}

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
  return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`
}

function strategyColor(type: string): string {
  if (type === 'dip') return '#16A34A'
  if (type === 'momentum') return '#1D4ED8'
  if (type === 'pivotal') return '#D97706'
  return C.primary
}

function strategyEmoji(type: string): string {
  if (type === 'dip') return '📊'
  if (type === 'momentum') return '⚡'
  if (type === 'pivotal') return '🔶'
  return '▶'
}

// ── Stat Tile ──────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', boxShadow: '0 2px 8px rgba(30,58,138,0.04)' }}>
      <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: INTER }}>{label}</p>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: accent ?? C.heading, fontFamily: SORA }}>{value}</p>
      {sub && <p style={{ margin: '1px 0 0', fontSize: 10, color: C.muted, fontFamily: INTER }}>{sub}</p>}
    </div>
  )
}

// ── Symbol Tile ────────────────────────────────────────────────────────────────
function SymbolTile({ tile, canBuy, onBuy, marketOpen }: {
  tile: Tile; canBuy: boolean; marketOpen: boolean
  onBuy: (tile: Tile) => Promise<{ ok: boolean; msg: string }>
}) {
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const dayUp = tile.dayChangePct >= 0
  const pct = Math.min(100, Math.round((tile.score / tile.total) * 100))
  const barColor = pct >= 75 ? C.green : pct >= 50 ? C.amber : C.red

  async function handleBuy() {
    setBusy(true)
    const r = await onBuy(tile)
    setResult(r)
    setBusy(false)
  }

  return (
    <div style={{
      background: C.card, border: `1px solid ${pct >= 75 ? '#86EFAC' : C.border}`,
      borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 6px rgba(30,58,138,0.04)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Score bar */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${barColor} ${pct}%, #E2E8F0 ${pct}%)` }} />

      <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Symbol + price */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <p style={{ margin: 0, fontFamily: MONO, fontWeight: 700, fontSize: 14, color: C.heading }}>{tile.symbol}</p>
            <p style={{ margin: 0, fontSize: 10, color: C.muted, fontFamily: INTER }}>{tile.name}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontFamily: MONO, fontWeight: 700, fontSize: 14, color: C.heading }}>₹{tile.ltp.toFixed(2)}</p>
            <p style={{ margin: 0, fontSize: 10, fontFamily: MONO, color: dayUp ? C.green : C.red }}>
              {dayUp ? '▲' : '▼'} {Math.abs(tile.dayChangePct).toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Score bar + count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <div style={{ flex: 1, height: 3, borderRadius: 2, background: '#E2E8F0', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: INTER, color: barColor, flexShrink: 0 }}>
            {tile.score}/{tile.total}
          </span>
        </div>

        {/* Rules — one row per rule showing label + actual value + pass/fail */}
        <div style={{ flex: 1, marginBottom: 8 }}>
          {tile.rules.map(rule => (
            <div key={rule.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 6, padding: '3px 0',
              borderBottom: '1px solid #F1F5FE',
            }}>
              <span style={{
                fontSize: 11, fontFamily: INTER, color: rule.passed ? C.body : rule.skipped ? C.muted : C.red,
                flex: 1, minWidth: 0,
              }}>
                {rule.label}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, maxWidth: '45%' }}
                title={rule.actual + (rule.threshold ? ` · threshold: ${rule.threshold}` : '')}>
                <span style={{
                  fontSize: 10, fontFamily: MONO,
                  color: rule.passed ? C.green : rule.skipped ? C.muted : C.red,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {rule.actual}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: rule.passed ? C.green : rule.skipped ? C.muted : C.red, flexShrink: 0 }}>
                  {rule.passed ? '✓' : rule.skipped ? '○' : '✗'}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Holding row */}
        {tile.holding && tile.holding.qty > 0 && (
          <div style={{ padding: '4px 8px', borderRadius: 6, background: tile.holding.pnl >= 0 ? C.greenBg : C.redBg, marginBottom: 8 }}>
            <p style={{ margin: 0, fontSize: 10, fontFamily: MONO, color: tile.holding.pnl >= 0 ? C.green : C.red }}>
              Holding {tile.holding.qty}× @ ₹{tile.holding.avgPrice.toFixed(2)} · P&L ₹{tile.holding.pnl.toFixed(0)}
            </p>
          </div>
        )}

        {/* BUY button — pinned to bottom */}
        {!result ? (
          <button onClick={handleBuy} disabled={busy || !canBuy || !marketOpen} style={{
            width: '100%', padding: '8px 0', borderRadius: 6, marginTop: 'auto',
            border: canBuy && marketOpen ? `1px solid ${C.green}` : `1px solid ${C.border}`,
            background: canBuy && marketOpen ? C.greenBg : C.surface,
            color: canBuy && marketOpen ? C.green : C.muted,
            fontFamily: INTER, fontWeight: 700, fontSize: 12,
            cursor: canBuy && marketOpen && !busy ? 'pointer' : 'not-allowed',
            opacity: busy ? 0.7 : 1,
          }}>
            {busy ? '…' : !marketOpen ? '🔒 Market closed' : '▶ BUY'}
          </button>
        ) : (
          <div style={{ padding: '7px 8px', borderRadius: 6, background: result.ok ? C.greenBg : C.redBg, border: `1px solid ${result.ok ? C.green : C.red}`, color: result.ok ? C.green : C.red, fontFamily: INTER, fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
            {result.ok ? '✓' : '✗'} {result.msg}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Orders row ─────────────────────────────────────────────────────────────────
function OrderRow({ order, isLast }: { order: KiteOrder; isLast: boolean }) {
  const isBuy = order.transaction_type === 'BUY'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '56px 1.2fr 70px 56px 76px 76px', alignItems: 'center', padding: '8px 16px', borderBottom: isLast ? 'none' : `1px solid ${C.border}`, gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>{fmtTime(order.order_timestamp)}</span>
      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: C.heading }}>{order.tradingsymbol}</span>
      <span style={{ fontWeight: 700, fontSize: 11, color: isBuy ? C.green : C.red }}>{isBuy ? '▲ BUY' : '▼ SELL'}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.body, textAlign: 'right' }}>×{order.filled_quantity ?? order.quantity}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.body, textAlign: 'right' }}>₹{order.average_price?.toFixed(2) ?? '—'}</span>
      <span style={{ fontFamily: INTER, fontSize: 10, fontWeight: 600, textAlign: 'right', color: order.status === 'COMPLETE' ? C.green : order.status === 'REJECTED' || order.status === 'CANCELLED' ? C.red : C.amber }}>
        {order.status}
      </span>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function EnginePage() {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [tiles, setTiles] = useState<TilesResult | null>(null)
  const [orders, setOrders] = useState<KiteOrder[]>([])
  const [scanning, setScanning] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('')
  const [togglingMode, setTogglingMode] = useState(false)
  // Track the last cron tick timestamp to detect when a new tick fires
  const lastTickRef = useRef<string | null>(null)
  // Gate: only auto-refresh tiles after they've been loaded at least once
  const tilesLoadedRef = useRef(false)

  async function loadStatus() {
    try {
      const r = await fetch('/api/dalgo/customer/engine/status', { cache: 'no-store' })
      const d = await r.json()
      if (!d.error) setStatus(d)
    } catch {}
  }

  async function loadOrders() {
    try {
      const r = await fetch('/api/dalgo/customer/engine/orders', { cache: 'no-store' })
      const d = await r.json()
      if (Array.isArray(d.orders)) setOrders(d.orders)
    } catch {}
  }

  async function loadTiles() {
    setScanning(true)
    try {
      const r = await fetch('/api/dalgo/customer/engine/tiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })
      const d = await r.json()
      setTiles(d)
      tilesLoadedRef.current = true
      if (!activeTab && d.recommendedTab) setActiveTab(d.recommendedTab)
      loadOrders()
      loadStatus()
    } catch (e) {
      setTiles({ tilesByStrategy: {}, activeStrategies: [], recommendedTab: '', giftChangePct: 0, catalystScanOpen: false, generatedAt: new Date().toISOString(), error: String(e) })
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    loadStatus()
    loadOrders()
    const ordersId = setInterval(loadOrders, 30_000)
    const statusId = setInterval(loadStatus, 60_000)
    // Refresh tiles every 5 min matching cron cadence, but only after first manual load
    const tilesId = setInterval(() => { if (tilesLoadedRef.current) loadTiles() }, 5 * 60 * 1000)
    return () => { clearInterval(ordersId); clearInterval(statusId); clearInterval(tilesId) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Set default tab when tiles arrive with strategies
  useEffect(() => {
    if (tiles && !activeTab && tiles.recommendedTab) setActiveTab(tiles.recommendedTab)
    else if (tiles && !activeTab && tiles.activeStrategies.length > 0) setActiveTab(tiles.activeStrategies[0].id)
  }, [tiles, activeTab])

  async function toggleMode() {
    if (!status) return
    const next = status.cronMode === 'auto' ? 'manual' : 'auto'
    setTogglingMode(true)
    try {
      const r = await fetch('/api/dalgo/customer/mode', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next }) })
      if (r.ok) setStatus(s => s ? { ...s, cronMode: next } : s)
    } finally { setTogglingMode(false) }
  }

  async function executeOrder(tile: Tile): Promise<{ ok: boolean; msg: string }> {
    const perTrade = status?.perTrade ?? 20000
    const qty = tile.ltp > 0 ? Math.floor(perTrade / tile.ltp) : 0
    if (qty < 1) return { ok: false, msg: 'Price too high for per-trade cap' }
    const r = await fetch('/api/dalgo/customer/engine/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: tile.symbol, quantity: qty, price: tile.ltp }),
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
  const canBuy = (status?.kiteConnected ?? false) && (status?.marketOpen ?? false)
  const marketOpen = status?.marketOpen ?? false

  const modeColor = status?.cronMode === 'auto' ? C.green : C.amber
  const modeBg = status?.cronMode === 'auto' ? C.greenBg : C.amberBg

  const currentTiles = (tiles?.tilesByStrategy[activeTab] ?? [])
  const currentStrategy = tiles?.activeStrategies.find(s => s.id === activeTab)

  return (
    <div style={{ fontFamily: INTER }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontFamily: SORA, fontSize: 24, fontWeight: 700, color: C.heading, margin: 0 }}>
          Trading <span style={{ color: C.primary }}>Engine</span>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, background: modeBg, border: `1px solid ${modeColor}40`, fontFamily: INTER, fontSize: 12, fontWeight: 700, color: modeColor }}>
            {status?.cronMode === 'auto' ? '⚡ Auto Mode' : '✋ Manual Mode'}
          </span>
          <button onClick={toggleMode} disabled={togglingMode || !status} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.heading, fontFamily: INTER, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: togglingMode ? 0.5 : 1 }}>
            {togglingMode ? '…' : status?.cronMode === 'auto' ? 'Switch to Manual' : 'Switch to Auto'}
          </button>
          <button onClick={loadTiles} disabled={scanning || !status?.kiteConnected} title={!status?.kiteConnected ? 'Connect Kite in Settings first' : undefined} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: scanning || !status?.kiteConnected ? C.surface : `linear-gradient(135deg, ${C.primary}, #60A5FA)`, color: scanning || !status?.kiteConnected ? C.muted : '#fff', fontFamily: INTER, fontWeight: 700, fontSize: 13, cursor: scanning || !status?.kiteConnected ? 'not-allowed' : 'pointer' }}>
            {scanning ? '↻ Scanning…' : '↻ Refresh & Scan'}
          </button>
        </div>
      </div>

      {/* ── Status tiles ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <StatTile label="Market" value={status?.marketOpen ? '🟢 Open' : status ? '🔴 Closed' : '…'} sub={status?.marketStatus ?? '—'} accent={status?.marketOpen ? C.green : C.red} />
        <StatTile label="Kite" value={status == null ? '…' : status.kiteConnected ? 'Connected' : 'Disconnected'} sub={status?.kiteConnected ? 'Ready' : 'Connect in Settings'} accent={status?.kiteConnected ? C.green : C.red} />
        <StatTile label="BUYs today" value={`${buysToday.length} / ${status?.buyCap ?? '—'}`} sub={status ? `${Math.max(0, status.buyCap - buysToday.length)} left` : undefined} accent={C.green} />
        <StatTile label="SELLs today" value={`${sellsToday.length} / ${status?.sellCap ?? '—'}`} sub={status ? `${Math.max(0, status.sellCap - sellsToday.length)} left` : undefined} accent={C.red} />
      </div>

      {/* ── Auto mode banner ── */}
      {status?.cronMode === 'auto' && (
        <div style={{ background: C.greenBg, border: `1px solid ${C.green}40`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 12, color: C.green, fontFamily: INTER }}>
            ⚡ Auto mode — strategies run at their configured intervals. SELL monitors every 5 min.
            {' '}Refresh & Scan runs an immediate ad-hoc scan anytime.
          </p>
          {status.instanceHealth && (
            <p style={{ margin: '4px 0 0', fontSize: 10, color: C.green, opacity: 0.7, fontFamily: MONO }}>
              Last cron tick: {fmtLastTick(status.instanceHealth.lastCronTickAt)} · Token: {status.instanceHealth.kiteTokenStatus}
            </p>
          )}
        </div>
      )}

      {/* ── Kite warning ── */}
      {status && !status.kiteConnected && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}40`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 12, color: C.red, fontFamily: INTER }}>
            ⚠ Kite not connected. <a href="/settings" style={{ color: C.red, fontWeight: 700 }}>Settings</a> → Login with Kite.
          </p>
        </div>
      )}

      {/* ── Tiles section ── */}
      {tiles && (
        <>
          {/* Strategy tab selector */}
          {tiles.activeStrategies.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {tiles.activeStrategies.map(s => {
                const isActive = activeTab === s.id
                const sc = strategyColor(s.type)
                return (
                  <button key={s.id} onClick={() => setActiveTab(s.id)} style={{
                    padding: '8px 18px', borderRadius: 999, border: `1px solid ${isActive ? sc : C.border}`,
                    background: isActive ? `${sc}18` : C.card, color: isActive ? sc : C.body,
                    fontFamily: INTER, fontWeight: 700, fontSize: 12, cursor: 'pointer',
                    boxShadow: isActive ? `0 0 0 2px ${sc}30` : 'none',
                    transition: 'all 0.15s',
                  }}>
                    {strategyEmoji(s.type)} {s.name}
                    <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6 }}>
                      {tiles.tilesByStrategy[s.id]?.length ?? 0} stocks
                    </span>
                  </button>
                )
              })}
              {/* GIFT Nifty + scan time info */}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                {tiles.giftChangePct !== 0 && (
                  <span style={{ fontSize: 11, fontFamily: MONO, color: tiles.giftChangePct > 0 ? C.green : C.red }}>
                    GIFT Nifty {tiles.giftChangePct > 0 ? '+' : ''}{tiles.giftChangePct.toFixed(2)}%
                  </span>
                )}
                <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO }}>
                  {!status?.marketOpen && '(market closed · using last traded prices) · '}
                  {fmtTime(tiles.generatedAt)} IST
                </span>
              </div>
            </div>
          )}

          {/* Market-closed notice */}
          {!status?.marketOpen && tiles.activeStrategies.length > 0 && (
            <div style={{ background: C.amberBg, border: `1px solid ${C.amber}40`, borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 11, color: C.amber, fontFamily: INTER }}>
                🕐 Market is closed. Tiles show last traded prices and today's session data. BUY buttons are disabled until market reopens.
              </p>
            </div>
          )}

          {/* Tiles error */}
          {tiles.error && (
            <div style={{ background: C.redBg, border: `1px solid ${C.red}40`, borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 12, color: C.red, fontFamily: INTER }}>⚠ {tiles.error}</p>
            </div>
          )}

          {/* Tile grid for active tab */}
          {currentTiles.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                {currentStrategy && (
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: strategyColor(currentStrategy.type), fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {strategyEmoji(currentStrategy.type)} {currentStrategy.name} · {currentTiles.length} stocks
                  </h3>
                )}
                <span style={{ fontSize: 11, color: C.muted, fontFamily: INTER }}>
                  sorted by rule score — hover rule pills for details
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {currentTiles.map(tile => (
                  <SymbolTile key={tile.symbol} tile={tile} canBuy={canBuy} marketOpen={marketOpen} onBuy={executeOrder} />
                ))}
              </div>
            </div>
          )}

          {currentTiles.length === 0 && !tiles.error && activeTab && (
            <p style={{ fontSize: 13, color: C.muted, fontFamily: INTER }}>
              No stocks in this strategy's watchlist. Check your watchlist in Settings.
            </p>
          )}

          {tiles.activeStrategies.length === 0 && !tiles.error && (
            <p style={{ fontSize: 13, color: C.muted, fontFamily: INTER }}>
              No active strategies. Enable strategies in your settings to see tiles here.
            </p>
          )}
        </>
      )}

      {!tiles && !scanning && status && (
        <div style={{ background: status.marketOpen ? C.greenBg : C.amberBg, border: `1px solid ${status.marketOpen ? C.green : C.amber}40`, borderRadius: 10, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700, fontFamily: SORA, color: status.marketOpen ? C.green : C.amber }}>
              {status.marketOpen ? '🟢 Market is open' : '🔴 Market is closed'}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: status.marketOpen ? C.green : C.amber, fontFamily: INTER, opacity: 0.8 }}>
              {status.marketOpen
                ? 'Click Refresh & Scan to evaluate all strategies against live prices.'
                : 'Click Refresh & Scan to evaluate using last traded prices.'}
            </p>
          </div>
          {status.kiteConnected && (
            <button onClick={loadTiles} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: status.marketOpen ? C.green : C.amber, color: '#fff', fontFamily: INTER, fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
              ↻ Refresh & Scan
            </button>
          )}
        </div>
      )}

      {!tiles && !scanning && !status && (
        <div style={{ padding: '20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20, color: C.primary, opacity: 0.4 }}>⚡</span>
          <p style={{ margin: 0, fontSize: 13, color: C.muted, fontFamily: INTER }}>Loading…</p>
        </div>
      )}

      {scanning && (
        <div style={{ padding: '20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="animate-pulse" style={{ fontSize: 16, color: C.primary }}>⚡</span>
          <p style={{ margin: 0, fontSize: 13, color: C.muted, fontFamily: INTER }}>Scanning all strategies…</p>
        </div>
      )}

      {/* ── Today's orders ── */}
      {(completedOrders.length > 0 || pendingOrders.length > 0) && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(30,58,138,0.04)', marginTop: 20 }}>
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
