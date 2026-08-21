'use client'
import { useState, useRef, useEffect } from 'react'

export interface StrategyOption {
  id: string
  label: string
  color: string
}

interface Props {
  symbol: string
  currentTag: string
  strategies: StrategyOption[]   // active strategies passed from the server page
  targetCustomerId?: string
  onChanged?: (newTag: string) => void
  // For untracked Kite holdings — sent to the API so it can create the position
  kiteQty?: number
  kiteAvgPrice?: number
  // Position fully sold — show the tag it was held under, but read-only
  disabled?: boolean
}

function colorFor(strategies: StrategyOption[], tag: string) {
  return strategies.find(s => s.id === tag)?.color ?? '#6B7280'
}

export default function StrategyTagButton({ symbol, currentTag, strategies, targetCustomerId, onChanged, kiteQty, kiteAvgPrice, disabled }: Props) {
  const [tag, setTag] = useState(currentTag)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  if (disabled) {
    const dColor = colorFor(strategies, tag)
    return (
      <span
        title="Position fully sold today — strategy locked"
        style={{
          padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
          background: dColor + '20', color: dColor, border: `1px solid ${dColor}40`,
          opacity: 0.65, cursor: 'not-allowed',
        }}
      >
        {tag}
      </span>
    )
  }

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function handleSelect(newTag: string) {
    if (newTag === tag) { setOpen(false); return }
    setSaving(true); setError(''); setOpen(false)
    try {
      const res = await fetch('/api/dalgo/customer/positions/strategy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          strategyId: newTag,
          ...(targetCustomerId ? { targetCustomerId } : {}),
          // Included when tagging an untracked Kite holding so the API can create the position
          ...(kiteQty != null ? { kiteQty } : {}),
          ...(kiteAvgPrice != null ? { kiteAvgPrice } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Show error prominently via alert so it's never missed
        alert(`Could not update strategy for ${symbol}: ${data.error || 'Unknown error'}`)
        setSaving(false)
        return
      }
      setTag(newTag)
      onChanged?.(newTag)
    } catch { alert(`Network error updating strategy for ${symbol}. Please try again.`) }
    finally { setSaving(false) }
  }

  const isUntracked = tag === 'untracked'
  const color = isUntracked ? '#94A3B8' : colorFor(strategies, tag)
  const displayLabel = isUntracked ? '+ Assign' : tag

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => { setError(''); setOpen(o => !o) }}
        disabled={saving}
        title={isUntracked ? 'Assign a strategy to track this holding' : strategies.length === 0 ? 'No active strategies to assign' : 'Click to change strategy'}
        style={{
          padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
          background: isUntracked ? '#F1F5F9' : color + '20',
          color: isUntracked ? '#64748B' : color,
          border: `1px solid ${isUntracked ? '#CBD5E1' : color + '40'}`,
          cursor: saving ? 'wait' : 'pointer',
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? '…' : displayLabel} {strategies.length > 0 ? '▾' : ''}
      </button>
      {error && <span style={{ fontSize: 10, color: '#DC2626', marginLeft: 4 }}>{error}</span>}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50,
          background: '#fff', border: '1px solid #BFDBFE', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(30,58,138,0.12)', minWidth: 180, overflow: 'hidden',
        }}>
          {strategies.length === 0 ? (
            <div style={{ padding: '12px 14px', fontFamily: "'Inter', sans-serif", fontSize: 12, color: '#94A3B8' }}>
              No active strategies.<br />
              <span style={{ fontSize: 11 }}>Activate a strategy in Settings to reassign.</span>
            </div>
          ) : (
            strategies.map(opt => (
              <button
                key={opt.id}
                onClick={() => handleSelect(opt.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 14px', border: 'none', cursor: 'pointer',
                  fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600,
                  background: opt.id === tag ? opt.color + '15' : '#fff',
                  color: opt.id === tag ? opt.color : '#475569',
                }}
              >
                <span style={{ padding: '1px 6px', borderRadius: 999, background: opt.color + '20', color: opt.color }}>
                  {opt.label}
                </span>
                {!isUntracked && opt.id === tag && <span style={{ marginLeft: 6, fontSize: 10, color: opt.color }}>✓ current</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
