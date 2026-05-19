'use client'
import { useEffect, useMemo, useState } from 'react'

interface Entry {
  nse: string
  name: string
  trades?: number
  lastTraded?: string
}

interface Watchlist {
  generated?: string
  listA: Entry[]
  listB: Entry[]
}

interface SearchResult {
  token: number
  symbol: string
  name: string
}

type ListKey = 'listA' | 'listB'

export default function ManageListsPage() {
  const [wl, setWl] = useState<Watchlist | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')

  // Holdings indicator — fetch from the first connected account so each list
  // row can show a suitcase icon if you currently hold that symbol.
  const [heldSymbols, setHeldSymbols] = useState<Set<string>>(new Set())

  // Search state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [addTarget, setAddTarget] = useState<ListKey>('listA')

  // Initial load — watchlist + holdings in parallel
  useEffect(() => {
    fetch('/api/watchlist').then(r => r.json()).then((d: Watchlist) => {
      setWl({ listA: d.listA || [], listB: d.listB || [], generated: d.generated })
    }).catch(() => setError('Failed to load watchlist'))
    fetch('/api/state').then(r => r.json()).then(async s => {
      const accs: string[] = s.accountsWithToken || []
      if (accs.length === 0) return
      const r = await fetch(`/api/zerodha?account=${encodeURIComponent(accs[0])}&action=holdings`).then(r => r.json()).catch(() => null)
      if (Array.isArray(r?.data)) {
        setHeldSymbols(new Set(r.data.map((h: any) => String(h.tradingsymbol).toUpperCase())))
      }
    }).catch(() => { /* holdings is best-effort decoration */ })
  }, [])

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/watchlist/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        if (res.ok) setResults(data.results || [])
        else setResults([])
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const existingSet = useMemo(() => {
    if (!wl) return new Set<string>()
    return new Set([...wl.listA.map(e => e.nse), ...wl.listB.map(e => e.nse)])
  }, [wl])

  function add(target: ListKey, r: SearchResult) {
    if (!wl) return
    if (existingSet.has(r.symbol)) {
      setError(`${r.symbol} already in ${wl.listA.find(e => e.nse === r.symbol) ? 'List A' : 'List B'}`)
      setTimeout(() => setError(''), 2500)
      return
    }
    const entry: Entry = { nse: r.symbol, name: r.name || r.symbol }
    const next = { ...wl, [target]: [...wl[target], entry] }
    setWl(next); setDirty(true)
    setQuery(''); setResults([])
  }

  function remove(list: ListKey, symbol: string) {
    if (!wl) return
    const next = { ...wl, [list]: wl[list].filter(e => e.nse !== symbol) }
    setWl(next); setDirty(true)
  }

  function move(from: ListKey, to: ListKey, symbol: string) {
    if (!wl) return
    const entry = wl[from].find(e => e.nse === symbol)
    if (!entry) return
    const next = {
      ...wl,
      [from]: wl[from].filter(e => e.nse !== symbol),
      [to]: [...wl[to], entry],
    }
    setWl(next); setDirty(true)
  }

  async function save() {
    if (!wl) return
    setSaving(true); setError(''); setOkMsg('')
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listA: wl.listA, listB: wl.listB }),
      })
      const data = await res.json()
      if (res.ok) {
        setDirty(false)
        setOkMsg(`Saved · ${data.counts.listA} in A, ${data.counts.listB} in B`)
        setTimeout(() => setOkMsg(''), 3000)
      } else {
        setError(data.error || `HTTP ${res.status}`)
      }
    } catch (e) {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (!wl) {
    return (
      <div className="p-8 text-center" style={{ color:'rgba(255,255,255,0.4)' }}>
        Loading watchlist…
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
            Manage <span className="gold-text">Lists</span>
          </h1>
          <p className="text-[10px] mt-1" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>
            List A is scanned by strategies · List B is the reserve · saves take effect immediately, no restart
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <span className="text-[11px]" style={{ color:'#f59e0b', fontFamily:'JetBrains Mono, monospace' }}>
              ● unsaved changes
            </span>
          )}
          <button onClick={save} disabled={!dirty || saving}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold tracking-wider transition-all disabled:opacity-40"
            style={{
              background: dirty ? 'linear-gradient(135deg, #8a6a1a, #c9a84c)' : 'rgba(255,255,255,0.04)',
              color: dirty ? '#080604' : 'rgba(255,255,255,0.4)',
              border: dirty ? 'none' : '1px solid rgba(255,255,255,0.08)',
            }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg p-3" style={{ background:'rgba(224,90,94,0.06)', border:'1px solid rgba(224,90,94,0.25)' }}>
          <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)' }}>✗ {error}</p>
        </div>
      )}
      {okMsg && (
        <div className="rounded-lg p-3" style={{ background:'rgba(82,183,136,0.06)', border:'1px solid rgba(82,183,136,0.25)' }}>
          <p className="text-[12px]" style={{ color:'#52b788' }}>✓ {okMsg}</p>
        </div>
      )}

      {/* SEARCH BAR */}
      <div className="rounded-xl p-4" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(201,168,76,0.15)' }}>
        <p className="text-[10px] tracking-widest uppercase mb-2"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Add new symbol
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Type symbol or company name (e.g. BAJFINANCE, Reliance, HDFC)…"
            className="flex-1 px-3 py-2 rounded-lg text-[13px] outline-none"
            style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.85)' }} />
          <select value={addTarget} onChange={e => setAddTarget(e.target.value as ListKey)}
            className="px-3 py-2 rounded-lg text-[12px]"
            style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
            <option value="listA" style={{ background:'#100e0a' }}>Add to List A</option>
            <option value="listB" style={{ background:'#100e0a' }}>Add to List B</option>
          </select>
        </div>
        {searching && (
          <p className="text-[10px] mt-2" style={{ color:'rgba(255,255,255,0.4)' }}>↻ Searching Kite…</p>
        )}
        {results.length > 0 && (
          <div className="mt-3 rounded-lg overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.08)' }}>
            {results.map(r => {
              const inList = existingSet.has(r.symbol)
              return (
                <div key={r.token}
                  className="grid items-center px-3 py-2.5"
                  style={{
                    gridTemplateColumns: '1fr 2fr 0.8fr',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: inList ? 'rgba(82,183,136,0.04)' : 'transparent',
                  }}>
                  <span style={{ color:'rgba(255,255,255,0.85)', fontFamily:'JetBrains Mono, monospace', fontWeight: 600 }}>{r.symbol}</span>
                  <span className="text-[12px]" style={{ color:'rgba(255,255,255,0.5)' }}>{r.name}</span>
                  <div className="text-right">
                    {inList ? (
                      <span className="text-[10px]" style={{ color:'#52b788' }}>✓ in list</span>
                    ) : (
                      <button onClick={() => add(addTarget, r)}
                        className="px-3 py-1 rounded text-[10px] font-semibold tracking-wider"
                        style={{ background:'rgba(201,168,76,0.15)', border:'1px solid rgba(201,168,76,0.35)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                        + Add
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* TWO LIST COLUMNS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ListPanel name="List A" listKey="listA" entries={wl.listA} otherKey="listB"
          onRemove={remove} onMove={move} heldSymbols={heldSymbols} />
        <ListPanel name="List B" listKey="listB" entries={wl.listB} otherKey="listA"
          onRemove={remove} onMove={move} heldSymbols={heldSymbols} />
      </div>

      <p className="text-[10px] text-center" style={{ color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace' }}>
        {wl.generated && `Generated ${wl.generated} · `}List A scanned by strategies · List B is reserve
      </p>
    </div>
  )
}

function ListPanel({ name, listKey, entries, otherKey, onRemove, onMove, heldSymbols }: {
  name: string
  listKey: ListKey
  entries: Entry[]
  otherKey: ListKey
  onRemove: (list: ListKey, symbol: string) => void
  onMove: (from: ListKey, to: ListKey, symbol: string) => void
  heldSymbols: Set<string>
}) {
  const [filter, setFilter] = useState('')
  // Sort alphabetically by symbol so the list is scannable; held symbols
  // already get visually emphasised by the suitcase icon so no separate
  // sort by held/unheld is needed.
  const sorted = [...entries].sort((a, b) => a.nse.localeCompare(b.nse))
  const filtered = sorted.filter(e =>
    e.nse.toLowerCase().includes(filter.toLowerCase()) ||
    (e.name || '').toLowerCase().includes(filter.toLowerCase())
  )
  return (
    <div className="rounded-xl overflow-hidden" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.08)' }}>
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <div>
          <p className="text-[11px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>{name}</p>
          <p className="text-[10px] mt-0.5" style={{ color:'rgba(255,255,255,0.35)' }}>{entries.length} symbols</p>
        </div>
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter…"
          className="px-2 py-1 rounded text-[11px] outline-none"
          style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.7)', maxWidth: 140 }} />
      </div>
      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <p className="text-[11px] text-center py-6" style={{ color:'rgba(255,255,255,0.3)' }}>
            {entries.length === 0 ? 'empty' : 'no matches'}
          </p>
        )}
        {filtered.map((e, i) => {
          const held = heldSymbols.has(e.nse.toUpperCase())
          return (
          <div key={e.nse}
            className="grid items-center px-4 py-2.5 transition-all hover:bg-white/5"
            style={{
              gridTemplateColumns: '1fr 1.6fr 0.7fr 0.6fr',
              borderBottom: i < filtered.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              background: held ? 'rgba(96,165,250,0.05)' : 'transparent',
            }}>
            <span className="flex items-center gap-1.5" style={{ color:'rgba(255,255,255,0.8)', fontFamily:'JetBrains Mono, monospace', fontWeight: 600 }}>
              {held && (
                <span title="Currently held in this account"
                  style={{ color:'#60a5fa', fontSize: '11px' }}>💼</span>
              )}
              {e.nse}
            </span>
            <span className="text-[11px] truncate" style={{ color:'rgba(255,255,255,0.5)' }}>{e.name}</span>
            <button onClick={() => onMove(listKey, otherKey, e.nse)}
              className="text-[10px] px-2 py-1 rounded transition-all"
              style={{ background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.3)', color:'#60a5fa', fontFamily:'JetBrains Mono, monospace' }}>
              → {otherKey === 'listA' ? 'A' : 'B'}
            </button>
            <button onClick={() => onRemove(listKey, e.nse)}
              className="text-[10px] px-2 py-1 rounded transition-all"
              style={{ background:'rgba(224,90,94,0.1)', border:'1px solid rgba(224,90,94,0.3)', color:'#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
              ✕
            </button>
          </div>
          )
        })}
      </div>
    </div>
  )
}
