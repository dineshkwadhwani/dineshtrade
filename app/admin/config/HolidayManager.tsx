'use client'

import { useMemo, useState } from 'react'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { Card } from '@/components/dalgo/ui'

export interface HolidayRow {
  id: string
  market: string
  holiday_date: string
  name: string
  notes: string | null
  active: boolean
}

interface Props {
  initialHolidays: HolidayRow[]
}

function byDate(a: HolidayRow, b: HolidayRow): number {
  return String(a.holiday_date || '').localeCompare(String(b.holiday_date || ''))
}

export default function HolidayManager({ initialHolidays }: Props) {
  const safeInitial = Array.isArray(initialHolidays)
    ? initialHolidays.filter(h => h && typeof h.id === 'string')
    : []
  const [holidays, setHolidays] = useState<HolidayRow[]>([...safeInitial].sort(byDate))
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [newDate, setNewDate] = useState('')
  const [newName, setNewName] = useState('')
  const [newNotes, setNewNotes] = useState('')

  const todayCount = useMemo(() => holidays.filter(h => h.active).length, [holidays])

  async function addHoliday() {
    if (!newDate || !newName.trim()) return
    setSaving('new')
    try {
      const res = await fetch('/api/dalgo/admin/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: 'NSE',
          holidayDate: newDate,
          name: newName.trim(),
          notes: newNotes.trim() || null,
          active: true,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to create holiday.')
        return
      }
      const created = body.holiday as HolidayRow
      setHolidays(prev => [...prev, created].sort(byDate))
      setNewDate('')
      setNewName('')
      setNewNotes('')
    } finally {
      setSaving(null)
    }
  }

  async function patchHoliday(id: string, patch: Partial<{ holidayDate: string; name: string; notes: string | null; active: boolean }>) {
    setSaving(id)
    try {
      const res = await fetch(`/api/dalgo/admin/holidays/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to update holiday.')
        return
      }
      const updated = body.holiday as HolidayRow
      setHolidays(prev => prev.map(h => (h.id === id ? updated : h)).sort(byDate))
    } finally {
      setSaving(null)
    }
  }

  async function deleteHoliday(id: string) {
    if (!confirm('Delete this holiday?')) return
    setSaving(id)
    try {
      const res = await fetch(`/api/dalgo/admin/holidays/${id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to delete holiday.')
        return
      }
      setHolidays(prev => prev.filter(h => h.id !== id))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card style={{ padding: 16 }}>
        <button
          type='button'
          onClick={() => setOpen(v => !v)}
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'transparent',
            border: 'none',
            padding: 0,
            marginBottom: open ? 12 : 0,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                color: COLORS.muted,
                fontSize: 12,
                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
                display: 'inline-block',
              }}
            >
              ▶
            </span>
            <div style={{ fontFamily: FONT_INTER, fontWeight: 600, fontSize: 14, color: COLORS.heading }}>NSE Holidays</div>
          </div>
          <div style={{ fontSize: 12, color: COLORS.body }}>Active holidays: {todayCount}</div>
        </button>

        {open && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(220px,1fr) minmax(220px,1fr) auto', gap: 8, alignItems: 'center' }}>
              <input
                type='date'
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
              />
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder='Holiday name'
                style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
              />
              <input
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
                placeholder='Notes (optional)'
                style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
              />
              <button
                onClick={addHoliday}
                disabled={saving === 'new' || !newDate || !newName.trim()}
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
                  opacity: saving === 'new' || !newDate || !newName.trim() ? 0.5 : 1,
                }}
              >
                {saving === 'new' ? 'Saving…' : 'Add'}
              </button>
            </div>

            {holidays.map(h => (
              <Card key={h.id} style={{ padding: 12, display: 'grid', gridTemplateColumns: '170px minmax(180px,1fr) minmax(220px,1fr) auto auto', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <input
                  type='date'
                  value={h.holiday_date}
                  onChange={e => patchHoliday(h.id, { holidayDate: e.target.value })}
                  disabled={saving === h.id}
                  style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
                />
                <input
                  value={h.name}
                  onChange={e => patchHoliday(h.id, { name: e.target.value })}
                  disabled={saving === h.id}
                  style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
                />
                <input
                  value={h.notes ?? ''}
                  onChange={e => patchHoliday(h.id, { notes: e.target.value || null })}
                  disabled={saving === h.id}
                  placeholder='Notes'
                  style={{ fontFamily: FONT_INTER, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: COLORS.body }}>
                  <input
                    type='checkbox'
                    checked={h.active}
                    disabled={saving === h.id}
                    onChange={e => patchHoliday(h.id, { active: e.target.checked })}
                  />
                  Active
                </label>
                <button
                  onClick={() => deleteHoliday(h.id)}
                  disabled={saving === h.id}
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
                    opacity: saving === h.id ? 0.5 : 1,
                  }}
                >
                  Delete
                </button>
              </Card>
            ))}
          </>
        )}
      </Card>
    </div>
  )
}
