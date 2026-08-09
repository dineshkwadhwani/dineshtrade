'use client'

// Task 6.7 — Fixed Rules editor. Updates local state directly from the PUT
// response instead of router.refresh() — spec explicitly says "Do NOT
// require page reload — update UI immediately after save."

import { useState } from 'react'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { Card, dangerButtonStyle, secondaryButtonStyle, Table, Td, Th } from '@/components/dalgo/ui'

export interface FixedRuleRow {
  id: string
  rule_key: string
  rule_name: string
  description: string | null
  value: unknown
  value_type: 'boolean' | 'number' | 'string'
  warning_message: string | null
  updated_at: string
  updatedByName: string | null
}

interface Props {
  rules: FixedRuleRow[]
}

function displayValue(rule: FixedRuleRow): string {
  if (rule.value_type === 'boolean') return rule.value ? 'true' : 'false'
  return String(rule.value)
}

export default function FixedRulesClient({ rules: initialRules }: Props) {
  const [rules, setRules] = useState(initialRules)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState<string>('')
  const [confirmText, setConfirmText] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit(rule: FixedRuleRow) {
    setEditingKey(rule.rule_key)
    setDraftValue(displayValue(rule))
    setConfirmText('')
  }

  async function handleSave(rule: FixedRuleRow) {
    if (confirmText !== 'I UNDERSTAND') return
    setSaving(true)
    try {
      const value = rule.value_type === 'boolean' ? draftValue === 'true' : draftValue
      const res = await fetch(`/api/dalgo/admin/fixed-rules/${rule.rule_key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || 'Failed to update rule.')
        return
      }
      setRules(prev =>
        prev.map(r =>
          r.rule_key === rule.rule_key
            ? { ...r, value: body.rule.value, updated_at: body.rule.updated_at, updatedByName: 'you' }
            : r
        )
      )
      setEditingKey(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rules.map(rule => (
        <Card key={rule.rule_key} style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontFamily: FONT_INTER, fontWeight: 600, fontSize: 14, color: COLORS.heading }}>{rule.rule_name}</div>
              <div style={{ fontSize: 12, color: COLORS.body, marginTop: 2, maxWidth: 520 }}>{rule.description}</div>
              <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 6 }}>
                Current value: <strong style={{ color: COLORS.heading }}>{displayValue(rule)}</strong> · Last updated{' '}
                {new Date(rule.updated_at).toLocaleString('en-IN')}
                {rule.updatedByName ? ` by ${rule.updatedByName}` : ''}
              </div>
            </div>
            {editingKey !== rule.rule_key && (
              <button onClick={() => startEdit(rule)} style={secondaryButtonStyle}>
                Edit
              </button>
            )}
          </div>

          {editingKey === rule.rule_key && (
            <div style={{ marginTop: 16, borderTop: `1px solid ${COLORS.border}`, paddingTop: 16 }}>
              {rule.warning_message && (
                <div
                  style={{
                    background: COLORS.statusRedBg,
                    border: `1px solid ${COLORS.statusRedText}55`,
                    color: COLORS.statusRedText,
                    borderRadius: 8,
                    padding: 12,
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  ⚠ {rule.warning_message}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: COLORS.muted }}>New Value</label>
                  <br />
                  {rule.value_type === 'boolean' ? (
                    <select
                      value={draftValue}
                      onChange={e => setDraftValue(e.target.value)}
                      style={{ marginTop: 4, padding: '7px 9px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      type={rule.value_type === 'number' ? 'number' : 'text'}
                      value={draftValue}
                      onChange={e => setDraftValue(e.target.value)}
                      style={{ marginTop: 4, padding: '7px 9px', borderRadius: 6, border: `1px solid ${COLORS.border}` }}
                    />
                  )}
                </div>
                <div>
                  <label style={{ fontSize: 11, color: COLORS.muted }}>Type "I UNDERSTAND" to confirm</label>
                  <br />
                  <input
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder="I UNDERSTAND"
                    style={{ marginTop: 4, padding: '7px 9px', borderRadius: 6, border: `1px solid ${COLORS.border}`, minWidth: 200 }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleSave(rule)}
                  disabled={confirmText !== 'I UNDERSTAND' || saving}
                  style={{ ...dangerButtonStyle, opacity: confirmText !== 'I UNDERSTAND' || saving ? 0.5 : 1 }}
                >
                  {saving ? 'Saving…' : 'Confirm Change'}
                </button>
                <button onClick={() => setEditingKey(null)} disabled={saving} style={secondaryButtonStyle}>
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
