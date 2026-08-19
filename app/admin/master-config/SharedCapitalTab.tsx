'use client'

import { useState } from 'react'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { Card } from '@/components/dalgo/ui'

const CAPITAL_LABELS: Record<string, { label: string; unit?: string; desc: string }> = {
  per_trade:                    { label: 'Per Trade', unit: '₹', desc: 'Default capital deployed per single auto-buy order for new customers.' },
  max_buys_per_day:             { label: 'Max Buys / Day', desc: 'Default total auto-buy orders allowed per calendar day.' },
  max_sells_per_day:            { label: 'Max Sells / Day', desc: 'Default total auto-sell orders allowed per calendar day.' },
  max_positions:                { label: 'Max Open Positions', desc: 'Default maximum simultaneously open positions across all strategies.' },
  max_buys_per_symbol:          { label: 'Max Buys / Symbol', desc: 'Default pyramid cap — max auto-buys in the same stock.' },
  min_drop_between_buys_pct:    { label: 'Min Drop Between Buys', unit: '%', desc: 'Each subsequent buy must be at least this % below the previous buy price.' },
  max_deploy_pct:               { label: 'Max Deploy %', unit: '%', desc: 'Default maximum % of total capital that can be deployed at any point.' },
  delivery_dp_charge:           { label: 'Delivery DP Charge', unit: '₹', desc: 'Per-sell DP charge for delivery orders, used in net P&L estimates.' },
  circuit_breaker_pct:          { label: 'Circuit Breaker', unit: '%', desc: 'GIFT Nifty pre-market drop % that blocks all auto-BUYs for the day.' },
  intraday_circuit_trip_pct:    { label: 'Intraday Circuit Trip', unit: '%', desc: 'Live Nifty drop from open that trips the intraday circuit.' },
  intraday_circuit_resume_pct:  { label: 'Intraday Circuit Resume', unit: '%', desc: 'Live Nifty recovery level that resumes auto-BUYs after an intraday trip.' },
  panic_drop_pct:               { label: 'Panic Drop %', unit: '%', desc: 'Per-symbol intraday drop from peak that marks it as free-fall. 0 = disabled.' },
  panic_window_min:             { label: 'Panic Window', unit: 'min', desc: 'Lookback window for the panic-sell gate (in minutes).' },
}

interface Props {
  defaults: Record<string, number>
  configKey: string
}

export default function SharedCapitalTab({ defaults, configKey }: Props) {
  const [draft, setDraft] = useState<Record<string, number>>({ ...defaults })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const changed = Object.keys(CAPITAL_LABELS).some(k => draft[k] !== defaults[k])

  async function handleSave() {
    setSaving(true); setMsg('')
    try {
      const res = await fetch(`/api/dalgo/admin/config/${configKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(draft) }),
      })
      const body = await res.json().catch(() => ({}))
      setMsg(res.ok ? 'Saved!' : (body.error || 'Save failed.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
        These are the platform default values assigned to every new customer when their account is activated.
        Changes apply to <strong>future activations only</strong> — existing customer capital configs are not affected.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {Object.entries(CAPITAL_LABELS).map(([key, meta]) => (
          <Card key={key} style={{ padding: '12px 16px', borderRadius: 0, borderBottom: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 240 }}>
              <div style={{ fontFamily: FONT_INTER, fontWeight: 600, fontSize: 13, color: COLORS.heading }}>{meta.label}</div>
              <div style={{ fontSize: 12, color: COLORS.body, marginTop: 2 }}>{meta.desc}</div>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                step="any"
                value={draft[key] ?? ''}
                onChange={e => setDraft(d => ({ ...d, [key]: Number(e.target.value) }))}
                style={{
                  fontFamily: FONT_INTER, fontSize: 13,
                  padding: meta.unit ? '7px 36px 7px 10px' : '7px 10px',
                  borderRadius: 6, border: `1px solid ${COLORS.border}`,
                  width: 140, boxSizing: 'border-box' as const,
                }}
              />
              {meta.unit && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: COLORS.muted, pointerEvents: 'none' }}>
                  {meta.unit}
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <button
          onClick={handleSave}
          disabled={saving || !changed}
          style={{
            fontFamily: FONT_INTER, fontSize: 13, fontWeight: 600,
            background: changed ? COLORS.primary : '#E2E8F0',
            color: changed ? '#fff' : COLORS.muted,
            border: 'none', borderRadius: 8, padding: '9px 22px',
            cursor: changed ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Saving…' : 'Save Defaults'}
        </button>
        {msg && <span style={{ fontFamily: FONT_INTER, fontSize: 13, color: msg === 'Saved!' ? '#16A34A' : '#DC2626' }}>{msg}</span>}
      </div>
    </div>
  )
}
