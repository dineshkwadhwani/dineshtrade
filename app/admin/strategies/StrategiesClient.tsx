'use client'

// Task 6.9 — Platform Strategies. Publish toggle + inline JSON editor for
// params/exits/giftNiftyGate.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { Badge, Card, primaryButtonStyle, secondaryButtonStyle } from '@/components/dalgo/ui'

export interface PlatformStrategyRow {
  id: string
  name: string
  type: string
  published: boolean
  scan_interval_min: number
  params: unknown
  exits: unknown
  gift_nifty_gate: unknown
  activeCustomerCount: number
}

export interface CustomerOption {
  id: string
  name: string
}

interface Props {
  strategies: PlatformStrategyRow[]
  customers: CustomerOption[]
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      style={{
        width: 44,
        height: 24,
        borderRadius: 999,
        border: 'none',
        background: checked ? COLORS.statusGreenText : '#E2E8F0',
        position: 'relative',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }}
      />
    </button>
  )
}

export default function StrategiesClient({ strategies: initial, customers }: Props) {
  const router = useRouter()
  const [strategies, setStrategies] = useState(initial)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [paramsDraft, setParamsDraft] = useState('')
  const [exitsDraft, setExitsDraft] = useState('')
  const [gateDraft, setGateDraft] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // push state keyed by strategy id
  const [pushTarget, setPushTarget] = useState<Record<string, string>>({})
  const [pushing, setPushing] = useState<string | null>(null)

  async function togglePublished(s: PlatformStrategyRow) {
    setTogglingId(s.id)
    try {
      const res = await fetch(`/api/dalgo/admin/strategies/${s.id}/publish`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: !s.published }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error || 'Failed to toggle published status.')
      } else {
        setStrategies(prev => prev.map(x => (x.id === s.id ? { ...x, published: !s.published } : x)))
      }
    } finally {
      setTogglingId(null)
    }
  }

  function startEdit(s: PlatformStrategyRow) {
    setEditingId(s.id)
    setParamsDraft(JSON.stringify(s.params, null, 2))
    setExitsDraft(JSON.stringify(s.exits, null, 2))
    setGateDraft(JSON.stringify(s.gift_nifty_gate, null, 2))
    setJsonError(null)
  }

  async function handleSave(s: PlatformStrategyRow) {
    let paramsParsed: unknown
    let exitsParsed: unknown
    let gateParsed: unknown
    try {
      paramsParsed = JSON.parse(paramsDraft)
      exitsParsed = JSON.parse(exitsDraft)
      gateParsed = gateDraft.trim() ? JSON.parse(gateDraft) : null
    } catch {
      setJsonError('One of the JSON fields is invalid — check for a trailing comma or unquoted key.')
      return
    }
    setJsonError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/dalgo/admin/strategies/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: paramsParsed, exits: exitsParsed, giftNiftyGate: gateParsed }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to save strategy.')
      } else {
        setEditingId(null)
        if (body.affectedCustomers) {
          alert(`Saved. Pushed to ${body.affectedCustomers} customer(s) with this strategy active — they've been emailed.`)
        }
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handlePush(s: PlatformStrategyRow) {
    const target = pushTarget[s.id] ?? '__all__'
    const label = target === '__all__' ? 'all customers' : (customers.find(c => c.id === target)?.name ?? target)
    if (!confirm(`Push platform params for "${s.name}" to ${label}?`)) return
    setPushing(s.id)
    try {
      const res = await fetch(`/api/dalgo/admin/strategies/${s.id}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target === '__all__' ? {} : { targetCustomerId: target }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Push failed.')
      } else {
        alert(`Pushed "${s.name}" to ${body.affectedCustomers} customer(s).`)
      }
    } finally {
      setPushing(null)
    }
  }

  const textareaStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: 12,
    width: '100%',
    borderRadius: 6,
    border: `1px solid ${COLORS.border}`,
    padding: 10,
    minHeight: 140,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {strategies.map(s => (
        <Card key={s.id} style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: FONT_INTER, fontWeight: 600, fontSize: 14, color: COLORS.heading }}>{s.name}</span>
                <Badge tone="teal">{s.type}</Badge>
              </div>
              <div style={{ fontSize: 12, color: COLORS.body, marginTop: 4 }}>
                Scans every {s.scan_interval_min} min · {s.activeCustomerCount} customer(s) active
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: COLORS.muted }}>{s.published ? 'Published' : 'Unpublished'}</span>
                <Toggle checked={s.published} disabled={togglingId === s.id} onChange={() => togglePublished(s)} />
              </div>
              {editingId !== s.id && (
                <button onClick={() => startEdit(s)} style={secondaryButtonStyle}>
                  Edit
                </button>
              )}
            </div>
          </div>

          {/* Push row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: COLORS.muted, flexShrink: 0 }}>Push to:</span>
            <select
              value={pushTarget[s.id] ?? '__all__'}
              onChange={e => setPushTarget(prev => ({ ...prev, [s.id]: e.target.value }))}
              style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${COLORS.border}`, fontFamily: FONT_INTER, color: COLORS.body }}
            >
              <option value="__all__">All Customers</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={() => handlePush(s)}
              disabled={pushing === s.id}
              style={{ ...secondaryButtonStyle, opacity: pushing === s.id ? 0.6 : 1 }}
            >
              {pushing === s.id ? 'Pushing…' : 'Push'}
            </button>
          </div>

          {editingId === s.id && (
            <div style={{ marginTop: 16, borderTop: `1px solid ${COLORS.border}`, paddingTop: 16 }}>
              {jsonError && (
                <div style={{ color: COLORS.statusRedText, fontSize: 12, marginBottom: 10 }}>{jsonError}</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: COLORS.muted }}>params (JSON)</label>
                  <textarea value={paramsDraft} onChange={e => setParamsDraft(e.target.value)} style={{ ...textareaStyle, marginTop: 4 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: COLORS.muted }}>exits (JSON)</label>
                  <textarea value={exitsDraft} onChange={e => setExitsDraft(e.target.value)} style={{ ...textareaStyle, marginTop: 4, minHeight: 60 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: COLORS.muted }}>giftNiftyGate (JSON, or blank for null)</label>
                  <textarea value={gateDraft} onChange={e => setGateDraft(e.target.value)} style={{ ...textareaStyle, marginTop: 4, minHeight: 60 }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleSave(s)} disabled={saving} style={{ ...primaryButtonStyle, opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : 'Save & Push to Active Customers'}
                </button>
                <button onClick={() => setEditingId(null)} disabled={saving} style={secondaryButtonStyle}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
