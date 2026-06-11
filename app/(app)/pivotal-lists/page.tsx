'use client'
import { useEffect, useMemo, useState } from 'react'

interface PivotalEntry {
  nse: string
  name: string
  enabled: boolean
  breakoutTriggerPrice: number
  t1Pct: number
  t2Pct: number
  executionMode: 'normal' | 'dayEnd'
  stopLossPrice?: number | null
  notes?: string
}

interface PivotalMeta { name: string }
interface PivotalLists {
  generated?: string
  meta: Record<string, PivotalMeta>
  lists: Record<string, PivotalEntry[]>
}

interface SearchResult {
  token: number
  symbol: string
  name: string
}

interface DraftEntryState {
  breakoutTriggerPrice: string
  t1Pct: string
  t2Pct: string
  executionMode: 'normal' | 'dayEnd'
  stopLossPrice: string
}

const DEFAULTS: DraftEntryState = {
  breakoutTriggerPrice: '',
  t1Pct: '2.0',
  t2Pct: '3.5',
  executionMode: 'normal',
  stopLossPrice: '',
}

export default function PivotalListsPage() {
  const [data, setData] = useState<PivotalLists | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [addTarget, setAddTarget] = useState('pivotalA')
  const [draftEntry, setDraftEntry] = useState(DEFAULTS)

  useEffect(() => { void reload() }, [])

  async function reload() {
    try {
      const next = await fetch('/api/pivotal-lists').then(r => r.json())
      setData({ meta: next.meta || {}, lists: next.lists || {}, generated: next.generated })
      if (next.lists && !next.lists[addTarget]) setAddTarget('pivotalA')
    } catch {
      setError('Failed to load pivotal lists')
    }
  }

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/watchlist/search?q=${encodeURIComponent(query)}`)
        const next = await res.json()
        setResults(res.ok ? (next.results || []) : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const orderedKeys = useMemo(() => {
    if (!data) return [] as string[]
    return Object.keys(data.lists).sort((a, b) => {
      if (a === 'pivotalA') return -1
      if (b === 'pivotalA') return 1
      if (a === 'pivotalB') return -1
      if (b === 'pivotalB') return 1
      return a.localeCompare(b)
    })
  }, [data])

  function patchEntry(listKey: string, symbol: string, patch: Partial<PivotalEntry>) {
    if (!data) return
    setData({
      ...data,
      lists: {
        ...data.lists,
        [listKey]: data.lists[listKey].map(entry => entry.nse === symbol ? { ...entry, ...patch } : entry),
      },
    })
    setDirty(true)
  }

  function addSymbol(target: string, result: SearchResult) {
    if (!data) return
    if ((data.lists[target] || []).some(entry => entry.nse === result.symbol)) {
      setError(`${result.symbol} already exists in ${data.meta[target]?.name || target}`)
      setTimeout(() => setError(''), 2500)
      return
    }
    const trigger = Number(draftEntry.breakoutTriggerPrice)
    const t1 = Number(draftEntry.t1Pct)
    const t2 = Number(draftEntry.t2Pct)
    const stopLoss = draftEntry.stopLossPrice.trim() ? Number(draftEntry.stopLossPrice) : null
    if (!Number.isFinite(trigger) || trigger <= 0) {
      setError('Breakout trigger must be a positive number before adding a script')
      return
    }
    if (!Number.isFinite(t1) || !Number.isFinite(t2) || t1 <= 0 || t2 <= 0 || t1 > t2) {
      setError('T1 and T2 must be positive and T1 cannot exceed T2')
      return
    }
    if (stopLoss !== null && (!Number.isFinite(stopLoss) || stopLoss <= 0 || stopLoss >= trigger)) {
      setError('Stop loss must be blank or a positive value below the trigger price')
      return
    }
    const nextEntry: PivotalEntry = {
      nse: result.symbol,
      name: result.name || result.symbol,
      enabled: true,
      breakoutTriggerPrice: trigger,
      t1Pct: t1,
      t2Pct: t2,
      executionMode: draftEntry.executionMode,
      stopLossPrice: stopLoss,
    }
    setData({ ...data, lists: { ...data.lists, [target]: [...data.lists[target], nextEntry] } })
    setDirty(true)
    setQuery('')
    setResults([])
  }

  function removeSymbol(listKey: string, symbol: string) {
    if (!data) return
    setData({ ...data, lists: { ...data.lists, [listKey]: data.lists[listKey].filter(entry => entry.nse !== symbol) } })
    setDirty(true)
  }

  function renameList(listKey: string, name: string) {
    if (!data) return
    const trimmed = name.trim().slice(0, 40)
    if (!trimmed) return
    setData({ ...data, meta: { ...data.meta, [listKey]: { name: trimmed } } })
    setDirty(true)
  }

  function createList(name: string) {
    if (!data) return
    const used = new Set(Object.keys(data.lists))
    let key = ''
    if (!used.has('pivotalA')) key = 'pivotalA'
    else if (!used.has('pivotalB')) key = 'pivotalB'
    else {
      for (let n = 3; n < 1000; n++) {
        if (!used.has(`pivotal${n}`)) { key = `pivotal${n}`; break }
      }
    }
    if (!key) return
    setData({
      ...data,
      meta: { ...data.meta, [key]: { name: name.trim().slice(0, 40) || key } },
      lists: { ...data.lists, [key]: [] },
    })
    setDirty(true)
    setAddTarget(key)
  }

  async function deleteList(key: string) {
    if (!data) return
    if (key === 'pivotalA') {
      setError('Pivotal List A cannot be deleted.')
      return
    }
    if (dirty) {
      setError('Save unsaved changes first, then delete.')
      return
    }
    if (!confirm(`Delete "${data.meta[key]?.name || key}"?`)) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/pivotal-lists?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      const next = await res.json()
      if (!res.ok) setError(next.error || `HTTP ${res.status}`)
      else {
        setOkMsg(`Deleted "${data.meta[key]?.name || key}"`)
        setTimeout(() => setOkMsg(''), 3000)
        await reload()
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    if (!data) return
    setSaving(true)
    setError('')
    setOkMsg('')
    try {
      const res = await fetch('/api/pivotal-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: data.meta, lists: data.lists }),
      })
      const next = await res.json()
      if (!res.ok) setError(next.error || `HTTP ${res.status}`)
      else {
        setDirty(false)
        const counts = Object.entries(next.counts || {}).map(([key, count]) => `${data.meta[key]?.name || key}: ${count}`).join(' · ')
        setOkMsg(`Saved · ${counts}`)
        setTimeout(() => setOkMsg(''), 3000)
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (!data) return <div className="p-8 text-center dt-text-secondary">Loading pivotal lists…</div>

  return (
    <div className="space-y-5 pb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-light dt-text-primary" style={{ fontFamily:'Cormorant Garamond, serif' }}>
            Pivotal <span className="gold-text">Lists</span>
          </h1>
          <p className="text-[10px] mt-1 dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>
            Script-level breakout setups for the Pivotal strategy · trigger, targets, execution mode, stop-loss
          </p>
        </div>
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

      {error && <div className="rounded-lg p-3 dt-banner-error"><p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)' }}>✗ {error}</p></div>}
      {okMsg && <div className="rounded-lg p-3 dt-banner-green"><p className="text-[12px]" style={{ color:'#52b788' }}>✓ {okMsg}</p></div>}

      <div className="rounded-xl p-4 dt-card-gold space-y-3">
        <p className="text-[10px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>Add new script</p>
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_0.8fr_repeat(5,minmax(0,1fr))] gap-2">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Type symbol or company name…"
            className="px-3 py-2 rounded-lg text-[13px] outline-none dt-card dt-text-primary" />
          <select value={addTarget} onChange={e => setAddTarget(e.target.value)} className="px-3 py-2 rounded-lg text-[12px] dt-card" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
            {orderedKeys.map(key => <option key={key} value={key}>{data.meta[key]?.name || key}</option>)}
          </select>
          <input value={draftEntry.breakoutTriggerPrice} onChange={e => setDraftEntry({ ...draftEntry, breakoutTriggerPrice: e.target.value })} placeholder="Trigger"
            className="px-3 py-2 rounded-lg text-[12px] outline-none dt-card dt-text-primary" />
          <input value={draftEntry.t1Pct} onChange={e => setDraftEntry({ ...draftEntry, t1Pct: e.target.value })} placeholder="T1 %"
            className="px-3 py-2 rounded-lg text-[12px] outline-none dt-card dt-text-primary" />
          <input value={draftEntry.t2Pct} onChange={e => setDraftEntry({ ...draftEntry, t2Pct: e.target.value })} placeholder="T2 %"
            className="px-3 py-2 rounded-lg text-[12px] outline-none dt-card dt-text-primary" />
          <select value={draftEntry.executionMode} onChange={e => setDraftEntry({ ...draftEntry, executionMode: e.target.value as 'normal' | 'dayEnd' })}
            className="px-3 py-2 rounded-lg text-[12px] dt-card" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
            <option value="normal">normal</option>
            <option value="dayEnd">dayEnd</option>
          </select>
          <input value={draftEntry.stopLossPrice} onChange={e => setDraftEntry({ ...draftEntry, stopLossPrice: e.target.value })} placeholder="Stop loss"
            className="px-3 py-2 rounded-lg text-[12px] outline-none dt-card dt-text-primary" />
        </div>
        {searching && <p className="text-[10px] dt-text-secondary">↻ Searching Kite…</p>}
        {results.length > 0 && (
          <div className="rounded-lg overflow-hidden dt-card">
            {results.map(result => (
              <div key={result.token} className="grid items-center px-3 py-2.5 dt-table-row" style={{ gridTemplateColumns: '1fr 2fr 0.8fr' }}>
                <span className="dt-text-primary" style={{ fontFamily:'JetBrains Mono, monospace', fontWeight: 600 }}>{result.symbol}</span>
                <span className="text-[12px] dt-text-secondary truncate">{result.name}</span>
                <div className="text-right">
                  <button onClick={() => addSymbol(addTarget, result)} className="px-3 py-1 rounded text-[10px] font-semibold tracking-wider dt-card-gold" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                    + Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {orderedKeys.map(key => (
          <PivotalListPanel key={key}
            listKey={key}
            meta={data.meta[key]}
            entries={data.lists[key]}
            onRename={renameList}
            onDelete={deleteList}
            onRemove={removeSymbol}
            onPatch={patchEntry}
          />
        ))}
        <NewPivotalListCard onCreate={createList} />
      </div>

      <p className="text-[10px] text-center dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>
        {data.generated && `Generated ${data.generated} · `}Pivotal lists are separate from watchlists and are used only by Pivotal strategies
      </p>
    </div>
  )
}

function PivotalListPanel({ listKey, meta, entries, onRename, onDelete, onRemove, onPatch }: {
  listKey: string
  meta?: PivotalMeta
  entries: PivotalEntry[]
  onRename: (listKey: string, name: string) => void
  onDelete: (listKey: string) => void
  onRemove: (listKey: string, symbol: string) => void
  onPatch: (listKey: string, symbol: string, patch: Partial<PivotalEntry>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(meta?.name || listKey)
  const [filter, setFilter] = useState('')
  useEffect(() => { setDraftName(meta?.name || listKey) }, [meta, listKey])

  const filtered = [...entries].filter(entry => entry.nse.toLowerCase().includes(filter.toLowerCase()) || entry.name.toLowerCase().includes(filter.toLowerCase()))
  const canDelete = listKey !== 'pivotalA'

  function commitName() {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== meta?.name) onRename(listKey, trimmed)
    else setDraftName(meta?.name || listKey)
  }

  return (
    <div className="rounded-xl overflow-hidden dt-card">
      <div className="px-4 py-3 flex items-center justify-between gap-2 dt-border-b">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input autoFocus value={draftName} onChange={e => setDraftName(e.target.value)} onBlur={commitName}
              onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setEditing(false); setDraftName(meta?.name || listKey) } }}
              className="text-[11px] tracking-widest uppercase px-2 py-1 rounded outline-none w-full dt-card-gold"
              style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }} />
          ) : (
            <button onClick={() => setEditing(true)} className="text-[11px] tracking-widest uppercase text-left hover:underline truncate block w-full" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              {meta?.name || listKey} <span style={{ opacity: 0.5 }}>✎</span>
            </button>
          )}
          <p className="text-[10px] mt-0.5 dt-text-muted">{entries.length} scripts · key {listKey}</p>
        </div>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…" className="px-2 py-1 rounded text-[11px] outline-none shrink-0 dt-card dt-text-secondary" style={{ maxWidth: 100 }} />
        {canDelete && <button onClick={() => onDelete(listKey)} className="text-[10px] px-2 py-1 rounded shrink-0 dt-banner-error" style={{ color:'#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>🗑</button>}
      </div>
      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {filtered.length === 0 && <p className="text-[11px] text-center py-6 dt-text-muted">{entries.length === 0 ? 'empty' : 'no matches'}</p>}
        {filtered.map((entry, idx) => (
          <div key={entry.nse} className="grid gap-2 px-4 py-3" style={{ borderBottom: idx < filtered.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="dt-text-secondary" style={{ fontFamily:'JetBrains Mono, monospace', fontWeight: 600 }}>{entry.nse}</span>
                <span className="text-[11px] ml-2 dt-text-muted">{entry.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => onPatch(listKey, entry.nse, { enabled: !entry.enabled })}
                  className="text-[10px] px-2 py-1 rounded"
                  style={{ background: entry.enabled ? 'rgba(82,183,136,0.15)' : 'rgba(255,255,255,0.04)', color: entry.enabled ? '#52b788' : 'rgba(255,255,255,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
                  {entry.enabled ? 'enabled' : 'disabled'}
                </button>
                <button onClick={() => onRemove(listKey, entry.nse)} className="text-[10px] px-2 py-1 rounded dt-banner-error" style={{ color:'#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>✕</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
              <InlineNumber label="Trigger" value={entry.breakoutTriggerPrice} onChange={value => onPatch(listKey, entry.nse, { breakoutTriggerPrice: value })} />
              <InlineNumber label="T1 %" value={entry.t1Pct} onChange={value => onPatch(listKey, entry.nse, { t1Pct: value })} />
              <InlineNumber label="T2 %" value={entry.t2Pct} onChange={value => onPatch(listKey, entry.nse, { t2Pct: value })} />
              <InlineSelect label="Mode" value={entry.executionMode} options={[{ value: 'normal', label: 'normal' }, { value: 'dayEnd', label: 'dayEnd' }]} onChange={value => onPatch(listKey, entry.nse, { executionMode: value as 'normal' | 'dayEnd' })} />
              <InlineNullableNumber label="Stop loss" value={entry.stopLossPrice ?? null} onChange={value => onPatch(listKey, entry.nse, { stopLossPrice: value })} />
              <InlineText label="Notes" value={entry.notes || ''} onChange={value => onPatch(listKey, entry.nse, { notes: value })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function InlineNumber({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] dt-text-muted">{label}</span>
      <input type="number" step="0.01" value={Number.isFinite(value) ? value : ''} onChange={e => onChange(Number(e.target.value || 0))}
        className="w-full px-2 py-1.5 rounded text-[12px] outline-none dt-card dt-text-primary" />
    </label>
  )
}

function InlineNullableNumber({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] dt-text-muted">{label}</span>
      <input type="number" step="0.01" value={value ?? ''} onChange={e => onChange(e.target.value.trim() ? Number(e.target.value) : null)}
        className="w-full px-2 py-1.5 rounded text-[12px] outline-none dt-card dt-text-primary" />
    </label>
  )
}

function InlineText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] dt-text-muted">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value.slice(0, 200))}
        className="w-full px-2 py-1.5 rounded text-[12px] outline-none dt-card dt-text-primary" />
    </label>
  )
}

function InlineSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] dt-text-muted">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full px-2 py-1.5 rounded text-[12px] dt-card" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function NewPivotalListCard({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <div className="rounded-xl p-4 flex flex-col items-center justify-center gap-3 min-h-[180px] dt-card-gold">
      <p className="text-[11px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
        + new pivotal list
      </p>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="List name"
        className="w-full px-3 py-2 rounded-lg text-[12px] outline-none text-center dt-card dt-text-primary" />
      <button onClick={() => { if (name.trim()) { onCreate(name); setName('') } }} disabled={!name.trim()}
        className="px-4 py-1.5 rounded text-[11px] font-semibold tracking-wider transition-all disabled:opacity-30 dt-card-gold"
        style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
        + Create
      </button>
      <p className="text-[9px] text-center dt-text-muted">Add a named script bucket for breakout setups.</p>
    </div>
  )
}
