'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'

const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"
const C = {
  bg: '#F8FAFF', card: '#FFFFFF', inputBg: '#EFF6FF', border: '#BFDBFE',
  heading: '#1E3A8A', body: '#475569', muted: '#94A3B8',
  green: '#52b788', greenBg: 'rgba(82,183,136,0.12)', greenBd: 'rgba(82,183,136,0.35)',
  red: '#e05a5e', redBg: 'rgba(224,90,94,0.12)', redBd: 'rgba(224,90,94,0.35)',
  blue: '#3B82F6', blueBg: 'rgba(59,130,246,0.10)', blueBd: 'rgba(59,130,246,0.35)',
}

interface Props {
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  price: number
  targetCustomerId?: string
  label?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  onSuccess?: () => void
}

export default function OrderModalButton({ symbol, side, quantity, price, targetCustomerId, label, disabled, size = 'sm', onSuccess }: Props) {
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(quantity)
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [limitPrice, setLimitPrice] = useState(price)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  function openModal() {
    if (disabled) return
    setQty(quantity)
    setLimitPrice(price)
    setOrderType('MARKET')
    setResult(null)
    setOpen(true)
  }

  async function placeOrder() {
    if (busy) return
    if (qty < 1) { setResult({ ok: false, msg: '✗ Quantity must be ≥ 1' }); return }
    if (orderType === 'LIMIT' && limitPrice <= 0) { setResult({ ok: false, msg: '✗ Limit price required' }); return }
    setBusy(true); setResult(null)
    try {
      const r = await fetch('/api/dalgo/customer/engine/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol, side, quantity: qty,
          price: orderType === 'LIMIT' ? limitPrice : price,
          orderType,
          ...(orderType === 'LIMIT' ? { limitPrice } : {}),
          ...(targetCustomerId ? { targetCustomerId } : {}),
        }),
      })
      const d = await r.json()
      if (!r.ok) { setResult({ ok: false, msg: `✗ ${d.reason ?? d.error ?? `HTTP ${r.status}`}` }); return }
      setResult({ ok: true, msg: `✓ ${d.orderId ?? 'Placed'}` })
      onSuccess?.()
      setTimeout(() => setOpen(false), 1400)
    } catch (e) {
      setResult({ ok: false, msg: `✗ ${String(e)}` })
    } finally { setBusy(false) }
  }

  const isBuy = side === 'BUY'
  const accent = isBuy ? C.green : C.red
  const accentBg = isBuy ? C.greenBg : C.redBg
  const accentBd = isBuy ? C.greenBd : C.redBd
  const pad = size === 'sm' ? '4px 10px' : '7px 16px'
  const fs = size === 'sm' ? 11 : 12
  const tradeValue = (orderType === 'LIMIT' ? limitPrice : price) * qty

  return (
    <>
      <button onClick={openModal} disabled={disabled}
        style={{
          padding: pad, borderRadius: 6,
          border: `1px solid ${disabled ? '#E2E8F0' : accentBd}`,
          background: disabled ? '#F8FAFF' : accentBg,
          color: disabled ? '#CBD5E1' : accent,
          fontFamily: INTER, fontWeight: 700, fontSize: fs,
          cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
        }}>
        {label ?? (isBuy ? '▶ BUY' : '▼ SELL')}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={() => !busy && setOpen(false)}>
          <div style={{ background: C.card, border: `1px solid ${accentBd}`, borderRadius: 16, width: '100%', maxWidth: 400, fontFamily: INTER }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: accent }}>{side} · {symbol}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>LTP ₹{price.toFixed(2)}</p>
              </div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Quantity */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quantity</label>
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>≈ ₹{Math.round(tradeValue).toLocaleString('en-IN')}</span>
                </div>
                <input type="number" min={1} value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)}
                  style={{ width: '100%', padding: '9px 12px', background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.heading, fontFamily: MONO, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>

              {/* Order type */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Order Type</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['MARKET', 'LIMIT'] as const).map(t => (
                    <button key={t} onClick={() => setOrderType(t)}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        background: orderType === t ? C.blueBg : C.bg,
                        border: `1px solid ${orderType === t ? C.blueBd : C.border}`,
                        color: orderType === t ? C.blue : C.muted,
                      }}>{t}</button>
                  ))}
                </div>
              </div>

              {/* Limit price */}
              {orderType === 'LIMIT' && (
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Limit Price (₹)</label>
                  <input type="number" step="0.05" min={0} value={limitPrice} onChange={e => setLimitPrice(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', padding: '9px 12px', background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.heading, fontFamily: MONO, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {result && (
                <p style={{ margin: 0, fontSize: 12, color: result.ok ? C.green : C.red, fontFamily: INTER }}>{result.msg}</p>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setOpen(false)} disabled={busy}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.body, fontFamily: INTER, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={placeOrder} disabled={busy || qty < 1}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${accentBd}`, background: accentBg, color: accent, fontFamily: INTER, fontWeight: 700, fontSize: 13, cursor: busy || qty < 1 ? 'not-allowed' : 'pointer', opacity: busy || qty < 1 ? 0.6 : 1 }}>
                  {busy ? 'Placing…' : `Place ${side}`}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
