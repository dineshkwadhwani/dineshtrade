'use client'
import { useState, useEffect } from 'react'
import OrderModal from '@/components/OrderModal'
import { isMarketOpen } from '@/lib/market'

interface AccountDisplay { name: string; displayName: string; initials: string; color: string; note: string }

interface WatchlistEntry { nse: string; name: string; trades?: number; lastTraded?: string }
interface ListMeta { name: string }

export default function WatchlistPage() {
  const [activeTab, setActiveTab] = useState<string>('listA')
  const [search, setSearch] = useState('')
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [activeAccount, setActiveAccount] = useState<string | null>(null)
  const [heldSymbols, setHeldSymbols] = useState<Set<string>>(new Set())
  const [holdingsLoading, setHoldingsLoading] = useState(false)
  const [quotes, setQuotes] = useState<Record<string, { ltp: number; changePct: number }>>({})
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [quotesError, setQuotesError] = useState<string>('')
  const [invalidSymbols, setInvalidSymbols] = useState<string[]>([])
  const [orderModal, setOrderModal] = useState<{
    open: boolean; symbol: string; name?: string; side: 'BUY' | 'SELL'; ltp?: number; dayChangePct?: number
  }>({ open: false, symbol: '', side: 'BUY' })

  // Market hours gate — buy/sell hidden outside NSE hours. Re-evaluated each
  // minute so the buttons appear at 9:15 / disappear at 15:30 without a refresh.
  const [market, setMarket] = useState(() => isMarketOpen())
  useEffect(() => {
    const id = setInterval(() => setMarket(isMarketOpen()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Watchlist now lives in data/watchlist.json (editable from Manage Lists UI),
  // falling back to the bundled seed. Fetched via /api/watchlist on mount.
  const [lists, setLists] = useState<Record<string, WatchlistEntry[]>>({})
  const [meta, setMeta] = useState<Record<string, ListMeta>>({})
  useEffect(() => {
    fetch('/api/watchlist').then(r => r.json()).then(d => {
      setLists(d.lists || {})
      setMeta(d.meta || {})
    }).catch(() => {})
  }, [])

  // Display order: listA, listB, then any custom lists alphabetically
  const orderedKeys = Object.keys(lists).sort((a, b) => {
    if (a === 'listA') return -1
    if (b === 'listA') return 1
    if (a === 'listB') return -1
    if (b === 'listB') return 1
    return a.localeCompare(b)
  })

  // If activeTab no longer exists (list was deleted), fall back to first available
  useEffect(() => {
    if (orderedKeys.length > 0 && !orderedKeys.includes(activeTab)) setActiveTab(orderedKeys[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedKeys.join(',')])

  const raw = lists[activeTab] || []
  const filtered = raw.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.nse.toLowerCase().includes(search.toLowerCase())
  )

  // Load accounts + connection state
  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/state').then(r => r.json()),
    ]).then(([a, s]) => {
      setAccounts(a.accounts || [])
      const conn: string[] = s.accountsWithToken || []
      setConnected(conn)
      if (conn.length > 0) setActiveAccount(conn[0])
    }).catch(() => {})
  }, [])

  // Fetch holdings when active account changes
  useEffect(() => {
    if (!activeAccount) {
      setHeldSymbols(new Set())
      return
    }
    setHoldingsLoading(true)
    fetch(`/api/zerodha?account=${encodeURIComponent(activeAccount)}&action=holdings`)
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data?.data) ? data.data : []
        setHeldSymbols(new Set(list.map((h: any) => String(h.tradingsymbol).toUpperCase())))
      })
      .catch(() => setHeldSymbols(new Set()))
      .finally(() => setHoldingsLoading(false))
  }, [activeAccount])

  // Real NSE tradingsymbols are uppercase A-Z plus digits, & or -, no spaces,
  // typically ≤ 14 chars. Anything else (e.g. "NLC INDIA LIMITED") will be
  // rejected by Kite silently, so filter them up-front and surface them.
  function isValidKiteSymbol(s: string): boolean {
    if (!s || s.length > 14) return false
    return /^[A-Z0-9&\-]+$/.test(s)
  }

  // Fetch live LTPs for the whole watchlist. We batch into chunks of 50 because
  // Kite's /quote endpoint sometimes rejects the whole request if any symbol is
  // unrecognised — smaller batches isolate the bad ones so the rest still load.
  async function loadQuotes(account: string) {
    // De-dupe across all lists; a symbol can technically exist in only one list
    // anyway (POST enforces this) but defensive set in case data drifts.
    const setSym = new Set<string>()
    for (const k of Object.keys(lists)) for (const s of lists[k]) setSym.add(s.nse.toUpperCase())
    const rawSymbols = Array.from(setSym)
    const invalid = rawSymbols.filter(s => !isValidKiteSymbol(s))
    const allSymbols = rawSymbols.filter(isValidKiteSymbol)
    setInvalidSymbols(invalid)
    const BATCH = 50
    const chunks: string[][] = []
    for (let i = 0; i < allSymbols.length; i += BATCH) chunks.push(allSymbols.slice(i, i + BATCH))

    setQuotesLoading(true)
    setQuotesError('')
    const out: Record<string, { ltp: number; changePct: number }> = {}
    const errors: string[] = []

    for (const chunk of chunks) {
      const symParam = chunk.map(s => `NSE:${s}`).join(',')
      try {
        const res = await fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=quote&symbols=${encodeURIComponent(symParam)}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          errors.push(`HTTP ${res.status}: ${data?.error || data?.message || 'unknown'}`)
          continue
        }
        const kiteQuotes: Record<string, any> = data?.data || {}
        if (Object.keys(kiteQuotes).length === 0 && data?.message) {
          errors.push(String(data.message))
        }
        for (const [key, q] of Object.entries(kiteQuotes)) {
          const symbol = key.replace(/^NSE:/, '')
          const ltp = Number((q as any).last_price)
          const prevClose = Number((q as any).ohlc?.close)
          const changePct = prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0
          if (ltp > 0) out[symbol] = { ltp, changePct }
        }
      } catch (e) {
        errors.push(String(e).slice(0, 120))
      }
    }

    setQuotes(out)
    if (Object.keys(out).length === 0 && errors.length > 0) {
      // Surface a single representative error so the user knows why
      setQuotesError(errors[0])
    } else if (Object.keys(out).length < allSymbols.length && errors.length > 0) {
      setQuotesError(`Partial load — ${errors.length} chunk${errors.length === 1 ? '' : 's'} failed: ${errors[0]}`)
    }
    setQuotesLoading(false)
  }

  const totalSymbols = Object.values(lists).reduce((s, arr) => s + arr.length, 0)
  useEffect(() => {
    if (!activeAccount) { setQuotes({}); setQuotesError(''); return }
    if (totalSymbols === 0) return  // wait for /api/watchlist response
    loadQuotes(activeAccount)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount, totalSymbols])

  const connectedAccounts = accounts.filter(a => connected.includes(a.name))
  const activeColor = accounts.find(a => a.name === activeAccount)?.color || '#c9a84c'

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light dt-text-primary" style={{ fontFamily:'Cormorant Garamond, serif' }}>
          Watch<span className="gold-text">list</span>
        </h1>
        <div className="flex items-center gap-3">
          <p className="text-[10px] dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>
            Edit lists from Manage Lists
          </p>
          {activeAccount && (
            <button onClick={() => loadQuotes(activeAccount)} disabled={quotesLoading}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all dt-card-gold"
              style={{ color:'#c9a84c' }}>
              {quotesLoading ? '↻ Loading…' : '↻ Refresh'}
            </button>
          )}
        </div>
      </div>

      {quotesError && (
        <div className="rounded-xl p-3 dt-banner-error">
          <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)', fontFamily:'JetBrains Mono, monospace' }}>
            ✗ Live prices: {quotesError}
          </p>
          <p className="text-[10px] mt-1 dt-text-secondary">
            Most common causes: Kite access token expired (re-Login from Settings), Kite Connect plan doesn't include /quote, or one of the symbols isn't recognised by Kite.
          </p>
        </div>
      )}

      {invalidSymbols.length > 0 && (
        <div className="rounded-xl p-3 dt-banner-gold">
          <p className="text-[12px]" style={{ color:'rgba(245,158,11,0.95)', fontFamily:'JetBrains Mono, monospace' }}>
            ⚠ {invalidSymbols.length} entries in <span style={{ color:'#f59e0b' }}>watchlist.json</span> look like company names, not NSE tradingsymbols — Kite can't quote them.
          </p>
          <p className="text-[10px] mt-1 dt-text-secondary">
            Examples: {invalidSymbols.slice(0, 4).join(', ')}{invalidSymbols.length > 4 ? `, …+${invalidSymbols.length - 4} more` : ''}. Edit config/watchlist.json to use the actual NSE symbol (e.g. <code style={{ color:'#c9a84c' }}>NAZARA</code>, not <code style={{ color:'#c9a84c' }}>NAZARA TECHNOLOGIES LIMITED</code>).
          </p>
        </div>
      )}

      {/* Account picker — visible only when 2+ accounts connected */}
      {connectedAccounts.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[10px] tracking-widest uppercase dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>
            Holdings highlight:
          </p>
          <div className="flex gap-2 flex-wrap">
            {connectedAccounts.map(acc => {
              const isActive = activeAccount === acc.name
              return (
                <button key={acc.name} onClick={() => setActiveAccount(acc.name)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] transition-all"
                  style={{
                    background: isActive ? `${acc.color}15` : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isActive ? acc.color + '55' : 'rgba(255,255,255,0.08)'}`,
                    color: isActive ? acc.color : 'rgba(255,255,255,0.45)',
                  }}>
                  <span style={{ fontWeight: 500 }}>{acc.initials}</span>
                  <span>{acc.displayName}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Dynamic list tabs — driven by watchlist.meta */}
      <div className="flex gap-2 flex-wrap">
        {orderedKeys.map(key => {
          const active = activeTab === key
          const label = meta[key]?.name || key
          const count = (lists[key] || []).length
          return (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`px-5 py-2 rounded-lg text-[12px] font-medium tracking-wider transition-all ${active ? 'text-[#080604]' : 'dt-card text-white/40 hover:text-white/60'}`}
              style={{
                background: active ? 'linear-gradient(135deg, #8a6a1a, #c9a84c)' : undefined,
                border: active ? 'none' : undefined,
              }}>
              {label} <span className="ml-1.5 opacity-60">({count})</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search stocks…"
        className="w-full px-4 py-3 rounded-xl text-sm outline-none dt-card dt-text-primary" />

      {/* Legend */}
      <div className="flex gap-4 text-[10px] flex-wrap items-center dt-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background:`${activeColor}55` }}></span>
          Currently holding{activeAccount ? ` in ${activeAccount}` : ''}
        </span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#52b788]"></span> Positive today</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#e05a5e]"></span> Negative today</span>
        {quotesLoading && (
          <span style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>· loading live prices…</span>
        )}
        {!quotesLoading && Object.keys(quotes).length > 0 && (
          <span style={{ color:'#52b788', fontFamily:'JetBrains Mono, monospace' }}>· {Object.keys(quotes).length} live</span>
        )}
        {!market.open && (
          <span style={{ color:'rgba(245,158,11,0.85)', fontFamily:'JetBrains Mono, monospace' }}>· {market.status} — trading disabled</span>
        )}
      </div>

      {/* Stock list */}
      <div className="rounded-xl overflow-hidden dt-card">
        <div className="grid gap-2 px-4 py-2 text-[9px] tracking-widest uppercase items-center dt-table-head"
          style={{
            gridTemplateColumns: '2fr 0.9fr 0.8fr 0.9fr',
            fontFamily:'JetBrains Mono, monospace',
          }}>
          <span>Name</span>
          <span className="text-right">LTP</span>
          <span className="text-right">Today</span>
          <span className="text-right">Action</span>
        </div>
        {filtered.map((s, i) => {
          const sym = s.nse.toUpperCase()
          const symInvalid = !isValidKiteSymbol(sym)
          const held = heldSymbols.has(sym)
          const q = quotes[sym]
          const dir: 'up' | 'down' | 'flat' = !q ? 'flat' : q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : 'flat'
          const priceColor = dir === 'up' ? '#52b788' : dir === 'down' ? '#e05a5e' : 'rgba(255,255,255,0.55)'
          return (
            <div key={s.nse}
              className="grid gap-2 px-4 py-3 items-center transition-all hover:bg-white/5"
              style={{
                gridTemplateColumns: '2fr 0.9fr 0.8fr 0.9fr',
                borderBottom: i < filtered.length-1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                background: held ? `${activeColor}12` : 'transparent',
              }}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] truncate dt-text-secondary">{s.name}</span>
                {held && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background:`${activeColor}25`, color: activeColor, border:`1px solid ${activeColor}50`, fontFamily:'JetBrains Mono, monospace' }}>
                    HELD
                  </span>
                )}
              </div>
              <span className="text-right text-sm" style={{ fontFamily:'JetBrains Mono, monospace', color: symInvalid ? '#f59e0b' : priceColor }}>
                {symInvalid ? 'INVALID' : q ? `₹${q.ltp.toFixed(2)}` : '—'}
              </span>
              <span className="text-right text-[11px] whitespace-nowrap" style={{ fontFamily:'JetBrains Mono, monospace', color: symInvalid ? 'rgba(245,158,11,0.7)' : priceColor }}>
                {symInvalid
                  ? 'fix in json'
                  : q
                  ? `${Math.abs(q.changePct).toFixed(2)}%`
                  : '—'}
              </span>
              <div className="flex gap-1 justify-end">
                <button onClick={() => setOrderModal({ open: true, symbol: sym, name: s.name, side: 'BUY', ltp: q?.ltp, dayChangePct: q?.changePct })}
                  disabled={!activeAccount || !market.open}
                  title={!market.open ? 'Market closed' : undefined}
                  className="px-2 py-1 rounded text-[10px] font-semibold tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(82,183,136,0.12)', border: '1px solid rgba(82,183,136,0.3)', color: '#52b788' }}>
                  <span className="sm:hidden">B</span><span className="hidden sm:inline">Buy</span>
                </button>
                <button onClick={() => setOrderModal({ open: true, symbol: sym, name: s.name, side: 'SELL', ltp: q?.ltp, dayChangePct: q?.changePct })}
                  disabled={!activeAccount || !market.open}
                  title={!market.open ? 'Market closed' : undefined}
                  className="px-2 py-1 rounded text-[10px] font-semibold tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(224,90,94,0.12)', border: '1px solid rgba(224,90,94,0.3)', color: '#e05a5e' }}>
                  <span className="sm:hidden">S</span><span className="hidden sm:inline">Sell</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <OrderModal
        isOpen={orderModal.open}
        onClose={() => setOrderModal({ ...orderModal, open: false })}
        symbol={orderModal.symbol}
        symbolName={orderModal.name}
        initialSide={orderModal.side}
        ltp={orderModal.ltp}
        dayChangePct={orderModal.dayChangePct}
        accounts={connectedAccounts}
        defaultAccount={activeAccount ?? undefined}
        onSuccess={() => {
          // Refresh holdings highlight after a successful order
          if (activeAccount) {
            fetch(`/api/zerodha?account=${encodeURIComponent(activeAccount)}&action=holdings`)
              .then(r => r.json())
              .then(d => {
                const list = Array.isArray(d?.data) ? d.data : []
                setHeldSymbols(new Set(list.map((h: any) => String(h.tradingsymbol).toUpperCase())))
              })
              .catch(() => {})
          }
        }} />

      <p className="text-[10px] text-center pb-2 dt-text-muted">
        {connectedAccounts.length === 0
          ? 'Connect at least one account in Settings to see live prices + HOLDING highlight'
          : `${heldSymbols.size} held in ${activeAccount} · ${Object.keys(quotes).length} live quotes from Kite`}
      </p>
    </div>
  )
}
