'use client'

// Task 6.15 — Platform Watchlists. Left list of watchlists, right table of
// symbols for the selected one (client-side tab switching — small dataset,
// all lists' symbols already loaded by the server component).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { EmptyState, Table, Td, Th, primaryButtonStyle, secondaryButtonStyle } from '@/components/dalgo/ui'

export interface WatchlistSymbol {
  nse: string
  name: string
  sector?: string
}

export interface WatchlistRow {
  list_key: string
  name: string
  symbols: WatchlistSymbol[]
}

export interface CustomerOption {
  id: string
  name: string
}

interface Props {
  watchlists: WatchlistRow[]
  customers: CustomerOption[]
}

const inputStyle: React.CSSProperties = {
  fontFamily: FONT_INTER,
  fontSize: 13,
  padding: '7px 9px',
  borderRadius: 6,
  border: `1px solid ${COLORS.border}`,
}

export default function WatchlistsClient({ watchlists, customers }: Props) {
  const router = useRouter()
  const [selectedKey, setSelectedKey] = useState(watchlists[0]?.list_key ?? '')
  const [nse, setNse] = useState('')
  const [name, setName] = useState('')
  const [sector, setSector] = useState('')
  const [busy, setBusy] = useState(false)
  const [pushTarget, setPushTarget] = useState('__all__')
  const [pushing, setPushing] = useState(false)

  const selected = watchlists.find(w => w.list_key === selectedKey)

  async function handlePush() {
    if (!selected) return
    const label = pushTarget === '__all__' ? 'all customers' : (customers.find(c => c.id === pushTarget)?.name ?? pushTarget)
    if (!confirm(`Push "${selected.name}" (${selected.symbols.length} symbols) to ${label}?`)) return
    setPushing(true)
    try {
      const res = await fetch(`/api/dalgo/admin/watchlists/${selected.list_key}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pushTarget === '__all__' ? {} : { targetCustomerId: pushTarget }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Push failed.')
      } else {
        alert(`Pushed "${selected.name}" to ${body.affectedCustomers} customer(s).`)
      }
    } finally {
      setPushing(false)
    }
  }

  async function handleAdd() {
    if (!selected || !nse.trim() || !name.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/dalgo/admin/watchlists/${selected.list_key}/symbols`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nse: nse.trim(), name: name.trim(), sector: sector.trim() || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to add symbol.')
      } else {
        setNse('')
        setName('')
        setSector('')
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(symbolNse: string) {
    if (!selected) return
    if (!confirm(`Remove ${symbolNse} from ${selected.name}?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/dalgo/admin/watchlists/${selected.list_key}/symbols/${encodeURIComponent(symbolNse)}`, {
        method: 'DELETE',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to remove symbol.')
      } else {
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ flex: '0 0 200px' }}>
        {watchlists.map(w => (
          <button
            key={w.list_key}
            onClick={() => setSelectedKey(w.list_key)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '9px 12px',
              marginBottom: 4,
              borderRadius: 8,
              border: 'none',
              fontFamily: FONT_INTER,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              background: w.list_key === selectedKey ? '#EFF6FF' : 'transparent',
              color: w.list_key === selectedKey ? COLORS.primary : COLORS.body,
            }}
          >
            {w.name} <span style={{ color: COLORS.muted }}>({w.symbols.length})</span>
          </button>
        ))}
      </div>

      <div style={{ flex: '1 1 400px', minWidth: 0 }}>
        {!selected ? (
          <EmptyState>No watchlists yet.</EmptyState>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                marginBottom: 16,
                padding: 14,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                background: '#F8FAFF',
              }}
            >
              <div>
                <label style={{ fontSize: 11, color: COLORS.muted }}>NSE Symbol</label>
                <br />
                <input value={nse} onChange={e => setNse(e.target.value.toUpperCase())} style={{ ...inputStyle, marginTop: 4, width: 120 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: COLORS.muted }}>Name</label>
                <br />
                <input value={name} onChange={e => setName(e.target.value)} style={{ ...inputStyle, marginTop: 4, width: 180 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: COLORS.muted }}>Sector (optional)</label>
                <br />
                <input value={sector} onChange={e => setSector(e.target.value)} style={{ ...inputStyle, marginTop: 4, width: 140 }} />
              </div>
              <button onClick={handleAdd} disabled={busy || !nse.trim() || !name.trim()} style={{ ...primaryButtonStyle, opacity: busy ? 0.6 : 1 }}>
                Add Symbol
              </button>
            </div>

            {/* Push row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: COLORS.muted, flexShrink: 0 }}>Push to:</span>
              <select
                value={pushTarget}
                onChange={e => setPushTarget(e.target.value)}
                style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${COLORS.border}`, fontFamily: FONT_INTER, color: COLORS.body }}
              >
                <option value="__all__">All Customers</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={handlePush}
                disabled={pushing || !selected}
                style={{ ...secondaryButtonStyle, opacity: pushing ? 0.6 : 1 }}
              >
                {pushing ? 'Pushing…' : 'Push'}
              </button>
            </div>

            {selected.symbols.length === 0 ? (
              <EmptyState>No symbols in this watchlist yet.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>NSE Symbol</Th>
                    <Th>Name</Th>
                    <Th>Sector</Th>
                    <Th align="right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {selected.symbols.map(s => (
                    <tr key={s.nse}>
                      <Td style={{ fontWeight: 500, color: COLORS.heading }}>{s.nse}</Td>
                      <Td>{s.name}</Td>
                      <Td>{s.sector ?? '—'}</Td>
                      <Td align="right">
                        <button onClick={() => handleRemove(s.nse)} disabled={busy} style={{ ...secondaryButtonStyle, padding: '4px 10px', fontSize: 12 }}>
                          Remove
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </>
        )}
      </div>
    </div>
  )
}
