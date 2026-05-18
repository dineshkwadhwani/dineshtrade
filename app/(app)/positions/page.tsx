'use client'
import { useEffect, useState } from 'react'
import OrderModal, { type AccountDisplay } from '@/components/OrderModal'
import type { EnrichedPosition, PositionTag } from '@/app/api/positions/route'

export default function PositionsPage() {
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [positions, setPositions] = useState<EnrichedPosition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  // Square-off modal — uses OrderModal pre-filled with SELL + held qty + the
  // position's product so it lines up with what's actually held in Kite.
  const [squareOff, setSquareOff] = useState<EnrichedPosition | null>(null)

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
    setLoading(true); setError(''); setPositions([])
    try {
      const res = await fetch(`/api/positions?account=${encodeURIComponent(account)}`).then(r => r.json())
      if (res.error) setError(res.error)
      else if (Array.isArray(res.positions)) setPositions(res.positions)
    } catch {
      setError('Failed to load positions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab) load(activeTab)
  }, [activeTab])

  const openCount = positions.filter(p => p.qty !== 0).length
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealized, 0)
  const totalRealized = positions.reduce((s, p) => s + p.realized, 0)
  const totalPnl = totalUnrealized + totalRealized
  const capitalDeployed = positions.filter(p => p.qty > 0).reduce((s, p) => s + p.qty * p.avgPrice, 0)
  const activeAccount = accounts.find(a => a.name === activeTab)

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
          Today's <span className="gold-text">Positions</span>
        </h1>
        {activeTab && (
          <button onClick={() => load(activeTab)} disabled={loading}
            className="px-4 py-2 rounded-lg text-[11px] font-medium transition-all"
            style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.2)', color:'#c9a84c' }}>
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        )}
      </div>

      <AccountTabs accounts={accounts} connected={connected} active={activeTab} onSelect={setActiveTab} loaded={loaded} />

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
              { label:'Open Positions', val: String(openCount), color: activeAccount?.color || '#c9a84c' },
              { label:'Capital Deployed', val:`₹${Math.round(capitalDeployed).toLocaleString('en-IN')}`, color:'#c9a84c' },
              { label:'Unrealized', val: signedRupees(totalUnrealized), color: totalUnrealized >= 0 ? '#52b788' : '#e05a5e' },
              { label:'Day P&L (incl. closed)', val: signedRupees(totalPnl), color: totalPnl >= 0 ? '#52b788' : '#e05a5e' },
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

          {positions.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="grid grid-cols-12 px-4 py-2.5 text-[9px] tracking-widest uppercase"
                style={{ background:'rgba(255,255,255,0.02)', color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                <span className="col-span-3">Symbol</span>
                <span className="col-span-1 text-right">Qty</span>
                <span className="col-span-2 text-right">Avg</span>
                <span className="col-span-2 text-right">LTP</span>
                <span className="col-span-2 text-right">P&L</span>
                <span className="col-span-2 text-right">Action</span>
              </div>
              {positions.map((p, i) => (
                <PositionRow key={p.symbol + i} p={p} last={i === positions.length - 1}
                  onSquareOff={() => setSquareOff(p)} />
              ))}
            </div>
          )}

          {!loading && !error && positions.length === 0 && (
            <div className="text-center py-16">
              <p className="text-4xl mb-3 opacity-20">∅</p>
              <p className="text-base" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.35)', fontSize:'18px' }}>No positions today</p>
            </div>
          )}
        </>
      )}

      {squareOff && activeTab && (
        <OrderModal
          isOpen={true}
          onClose={() => setSquareOff(null)}
          symbol={squareOff.symbol}
          initialSide="SELL"
          initialQty={squareOff.qty}
          initialProduct={squareOff.product === 'MIS' ? 'MIS' : 'CNC'}
          ltp={squareOff.ltp}
          accounts={accounts.filter(a => a.name === activeTab)}
          defaultAccount={activeTab}
          onSuccess={() => { setSquareOff(null); load(activeTab) }}
        />
      )}
    </div>
  )
}

function PositionRow({ p, last, onSquareOff }: {
  p: EnrichedPosition; last: boolean; onSquareOff: () => void
}) {
  const isOpen = p.qty !== 0
  const uColor = p.unrealized >= 0 ? '#52b788' : '#e05a5e'
  const rColor = p.realized > 0 ? '#52b788' : p.realized < 0 ? '#e05a5e' : 'rgba(255,255,255,0.35)'
  const chgPct = p.avgPrice > 0 ? ((p.ltp - p.avgPrice) / p.avgPrice) * 100 : 0
  return (
    <div className="grid grid-cols-12 px-4 py-3 items-center text-[12px] transition-all hover:bg-white/5"
      style={{ borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.04)', opacity: isOpen ? 1 : 0.55 }}>
      <div className="col-span-3 flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-white/85" style={{ fontFamily:'JetBrains Mono, monospace' }}>{p.symbol}</span>
        <TagPill tag={p.tag} />
        {!isOpen && (
          <span className="text-[8px] tracking-widest uppercase px-1.5 py-0.5 rounded"
            style={{ background:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>
            CLOSED
          </span>
        )}
        <span className="text-[8px] tracking-widest uppercase px-1.5 py-0.5 rounded"
          style={{ background:'rgba(255,255,255,0.04)', color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>
          {p.product}
        </span>
      </div>
      <span className="col-span-1 text-right text-white/70" style={{ fontFamily:'JetBrains Mono, monospace' }}>{p.qty}</span>
      <span className="col-span-2 text-right text-white/70" style={{ fontFamily:'JetBrains Mono, monospace' }}>
        {p.avgPrice > 0 ? `₹${p.avgPrice.toFixed(2)}` : '—'}
      </span>
      <span className="col-span-2 text-right" style={{ fontFamily:'JetBrains Mono, monospace' }}>
        <div className="text-white/80">{p.ltp > 0 ? `₹${p.ltp.toFixed(2)}` : '—'}</div>
        {isOpen && p.avgPrice > 0 && (
          <div className="text-[9px] mt-0.5" style={{ color: chgPct >= 0 ? '#52b788' : '#e05a5e' }}>
            {chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%
          </div>
        )}
      </span>
      <span className="col-span-2 text-right" style={{ fontFamily:'JetBrains Mono, monospace' }}>
        <div className="font-semibold" style={{ color: isOpen ? uColor : 'rgba(255,255,255,0.35)' }}>
          {isOpen ? signedRupees(p.unrealized) : '—'}
        </div>
        {p.realized !== 0 && (
          <div className="text-[9px] mt-0.5" style={{ color: rColor }}>
            realized {signedRupees(p.realized)}
          </div>
        )}
      </span>
      <div className="col-span-2 text-right">
        {isOpen ? (
          <button onClick={onSquareOff}
            className="px-3 py-1.5 rounded-md text-[10px] font-semibold tracking-wider transition-all hover:scale-105"
            style={{
              background:'rgba(224,90,94,0.12)', border:'1px solid rgba(224,90,94,0.4)',
              color:'#e05a5e', fontFamily:'JetBrains Mono, monospace',
            }}>
            × SQUARE OFF
          </button>
        ) : (
          <span className="text-[10px]" style={{ color:'rgba(255,255,255,0.25)' }}>—</span>
        )}
      </div>
    </div>
  )
}

function TagPill({ tag }: { tag: PositionTag }) {
  const { color, label } = tagStyle(tag)
  return (
    <span className="text-[8px] tracking-widest uppercase px-1.5 py-0.5 rounded font-semibold"
      style={{ background:`${color}22`, color, border:`1px solid ${color}55`, fontFamily:'JetBrains Mono, monospace' }}>
      {label}
    </span>
  )
}

function tagStyle(tag: PositionTag): { color: string; label: string } {
  switch (tag) {
    case 's1':     return { color:'#c9a84c', label:'S1' }
    case 's2':     return { color:'#60a5fa', label:'S2' }
    case 'manual': return { color:'#a78bfa', label:'MANUAL' }
    case 'pre':    return { color:'rgba(255,255,255,0.5)', label:'OOS' }
    case 'mixed':  return { color:'#f59e0b', label:'MIXED' }
  }
}

function signedRupees(n: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  const abs = Math.abs(Math.round(n)).toLocaleString('en-IN')
  return n >= 0 ? `+₹${abs}` : `-₹${abs}`
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
