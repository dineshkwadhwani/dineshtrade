'use client'

import { useState } from 'react'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { Card } from '@/components/dalgo/ui'
import { IMPLEMENTED_BROKERS, type ImplementedBroker } from '@/lib/broker/supported'

const LABELS: Record<ImplementedBroker, string> = {
  zerodha: 'Zerodha',
  upstox: 'Upstox',
}

interface Props {
  initialAvailable: ImplementedBroker[]
}

export default function BrokerAvailabilityConfig({ initialAvailable }: Props) {
  const [available, setAvailable] = useState<ImplementedBroker[]>(initialAvailable)
  const [saved, setSaved] = useState<ImplementedBroker[]>(initialAvailable)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggle(broker: ImplementedBroker) {
    setAvailable(current => current.includes(broker)
      ? current.filter(item => item !== broker)
      : IMPLEMENTED_BROKERS.filter(item => item === broker || current.includes(item)))
    setError('')
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/dalgo/admin/config/AVAILABLE_BROKERS', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(available) }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || 'Could not update available brokers.')
        return
      }
      setSaved(available)
    } catch {
      setError('Connection error. Try saving again.')
    } finally {
      setSaving(false)
    }
  }

  const dirty = available.length !== saved.length || available.some(broker => !saved.includes(broker))

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: FONT_INTER, fontWeight: 700, fontSize: 14, color: COLORS.heading }}>Available Brokers</div>
          <div style={{ fontSize: 12, color: COLORS.body, marginTop: 3 }}>Controls broker choices for new and updated customer connections.</div>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          style={{
            fontFamily: FONT_INTER, fontSize: 12, fontWeight: 600,
            background: COLORS.primary, color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 13px', cursor: !dirty || saving ? 'default' : 'pointer',
            opacity: !dirty || saving ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 16 }}>
        {IMPLEMENTED_BROKERS.map(broker => (
          <label key={broker} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: FONT_INTER, fontSize: 13, color: COLORS.heading, cursor: 'pointer' }}>
            <input type="checkbox" checked={available.includes(broker)} disabled={saving} onChange={() => toggle(broker)} />
            {LABELS[broker]}
          </label>
        ))}
      </div>
      {error && <div role="alert" style={{ color: '#B91C1C', fontSize: 12, marginTop: 12 }}>{error}</div>}
    </Card>
  )
}