'use client'

// Task 6.8 — Platform Config. Toggle switches for booleans, text/number
// inputs for the rest. Updates local state directly from the PUT response —
// same "no reload" pattern as FixedRulesClient.

import { useState } from 'react'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { Card } from '@/components/dalgo/ui'

export interface ConfigRow {
  key: string
  value: string
  description: string | null
  value_type: 'string' | 'boolean' | 'number' | 'json'
}

interface Props {
  configs: ConfigRow[]
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
        background: checked ? COLORS.primary : '#E2E8F0',
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

export default function ConfigClient({ configs: initial }: Props) {
  const [configs, setConfigs] = useState(initial)
  const [saving, setSaving] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  async function save(key: string, value: string) {
    setSaving(key)
    try {
      const res = await fetch(`/api/dalgo/admin/config/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to update config.')
        return
      }
      setConfigs(prev => prev.map(c => (c.key === key ? { ...c, value } : c)))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {configs.map(c => (
        <Card key={c.key} style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200 }}>
            <div style={{ fontFamily: FONT_INTER, fontWeight: 600, fontSize: 13, color: COLORS.heading }}>{c.key}</div>
            <div style={{ fontSize: 12, color: COLORS.body, marginTop: 2 }}>{c.description}</div>
          </div>
          {c.value_type === 'boolean' ? (
            <Toggle checked={c.value === 'true'} disabled={saving === c.key} onChange={() => save(c.key, c.value === 'true' ? 'false' : 'true')} />
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type={c.value_type === 'number' ? 'number' : 'text'}
                value={drafts[c.key] ?? c.value}
                onChange={e => setDrafts(prev => ({ ...prev, [c.key]: e.target.value }))}
                style={{
                  fontFamily: FONT_INTER,
                  fontSize: 13,
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: `1px solid ${COLORS.border}`,
                  minWidth: 200,
                }}
              />
              <button
                onClick={() => save(c.key, drafts[c.key] ?? c.value)}
                disabled={saving === c.key || drafts[c.key] === undefined || drafts[c.key] === c.value}
                style={{
                  fontFamily: FONT_INTER,
                  fontSize: 12,
                  fontWeight: 500,
                  background: COLORS.primary,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 12px',
                  cursor: 'pointer',
                  opacity: saving === c.key || drafts[c.key] === undefined || drafts[c.key] === c.value ? 0.5 : 1,
                }}
              >
                {saving === c.key ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
