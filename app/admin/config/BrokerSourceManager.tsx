'use client'

import { useMemo, useState } from 'react'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { Card } from '@/components/dalgo/ui'

export interface BrokerSourceRow {
  id: string
  name: string
  url: string
  notes: string | null
  active: boolean
  display_order: number
}

interface Props {
  initialSources: BrokerSourceRow[]
}

function byOrder(a: BrokerSourceRow, b: BrokerSourceRow): number {
  if (a.display_order !== b.display_order) return a.display_order - b.display_order
  return String(a.name || '').localeCompare(String(b.name || ''))
}

export default function BrokerSourceManager({ initialSources }: Props) {
  const safeInitial = Array.isArray(initialSources)
    ? initialSources.filter(s => s && typeof s.id === 'string')
    : []
  const [sources, setSources] = useState<BrokerSourceRow[]>([...safeInitial].sort(byOrder))
  const [saving, setSaving] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [newOrder, setNewOrder] = useState('100')

  const activeCount = useMemo(() => sources.filter(s => s.active).length, [sources])

  async function addSource() {
    if (!newName.trim() || !newUrl.trim()) return
    setSaving('new')
    try {
      const res = await fetch('/api/dalgo/admin/broker-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          url: newUrl.trim(),
          notes: newNotes.trim() || null,
          displayOrder: Number(newOrder || '100'),
          active: true,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to create source.')
        return
      }
      const created = body.source as BrokerSourceRow
      setSources(prev => [...prev, created].sort(byOrder))
      setNewName('')
      setNewUrl('')
      setNewNotes('')
      setNewOrder('100')
    } finally {
      setSaving(null)
    }
  }

  async function patchSource(id: string, patch: Partial<{ name: string; url: string; notes: string | null; active: boolean; displayOrder: number }>) {
    setSaving(id)
    try {
      const res = await fetch(`/api/dalgo/admin/broker-sources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to update source.')
        return
      }
      const updated = body.source as BrokerSourceRow
      setSources(prev => prev.map(s => (s.id === id ? updated : s)).sort(byOrder))
    } finally {
      setSaving(null)
    }
  }

  async function deleteSource(id: string) {
    if (!confirm('Delete this source?')) return
    setSaving(id)
    try {
      const res = await fetch(`/api/dalgo/admin/broker-sources/${id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to delete source.')
        return
      }
      setSources(prev => prev.filter(s => s.id !== id))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontFamily: FONT_INTER, fontWeight: 600, fontSize: 14, color: COLORS.heading }}>Broker Recommendation Sources</div>
          <div style={{ fontSize: 12, color: COLORS.body }}>Active sources: {activeCount}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(260px,2fr) minmax(180px,1fr) 110px auto', gap: 8, alignItems: 'center' }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder='Source name'
            style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
          />
          <input
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            placeholder='https://...'
            style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
          />
          <input
            value={newNotes}
            onChange={e => setNewNotes(e.target.value)}
            placeholder='Notes (optional)'
            style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
          />
          <input
            type='number'
            value={newOrder}
            onChange={e => setNewOrder(e.target.value)}
            placeholder='Order'
            style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
          />
          <button
            onClick={addSource}
            disabled={saving === 'new' || !newName.trim() || !newUrl.trim()}
            style={{
              fontFamily: FONT_INTER,
              fontSize: 12,
              fontWeight: 500,
              background: COLORS.primary,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 12px',
              cursor: 'pointer',
              opacity: saving === 'new' || !newName.trim() || !newUrl.trim() ? 0.5 : 1,
            }}
          >
            {saving === 'new' ? 'Saving…' : 'Add'}
          </button>
        </div>
      </Card>

      {sources.map(s => (
        <Card key={s.id} style={{ padding: 12, display: 'grid', gridTemplateColumns: 'minmax(150px,1fr) minmax(250px,2fr) minmax(180px,1fr) 90px auto auto', gap: 8, alignItems: 'center' }}>
          <input
            value={s.name}
            onChange={e => patchSource(s.id, { name: e.target.value })}
            disabled={saving === s.id}
            style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
          />
          <input
            value={s.url}
            onChange={e => patchSource(s.id, { url: e.target.value })}
            disabled={saving === s.id}
            style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
          />
          <input
            value={s.notes ?? ''}
            onChange={e => patchSource(s.id, { notes: e.target.value || null })}
            disabled={saving === s.id}
            placeholder='Notes'
            style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
          />
          <input
            type='number'
            value={String(s.display_order)}
            onChange={e => patchSource(s.id, { displayOrder: Number(e.target.value || '0') })}
            disabled={saving === s.id}
            style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
          />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: COLORS.body }}>
            <input
              type='checkbox'
              checked={s.active}
              disabled={saving === s.id}
              onChange={e => patchSource(s.id, { active: e.target.checked })}
            />
            Active
          </label>
          <button
            onClick={() => deleteSource(s.id)}
            disabled={saving === s.id}
            style={{
              fontFamily: FONT_INTER,
              fontSize: 12,
              fontWeight: 500,
              background: '#fff',
              color: '#B91C1C',
              border: '1px solid #FCA5A5',
              borderRadius: 6,
              padding: '7px 10px',
              cursor: 'pointer',
              opacity: saving === s.id ? 0.5 : 1,
            }}
          >
            Delete
          </button>
        </Card>
      ))}
    </div>
  )
}
