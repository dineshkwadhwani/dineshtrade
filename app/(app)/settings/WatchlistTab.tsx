'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8', primary: '#3B82F6' }
const INTER = "'Inter', sans-serif"
const SORA = "'Sora', sans-serif"

type WatchlistRow = { list_key: string; name: string; symbols: { nse: string; name: string }[] }

export default function WatchlistTab({ watchlists, targetCustomerId }: { watchlists: WatchlistRow[]; targetCustomerId?: string }) {
  const router = useRouter()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [nseInput, setNseInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [selectedList, setSelectedList] = useState(watchlists[0]?.list_key ?? '')
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [resetting, setResetting] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const nse = nseInput.trim().toUpperCase()
    if (!nse || !selectedList) return
    setAdding(true); setMsg('')
    try {
      const res = await fetch('/api/dalgo/customer/watchlist', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', listKey: selectedList, nse, name: nameInput.trim() || nse, ...(targetCustomerId ? { targetCustomerId } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) { setMsg(data.error || 'Failed to add.') }
      else { setMsg(`✓ ${nse} added to ${selectedList}`); setNseInput(''); setNameInput(''); router.refresh() }
    } catch { setMsg('Connection error.') }
    finally { setAdding(false) }
  }

  async function handleReset(listKey: string, listName: string) {
    if (!confirm(`Reset "${listName}" to the platform default? All your changes will be overwritten.`)) return
    setResetting(listKey); setMsg('')
    try {
      const res = await fetch('/api/dalgo/customer/watchlist', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', listKey, ...(targetCustomerId ? { targetCustomerId } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) setMsg(data.error || 'Reset failed.')
      else { setMsg(`✓ ${listName} reset to default (${data.count} stocks)`); router.refresh() }
    } catch { setMsg('Connection error.') }
    finally { setResetting(null) }
  }

  async function handleRemove(listKey: string, nse: string) {
    setRemoving(`${listKey}:${nse}`); setMsg('')
    try {
      const res = await fetch('/api/dalgo/customer/watchlist', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', listKey, nse, ...(targetCustomerId ? { targetCustomerId } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) setMsg(data.error || 'Failed to remove.')
      else { router.refresh() }
    } catch { setMsg('Connection error.') }
    finally { setRemoving(null) }
  }

  return (
    <div style={{ fontFamily: INTER, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Add stock form */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <h2 style={{ fontFamily: SORA, fontSize: 14, fontWeight: 700, color: C.heading, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Add Stock to Watchlist
        </h2>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 130px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>NSE Symbol</label>
            <input value={nseInput} onChange={e => setNseInput(e.target.value.toUpperCase())} placeholder="e.g. RELIANCE"
              style={{ width: '100%', padding: '9px 12px', fontFamily: INTER, fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 8, outline: 'none', color: C.body, background: C.bg, boxSizing: 'border-box', textTransform: 'uppercase' }} />
          </div>
          <div style={{ flex: '2 1 200px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Company Name <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <input value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="e.g. Reliance Industries"
              style={{ width: '100%', padding: '9px 12px', fontFamily: INTER, fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 8, outline: 'none', color: C.body, background: C.bg, boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Watchlist</label>
            <select value={selectedList} onChange={e => setSelectedList(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', fontFamily: INTER, fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 8, color: C.body, background: C.bg, cursor: 'pointer', outline: 'none' }}>
              {watchlists.map(w => <option key={w.list_key} value={w.list_key}>{w.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={adding || !nseInput.trim()} style={{
            padding: '9px 20px', background: nseInput.trim() ? C.primary : '#E2E8F0',
            color: nseInput.trim() ? '#fff' : C.muted, border: 'none', borderRadius: 8,
            fontFamily: INTER, fontWeight: 600, fontSize: 14,
            cursor: nseInput.trim() && !adding ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
          }}>
            {adding ? 'Adding…' : '+ Add Stock'}
          </button>
        </form>
        {msg && <p style={{ fontSize: 13, color: msg.startsWith('✓') ? '#16A34A' : '#DC2626', margin: '10px 0 0' }}>{msg}</p>}
      </div>

      {/* Watchlist accordions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {watchlists.length === 0 && (
          <p style={{ color: C.muted, fontSize: 14 }}>No watchlists found.</p>
        )}
        {watchlists.map(wl => (
          <div key={wl.list_key} style={{ border: `1px solid ${openKey === wl.list_key ? C.primary : C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {/* Header */}
            <button onClick={() => setOpenKey(prev => prev === wl.list_key ? null : wl.list_key)} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px', background: openKey === wl.list_key ? '#EFF6FF' : C.card,
              border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: openKey === wl.list_key ? '10px 10px 0 0' : 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div>
                  <span style={{ fontFamily: SORA, fontWeight: 600, fontSize: 14, color: C.heading }}>{wl.name}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: C.muted }}>{wl.list_key}</span>
                </div>
                <span style={{ padding: '2px 8px', borderRadius: 999, background: '#DBEAFE', color: C.primary, fontSize: 12, fontWeight: 600 }}>
                  {wl.symbols.length} stocks
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={e => { e.stopPropagation(); handleReset(wl.list_key, wl.name) }}
                  disabled={resetting === wl.list_key}
                  style={{ padding: '4px 12px', fontSize: 12, fontFamily: INTER, fontWeight: 600, background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', borderRadius: 6, cursor: 'pointer' }}>
                  {resetting === wl.list_key ? '…' : '↺ Reset'}
                </button>
                <span style={{ color: C.muted, fontSize: 14, transform: openKey === wl.list_key ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
              </div>
            </button>

            {/* Body */}
            {openKey === wl.list_key && (
              <div style={{ borderTop: `1px solid ${C.border}`, background: C.card }}>
                {wl.symbols.length === 0 ? (
                  <p style={{ padding: '16px 18px', color: C.muted, fontSize: 14, margin: 0 }}>No stocks in this list.</p>
                ) : (
                  <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {/* Column headers */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 12, padding: '6px 0', borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Symbol</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Company</span>
                      <span></span>
                    </div>
                    {wl.symbols.map((s, i) => (
                      <div key={s.nse} style={{
                        display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 12, alignItems: 'center',
                        padding: '8px 0', borderBottom: i < wl.symbols.length - 1 ? `1px solid ${C.border}` : 'none',
                      }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: C.heading, fontFamily: 'monospace' }}>{s.nse}</span>
                        <span style={{ fontSize: 13, color: C.body }}>{s.name}</span>
                        <button
                          onClick={() => handleRemove(wl.list_key, s.nse)}
                          disabled={removing === `${wl.list_key}:${s.nse}`}
                          style={{ padding: '3px 10px', fontSize: 12, fontFamily: INTER, fontWeight: 600, background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          {removing === `${wl.list_key}:${s.nse}` ? '…' : '✕ Remove'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
