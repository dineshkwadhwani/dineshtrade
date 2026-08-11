'use client'
import { useState, useEffect } from 'react'
import OrderButton from '@/components/app/OrderButton'

interface WatchlistEntry { nse: string; name: string; trades?: number; lastTraded?: string }
interface ListMeta { name: string }

export default function WatchlistPage() {
  const [activeTab, setActiveTab] = useState<string>('listA')
  const [search, setSearch] = useState('')
  const [kiteConnected, setKiteConnected] = useState(false)
  const [marketOpen, setMarketOpen] = useState(false)
  const [heldSymbols, setHeldSymbols] = useState<Set<string>>(new Set())
  const [quotes, setQuotes] = useState<Record<string, { ltp: number; changePct: number }>>({})
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [quotesError, setQuotesError] = useState<string>('')
  const [invalidSymbols, setInvalidSymbols] = useState<string[]>([])
  const [lists, setLists] = useState<Record<string, WatchlistEntry[]>>({})
  const [meta, setMeta] = useState<Record<string, ListMeta>>({})

  useEffect(() => {
    fetch('/api/watchlist').then(r => r.json()).then(d => {
      setLists(d.lists || {})
      setMeta(d.meta || {})
    }).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/dalgo/customer/engine/status', { cache: 'no-store' }).then(r => r.json()).then(d => {
      setKiteConnected(!!d.kiteConnected)
      setMarketOpen(!!d.marketOpen)
    }).catch(() => {})
    // Load today's orders to approximate held symbols
    fetch('/api/dalgo/customer/engine/orders', { cache: 'no-store' }).then(r => r.json()).then(d => {
      const held = new Set<string>()
      for (const o of (d.orders ?? [])) {
        if (o.transaction_type === 'BUY' && o.status === 'COMPLETE') held.add(String(o.tradingsymbol).toUpperCase())
      }
      setHeldSymbols(held)
    }).catch(() => {})
  }, [])

  function isValidKiteSymbol(s: string): boolean {
    if (!s || s.length > 14) return false
    return /^[A-Z0-9&\-]+$/.test(s)
  }

  async function loadQuotes() {
    const setSym = new Set<string>()
    for (const k of Object.keys(lists)) for (const s of lists[k]) setSym.add(s.nse.toUpperCase())
    const rawSymbols = Array.from(setSym)
    const invalid = rawSymbols.filter(s => !isValidKiteSymbol(s))
    const allSymbols = rawSymbols.filter(isValidKiteSymbol)
    setInvalidSymbols(invalid)
    if (allSymbols.length === 0) return

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
        const res = await fetch(`/api/dalgo/customer/quotes?symbols=${encodeURIComponent(symParam)}`)
        const data = await res.json().catch(() => ({}))
        if (data.error) { errors.push(data.error); continue }
        const kiteQuotes: Record<string, any> = data.quotes || {}
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
    if (Object.keys(out).length === 0 && errors.length > 0) setQuotesError(errors[0])
    setQuotesLoading(false)
  }

  const orderedKeys = Object.keys(lists).sort((a, b) => {
    if (a === 'listA') return -1; if (b === 'listA') return 1
    if (a === 'listB') return -1; if (b === 'listB') return 1
    return a.localeCompare(b)
  })

  useEffect(() => {
    if (orderedKeys.length > 0 && !orderedKeys.includes(activeTab)) setActiveTab(orderedKeys[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedKeys.join(',')])

  const raw = lists[activeTab] || []
  const filtered = raw.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.nse.toLowerCase().includes(search.toLowerCase())
  )

  const totalSymbols = Object.values(lists).reduce((s, arr) => s + arr.length, 0)
  useEffect(() => {
    if (totalSymbols === 0) return
    loadQuotes()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSymbols])

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light dt-text-primary" style={{ fontFamily:'Cormorant Garamond, serif' }}>
          Watch<span className="accent-text">list</span>
        </h1>
        <div className="flex items-center gap-3">
          <p className="text-[10px] dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>Edit lists from Manage Lists</p>
          <button onClick={loadQuotes} disabled={quotesLoading}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all dt-card-accent"
            style={{ color:'#7fd1ff' }}>
            {quotesLoading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {quotesError && (
        <div className="rounded-xl p-3 dt-banner-error">
          <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)', fontFamily:'JetBrains Mono, monospace' }}>✗ Live prices: {quotesError}</p>
        </div>
      )}

      {invalidSymbols.length > 0 && (
        <div className="rounded-xl p-3 dt-banner-accent">
          <p className="text-[12px]" style={{ color:'rgba(245,158,11,0.95)', fontFamily:'JetBrains Mono, monospace' }}>
            ⚠ {invalidSymbols.length} entries look like company names, not NSE symbols — Kite can't quote them.
          </p>
          <p className="text-[10px] mt-1 dt-text-secondary">Examples: {invalidSymbols.slice(0, 4).join(', ')}{invalidSymbols.length > 4 ? `, …+${invalidSymbols.length - 4} more` : ''}.</p>
        </div>
      )}

      {/* List tabs */}
      <div className="flex gap-2 flex-wrap">
        {orderedKeys.map(key => {
          const active = activeTab === key
          return (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`px-5 py-2 rounded-lg text-[12px] font-medium tracking-wider transition-all ${active ? 'text-[#080604]' : 'dt-card text-white/40 hover:text-white/60'}`}
              style={{ background: active ? 'linear-gradient(135deg, #8a6a1a, #c9a84c)' : undefined, border: active ? 'none' : undefined }}>
              {meta[key]?.name || key} <span className="ml-1.5 opacity-60">({(lists[key] || []).length})</span>
            </button>
          )
        })}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search stocks…"
        className="w-full px-4 py-3 rounded-xl text-sm outline-none dt-card dt-text-primary" />

      <div className="flex gap-4 text-[10px] flex-wrap items-center dt-text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#c9a84c]/30"></span> Currently holding</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#52b788]"></span> Positive today</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#e05a5e]"></span> Negative today</span>
        {quotesLoading && <span style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>· loading prices…</span>}
        {!quotesLoading && Object.keys(quotes).length > 0 && <span style={{ color:'#52b788', fontFamily:'JetBrains Mono, monospace' }}>· {Object.keys(quotes).length} live</span>}
      </div>

      <div className="rounded-xl overflow-hidden dt-card">
        <div className="grid gap-2 px-4 py-2 text-[9px] tracking-widest uppercase items-center dt-table-head"
          style={{ gridTemplateColumns: '2fr 0.9fr 0.7fr auto', fontFamily:'JetBrains Mono, monospace' }}>
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
          const dir = !q ? 'flat' : q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : 'flat'
          const priceColor = dir === 'up' ? '#52b788' : dir === 'down' ? '#e05a5e' : 'rgba(255,255,255,0.55)'
          return (
            <div key={s.nse}
              className="grid gap-2 px-4 py-3 items-center transition-all hover:bg-white/5"
              style={{
                gridTemplateColumns: '2fr 0.9fr 0.7fr auto',
                borderBottom: i < filtered.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                background: held ? 'rgba(201,168,76,0.08)' : 'transparent',
              }}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] truncate dt-text-secondary">{s.name}</span>
                {held && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background:'rgba(201,168,76,0.2)', color:'#c9a84c', border:'1px solid rgba(201,168,76,0.4)', fontFamily:'JetBrains Mono, monospace' }}>
                    HELD
                  </span>
                )}
              </div>
              <span className="text-right text-sm" style={{ fontFamily:'JetBrains Mono, monospace', color: symInvalid ? '#f59e0b' : priceColor }}>
                {symInvalid ? 'INVALID' : q ? `₹${q.ltp.toFixed(2)}` : '—'}
              </span>
              <span className="text-right text-[11px] whitespace-nowrap" style={{ fontFamily:'JetBrains Mono, monospace', color: symInvalid ? 'rgba(245,158,11,0.7)' : priceColor }}>
                {symInvalid ? 'fix' : q ? `${Math.abs(q.changePct).toFixed(2)}%` : '—'}
              </span>
              <div className="flex items-center gap-1 justify-end">
                {!symInvalid && q && (
                  <>
                    <OrderButton symbol={sym} side="BUY" quantity={Math.max(1, Math.floor(20000 / q.ltp))} price={q.ltp} disabled={!kiteConnected || !marketOpen} size="sm" />
                    {held && <OrderButton symbol={sym} side="SELL" quantity={1} price={q.ltp} disabled={!kiteConnected || !marketOpen} size="sm" />}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-center pb-2 dt-text-muted">
        {!kiteConnected
          ? 'Connect Kite in Settings to see live prices and place orders'
          : `${heldSymbols.size} held · ${Object.keys(quotes).length} live quotes · ${marketOpen ? 'market open' : 'market closed — orders disabled'}`}
      </p>
    </div>
  )
}
