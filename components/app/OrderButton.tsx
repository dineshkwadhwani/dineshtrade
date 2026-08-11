'use client'
import { useState } from 'react'

interface Props {
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  price: number
  targetCustomerId?: string
  label?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

export default function OrderButton({ symbol, side, quantity, price, targetCustomerId, label, disabled, size = 'md' }: Props) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  async function handleClick() {
    if (state === 'busy' || disabled) return
    setState('busy')
    setMsg('')
    try {
      const r = await fetch('/api/dalgo/customer/engine/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, side, quantity, price, ...(targetCustomerId ? { targetCustomerId } : {}) }),
      })
      const d = await r.json()
      if (!r.ok) { setState('err'); setMsg(d.reason ?? d.error ?? `HTTP ${r.status}`); return }
      setState('ok')
      setMsg(d.orderId ? `✓ ${d.orderId}` : '✓ Placed')
    } catch (e) {
      setState('err')
      setMsg(String(e))
    }
  }

  const isBuy = side === 'BUY'
  const colors = {
    idle: isBuy ? { bg: '#DCFCE7', border: '#16A34A', color: '#16A34A' } : { bg: '#FEE2E2', border: '#DC2626', color: '#DC2626' },
    busy: { bg: '#F1F5F9', border: '#CBD5E1', color: '#94A3B8' },
    ok:   { bg: '#DCFCE7', border: '#16A34A', color: '#16A34A' },
    err:  { bg: '#FEE2E2', border: '#DC2626', color: '#DC2626' },
  }
  const c = colors[state]
  const pad = size === 'sm' ? '4px 10px' : '7px 16px'
  const fs = size === 'sm' ? 11 : 12

  if (state === 'ok' || state === 'err') {
    return (
      <span style={{ display: 'inline-block', padding: pad, borderRadius: 6, fontSize: fs, fontWeight: 600, fontFamily: "'Inter', sans-serif", background: c.bg, color: c.color, border: `1px solid ${c.border}` }}
        title={msg}>{msg.slice(0, 20)}{msg.length > 20 ? '…' : ''}</span>
    )
  }

  return (
    <button onClick={handleClick} disabled={disabled || state === 'busy'}
      style={{
        padding: pad, borderRadius: 6, border: `1px solid ${disabled ? '#E2E8F0' : c.border}`,
        background: disabled ? '#F8FAFF' : c.bg, color: disabled ? '#CBD5E1' : c.color,
        fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: fs,
        cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
      }}>
      {state === 'busy' ? '…' : (label ?? (isBuy ? '▶ BUY' : '▼ SELL'))}
    </button>
  )
}
