'use client'
import { useEffect, useMemo, useState } from 'react'

interface Entry {
  nse: string
  name: string
  trades?: number
  lastTraded?: string
}

interface ListMeta { name: string }

interface Watchlist {
  generated?: string
  meta: Record<string, ListMeta>
  lists: Record<string, Entry[]>
}

interface SearchResult {
  token: number
  symbol: string
  name: string
}

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
  const [addTarget, setAddTarget] = useState<string>('listA')

  // Initial load — watchlist + holdings in parallel
  useEffect(() => { void reload() }, [])

  async function reload() {
    try {
      const d = await fetch('/api/watchlist').then(r => r.json())
      setWl({ meta: d.meta || {}, lists: d.lists || {}, generated: d.generated })
      // Make sure addTarget remains valid after a list is deleted/renamed
      if (d.lists && !d.lists[addTarget]) setAddTarget('listA')
    } catch { setError('Failed to load watchlist') }
    fetch('/api/state').then(r => r.json()).then(async s => {
      const accs: string[] = s.accountsWithToken || []
      if (accs.length === 0) return
      const r = await fetch(`/api/zerodha?account=${encodeURIComponent(accs[0])}&action=holdings`).then(r => r.json()).catch(() => null)
      if (Array.isArray(r?.data)) {
        setHeldSymbols(new Set(r.data.map((h: any) => String(h.tradingsymbol).toUpperCase())))
      }
    }).catch(() => { /* holdings is best-effort decoration */ })
  }

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

  const orderedKeys = useMemo(() => {
    if (!wl) return [] as string[]
    const keys = Object.keys(wl.lists)
    // Stable order: listA, listB, then numeric/lexical
    return keys.sort((a, b) => {
      if (a === 'listA') return -1
      if (b === 'listA') return 1
      if (a === 'listB') return -1
      if (b === 'listB') return 1
      return a.localeCompare(b)
    })
  }, [wl])

  function add(target: string, r: SearchResult) {
    if (!wl) return
    // A symbol CAN live in multiple lists (e.g. listed in both "Top Volume" and
    // "Dip Candidates"). Only refuse if it's already in the SAME target list —
    // strategies can scan multiple lists and the engine de-dupes the universe.
    if (wl.lists[target]?.some(e => e.nse === r.symbol)) {
      setError(`${r.symbol} already in ${wl.meta[target]?.name || target}`)
      setTimeout(() => setError(''), 2500)
      return
    }
    const entry: Entry = { nse: r.symbol, name: r.name || r.symbol }
    const next: Watchlist = { ...wl, lists: { ...wl.lists, [target]: [...wl.lists[target], entry] } }
    setWl(next); setDirty(true)
    setQuery(''); setResults([])
  }

  function remove(list: string, symbol: string) {
    if (!wl) return
    const next: Watchlist = { ...wl, lists: { ...wl.lists, [list]: wl.lists[list].filter(e => e.nse !== symbol) } }
    setWl(next); setDirty(true)
  }

  function rename(key: string, newName: string) {
    if (!wl) return
    const trimmed = newName.trim().slice(0, 40)
    if (!trimmed) return
    const next: Watchlist = { ...wl, meta: { ...wl.meta, [key]: { name: trimmed } } }
    setWl(next); setDirty(true)
  }

  function createList(name: string) {
    if (!wl) return
    // Find next free key: listA, listB, list3, list4, ...
    const used = new Set(Object.keys(wl.lists))
    let key = ''
    if (!used.has('listA')) key = 'listA'
    else if (!used.has('listB')) key = 'listB'
    else {
      for (let n = 3; n < 1000; n++) { if (!used.has(`list${n}`)) { key = `list${n}`; break } }
    }
    if (!key) { setError('No list slots available'); return }
    const next: Watchlist = {
      ...wl,
      lists: { ...wl.lists, [key]: [] },
      meta: { ...wl.meta, [key]: { name: name.trim().slice(0, 40) || key } },
    }
    setWl(next); setDirty(true)
    setAddTarget(key)
  }

  async function deleteList(key: string) {
    if (!wl) return
    if (key === 'listA' || key === 'listB') {
      setError('List A and List B cannot be deleted.')
      setTimeout(() => setError(''), 2500); return
    }
    if (dirty) {
      setError('Save unsaved changes first, then delete.')
      setTimeout(() => setError(''), 2500); return
    }
    if (!confirm(`Delete "${wl.meta[key]?.name || key}"? Symbols in it will be removed.`)) return
    setSaving(true); setError(''); setOkMsg('')
    try {
      const res = await fetch(`/api/watchlist?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        setOkMsg(`Deleted "${wl.meta[key]?.name || key}"`)
        setTimeout(() => setOkMsg(''), 3000)
        await reload()
      } else {
        setError(data.error || `HTTP ${res.status}`)
      }
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  async function save() {
    if (!wl) return
    setSaving(true); setError(''); setOkMsg('')
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: wl.meta, lists: wl.lists }),
      })
      const data = await res.json()
      if (res.ok) {
        setDirty(false)
        const counts = Object.entries(data.counts || {}).map(([k, n]) => `${wl.meta[k]?.name || k}: ${n}`).join(' · ')
        setOkMsg(`Saved · ${counts}`)
        setTimeout(() => setOkMsg(''), 3000)
      } else {
        setError(data.error || `HTTP ${res.status}`)
      }
    } catch { setError('Network error') }
    finally { setSaving(false) }
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
            Strategies pick which lists they scan · saves take effect immediately
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
          <select value={addTarget} onChange={e => setAddTarget(e.target.value)}
            className="px-3 py-2 rounded-lg text-[12px]"
            style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
            {orderedKeys.map(k => (
              <option key={k} value={k} style={{ background:'#100e0a' }}>
                Add to {wl.meta[k]?.name || k}
              </option>
            ))}
          </select>
        </div>
        {searching && (
          <p className="text-[10px] mt-2" style={{ color:'rgba(255,255,255,0.4)' }}>↻ Searching Kite…</p>
        )}
        {results.length > 0 && (
          <div className="mt-3 rounded-lg overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.08)' }}>
            {results.map(r => {
              // Only refuse if the symbol is already in the *target* list. It's
              // fine to live in multiple lists at once — strategies de-dupe the
              // universe when they scan across lists.
              const inTarget = (wl?.lists[addTarget] || []).some(e => e.nse === r.symbol)
              // Find every other list this symbol already lives in, for context.
              const otherLists = orderedKeys
                .filter(k => k !== addTarget && wl?.lists[k]?.some(e => e.nse === r.symbol))
                .map(k => wl?.meta[k]?.name || k)
              return (
                <div key={r.token}
                  className="grid items-center px-3 py-2.5"
                  style={{
                    gridTemplateColumns: '1fr 2fr 0.8fr',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: inTarget ? 'rgba(82,183,136,0.04)' : 'transparent',
                  }}>
                  <span style={{ color:'rgba(255,255,255,0.85)', fontFamily:'JetBrains Mono, monospace', fontWeight: 600 }}>{r.symbol}</span>
                  <span className="text-[12px] min-w-0" style={{ color:'rgba(255,255,255,0.5)' }}>
                    <span className="truncate block">{r.name}</span>
                    {otherLists.length > 0 && (
                      <span className="text-[10px]" style={{ color:'rgba(96,165,250,0.7)' }}>
                        also in: {otherLists.join(', ')}
                      </span>
                    )}
                  </span>
                  <div className="text-right">
                    {inTarget ? (
                      <span className="text-[10px]" style={{ color:'#52b788' }}>✓ in {wl?.meta[addTarget]?.name || addTarget}</span>
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

      {/* LIST PANELS — N columns, grid wraps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {orderedKeys.map(key => (
          <ListPanel key={key} listKey={key} meta={wl.meta[key]} entries={wl.lists[key]}
            onRemove={remove} onRename={rename} onDelete={deleteList}
            heldSymbols={heldSymbols} />
        ))}

        {/* New list card */}
        <NewListCard onCreate={createList} />
      </div>

      <p className="text-[10px] text-center" style={{ color:'rgba(255,255,255,0.25)', fontFamily:'JetBrains Mono, monospace' }}>
        {wl.generated && `Generated ${wl.generated} · `}Lists are linked to strategies on the Settings page · List A and List B can be renamed but not deleted
      </p>
    </div>
  )
}

function ListPanel({ listKey, meta, entries, onRemove, onRename, onDelete, heldSymbols }: {
  listKey: string
  meta?: ListMeta
  entries: Entry[]
  onRemove: (list: string, symbol: string) => void
  onRename: (list: string, newName: string) => void
  onDelete: (list: string) => void
  heldSymbols: Set<string>
}) {
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(meta?.name || listKey)
  useEffect(() => { setDraftName(meta?.name || listKey) }, [meta, listKey])

  const sorted = [...entries].sort((a, b) => a.nse.localeCompare(b.nse))
  const filtered = sorted.filter(e =>
    e.nse.toLowerCase().includes(filter.toLowerCase()) ||
    (e.name || '').toLowerCase().includes(filter.toLowerCase())
  )

  const canDelete = listKey !== 'listA' && listKey !== 'listB'

  function commitName() {
    setEditing(false)
    const next = draftName.trim()
    if (next && next !== meta?.name) onRename(listKey, next)
    else setDraftName(meta?.name || listKey)
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.08)' }}>
      <div className="px-4 py-3 flex items-center justify-between gap-2"
        style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <div className="min-w-0 flex-1">
          {editing ? (
            <input autoFocus value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setEditing(false); setDraftName(meta?.name || listKey) } }}
              maxLength={40}
              className="text-[11px] tracking-widest uppercase px-2 py-1 rounded outline-none w-full"
              style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(201,168,76,0.4)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }} />
          ) : (
            <button onClick={() => setEditing(true)}
              title="Click to rename"
              className="text-[11px] tracking-widest uppercase text-left hover:underline truncate block w-full"
              style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              {meta?.name || listKey} <span style={{ opacity:0.5 }}>✎</span>
            </button>
          )}
          <p className="text-[10px] mt-0.5" style={{ color:'rgba(255,255,255,0.35)' }}>{entries.length} symbols · key {listKey}</p>
        </div>
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter…"
          className="px-2 py-1 rounded text-[11px] outline-none shrink-0"
          style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.7)', maxWidth: 100 }} />
        {canDelete && (
          <button onClick={() => onDelete(listKey)} title="Delete list"
            className="text-[10px] px-2 py-1 rounded shrink-0"
            style={{ background:'rgba(224,90,94,0.1)', border:'1px solid rgba(224,90,94,0.3)', color:'#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
            🗑
          </button>
        )}
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
              gridTemplateColumns: '1fr 1.6fr 0.6fr',
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
            <button onClick={() => onRemove(listKey, e.nse)}
              className="text-[10px] px-2 py-1 rounded transition-all justify-self-end"
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

function NewListCard({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <div className="rounded-xl p-4 flex flex-col items-center justify-center gap-3 min-h-[180px]"
      style={{ background:'rgba(255,255,255,0.01)', border:'1px dashed rgba(201,168,76,0.3)' }}>
      <p className="text-[11px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
        + new list
      </p>
      <input value={name} onChange={e => setName(e.target.value)}
        placeholder="List name (e.g. Dip Candidates)"
        maxLength={40}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { onCreate(name); setName('') } }}
        className="w-full px-3 py-2 rounded-lg text-[12px] outline-none text-center"
        style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.85)' }} />
      <button onClick={() => { if (name.trim()) { onCreate(name); setName('') } }}
        disabled={!name.trim()}
        className="px-4 py-1.5 rounded text-[11px] font-semibold tracking-wider transition-all disabled:opacity-30"
        style={{ background:'rgba(201,168,76,0.15)', border:'1px solid rgba(201,168,76,0.35)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
        + Create
      </button>
      <p className="text-[9px] text-center" style={{ color:'rgba(255,255,255,0.3)' }}>
        Empty list. Add symbols, then link it from a strategy in Settings.
      </p>
    </div>
  )
}
