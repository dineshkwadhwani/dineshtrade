'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export interface AccountDisplay {
  name: string
  displayName: string
  initials: string
  color: string
  note: string
}

interface OrderModalProps {
  isOpen: boolean
  onClose: () => void
  symbol: string
  symbolName?: string
  initialSide: 'BUY' | 'SELL'
  ltp?: number              // current LTP for default price + estimated value
  dayChangePct?: number     // today's % change from prev close — shown next to LTP for direction context
  initialQty?: number       // pre-fill (e.g. held quantity for SELL)
  initialProduct?: 'CNC' | 'MIS'  // pre-fill product (e.g. position's product for square-off)
  // Optional order tag. Defaults to 'dt-manual'. Engine page tiles override
  // this with the strategy tag ('dt-s1' / 'dt-s2') so a BUY initiated from a
  // strategy tile is owned by that strategy's monitor — even though the user
  // clicked it themselves and the order still bypasses rate-limit gates via
  // `manual: true`. Watchlist / Holdings / Positions stay as 'dt-manual'.
  initialTag?: string
  accounts: AccountDisplay[]
  defaultAccount?: string
  onSuccess?: () => void    // called after successful place; pages refresh data
}

export default function OrderModal({
  isOpen, onClose, symbol, symbolName, initialSide, ltp, dayChangePct,
  initialQty, initialProduct, initialTag, accounts, defaultAccount, onSuccess,
}: OrderModalProps) {
  const [account, setAccount] = useState(defaultAccount || accounts[0]?.name || '')
  const [side, setSide] = useState<'BUY' | 'SELL'>(initialSide)
  const [qty, setQty] = useState<number>(initialQty ?? Math.max(1, Math.floor(5000 / Math.max(1, ltp || 1))))
  const [product, setProduct] = useState<'CNC' | 'MIS'>(initialProduct || 'CNC')
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [limitPrice, setLimitPrice] = useState<number>(ltp || 0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // Reset fields when reopening for a different context
  useEffect(() => {
    if (!isOpen) return
    setSide(initialSide)
    setQty(initialQty ?? Math.max(1, Math.floor(5000 / Math.max(1, ltp || 1))))
    setProduct(initialProduct || 'CNC')
    setOrderType('MARKET')
    setLimitPrice(ltp || 0)
    setResult(null)
    if (defaultAccount) setAccount(defaultAccount)
    else if (accounts.length > 0 && !account) setAccount(accounts[0].name)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, symbol, initialSide, initialQty, initialProduct, ltp, defaultAccount])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const effectivePrice = orderType === 'LIMIT' ? limitPrice : (ltp || 0)
  const tradeValue = effectivePrice * qty

  async function placeOrder() {
    if (!account) { setResult({ ok: false, msg: '✗ Pick an account' }); return }
    if (!qty || qty < 1) { setResult({ ok: false, msg: '✗ Quantity must be ≥ 1' }); return }
    if (orderType === 'LIMIT' && (!limitPrice || limitPrice <= 0)) {
      setResult({ ok: false, msg: '✗ Limit price required' }); return
    }
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/zerodha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account,
          action: 'place_order',
          order: {
            symbol,
            symbolName,
            quantity: qty,
            transaction_type: side,
            product,
            orderType,
            limitPrice: orderType === 'LIMIT' ? limitPrice : undefined,
            price: effectivePrice,            // for preflight funds estimation
            tag: initialTag || 'dt-manual',
            manual: true,
            source: `Manual ${side} (${product}/${orderType})`,
            reason: orderType === 'LIMIT'
              ? `${side} ${qty} × ${symbol} as ${product} LIMIT @ ₹${limitPrice}`
              : `${side} ${qty} × ${symbol} as ${product} MARKET`,
          },
        }),
      })
      const data = await res.json()
      if (res.ok && data.data?.order_id) {
        const note = data.adjustedQty !== undefined ? ` (clamped to ${data.adjustedQty})` : ''
        setResult({ ok: true, msg: `✓ Order ${data.data.order_id}${note}` })
        if (onSuccess) onSuccess()
        setTimeout(onClose, 1400)
      } else if (data.gate) {
        setResult({ ok: false, msg: `✗ [${data.gate}] ${data.reason}` })
      } else {
        setResult({ ok: false, msg: `✗ ${data.message || data.error || `HTTP ${res.status}`}` })
      }
    } catch {
      setResult({ ok: false, msg: '✗ Network error' })
    } finally {
      setBusy(false)
    }
  }

  const accentColor = side === 'BUY' ? '#52b788' : '#e05a5e'
  const accentBg    = side === 'BUY' ? 'rgba(82,183,136,0.15)' : 'rgba(224,90,94,0.15)'
  const accentBd    = side === 'BUY' ? 'rgba(82,183,136,0.4)'  : 'rgba(224,90,94,0.4)'

  // Render via portal so parent transforms (page-level animations, AppShell
  // layout) can't break `position: fixed` centering. Animation goes on the
  // inner card, not the backdrop, for the same reason.
  if (typeof document === 'undefined') return null
  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden animate-fade-up"
        style={{ background: '#100e0a', border: '1px solid rgba(201,168,76,0.2)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'rgba(201,168,76,0.12)' }}>
          <div>
            <h3 className="text-base font-semibold" style={{ color: accentColor }}>{side} · {symbol}</h3>
            {symbolName && <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{symbolName}</p>}
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Side toggle */}
          <Field label="Side">
            <div className="flex gap-2">
              {(['BUY', 'SELL'] as const).map(s => (
                <button key={s} onClick={() => setSide(s)}
                  className="flex-1 py-2 rounded-lg text-[12px] font-semibold tracking-wider transition-all"
                  style={{
                    background: side === s
                      ? (s === 'BUY' ? 'rgba(82,183,136,0.15)' : 'rgba(224,90,94,0.15)')
                      : 'rgba(255,255,255,0.03)',
                    border: side === s
                      ? `1px solid ${s === 'BUY' ? 'rgba(82,183,136,0.4)' : 'rgba(224,90,94,0.4)'}`
                      : '1px solid rgba(255,255,255,0.06)',
                    color: side === s ? (s === 'BUY' ? '#52b788' : '#e05a5e') : 'rgba(255,255,255,0.4)',
                  }}>{s}</button>
              ))}
            </div>
          </Field>

          {/* Account (only if multiple) */}
          {accounts.length > 1 && (
            <Field label="Account">
              <select value={account} onChange={e => setAccount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)' }}>
                {accounts.map(a => <option key={a.name} value={a.name}>{a.displayName}</option>)}
              </select>
            </Field>
          )}

          {/* Quantity */}
          <Field label="Quantity" rightLabel={ltp ? `≈ ₹${Math.round(tradeValue).toLocaleString('en-IN')}` : undefined}>
            <input type="number" min={1} value={qty}
              onChange={e => setQty(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg text-[14px] outline-none"
              style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.85)', fontFamily: 'JetBrains Mono, monospace',
              }} />
          </Field>

          {/* Product */}
          <Field label="Product">
            <div className="flex gap-2">
              {(['CNC', 'MIS'] as const).map(p => (
                <button key={p} onClick={() => setProduct(p)}
                  className="flex-1 py-2 rounded-lg text-[11px] font-medium tracking-wider transition-all"
                  style={{
                    background: product === p ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.03)',
                    border: product === p ? '1px solid rgba(201,168,76,0.4)' : '1px solid rgba(255,255,255,0.06)',
                    color: product === p ? '#c9a84c' : 'rgba(255,255,255,0.4)',
                  }}>
                  {p === 'CNC' ? 'CNC · Delivery' : 'MIS · Intraday'}
                </button>
              ))}
            </div>
          </Field>

          {/* Order Type */}
          <Field label="Order Type" rightLabel={ltp ? (
            <>
              <span>LTP ₹{ltp.toFixed(2)}</span>
              {dayChangePct !== undefined && (
                <span style={{
                  marginLeft: 6,
                  color: dayChangePct > 0 ? '#52b788' : dayChangePct < 0 ? '#e05a5e' : 'rgba(255,255,255,0.4)',
                }}>
                  · {dayChangePct > 0 ? '▲' : dayChangePct < 0 ? '▼' : '─'} {Math.abs(dayChangePct).toFixed(2)}%
                </span>
              )}
            </>
          ) : undefined}>
            <div className="flex gap-2 mb-2">
              {(['MARKET', 'LIMIT'] as const).map(t => (
                <button key={t} onClick={() => setOrderType(t)}
                  className="flex-1 py-2 rounded-lg text-[11px] font-medium tracking-wider transition-all"
                  style={{
                    background: orderType === t ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.03)',
                    border: orderType === t ? '1px solid rgba(201,168,76,0.4)' : '1px solid rgba(255,255,255,0.06)',
                    color: orderType === t ? '#c9a84c' : 'rgba(255,255,255,0.4)',
                  }}>{t}</button>
              ))}
            </div>
            {orderType === 'LIMIT' && (
              <input type="number" step="0.05" min={0} value={limitPrice}
                onChange={e => setLimitPrice(parseFloat(e.target.value) || 0)}
                placeholder="Limit price (₹)"
                className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
                style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.85)', fontFamily: 'JetBrains Mono, monospace',
                }} />
            )}
          </Field>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t space-y-3" style={{ borderColor: 'rgba(201,168,76,0.12)' }}>
          {result && (
            <p className="text-[12px]" style={{ color: result.ok ? '#52b788' : 'rgba(224,90,94,0.85)' }}>{result.msg}</p>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={busy}
              className="flex-1 py-3 rounded-lg text-[12px] font-medium tracking-wider"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
              Cancel
            </button>
            <button onClick={placeOrder} disabled={busy || !account || qty < 1}
              className="flex-1 py-3 rounded-lg text-[12px] font-bold tracking-wider uppercase disabled:opacity-50"
              style={{
                background: accentBg, border: `1px solid ${accentBd}`, color: accentColor,
              }}>
              {busy ? 'Placing…' : `Place ${side}`}
            </button>
          </div>
          <p className="text-[10px] text-center" style={{ color: 'rgba(255,255,255,0.25)' }}>
            Manual order · bypasses per-trade cap & day quota · funds + short-sell gates still apply
          </p>
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
}

function Field({ label, rightLabel, children }: { label: string; rightLabel?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex justify-between mb-2">
        <p className="text-[10px] tracking-widest uppercase"
          style={{ color: 'rgba(201,168,76,0.5)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</p>
        {rightLabel && (
          <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>
            {rightLabel}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
