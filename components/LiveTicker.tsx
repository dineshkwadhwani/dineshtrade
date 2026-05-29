'use client'
import { useEffect, useState } from 'react'

interface IndexQuote {
  label: string
  ltp: number | null
  changePct: number | null
  source: 'kite' | 'briefing' | 'unavailable'
}

interface TickerResponse {
  indices?: Record<string, IndexQuote>
  fetchedAt?: string
}

const REFRESH_MS = 30 * 1000

// Keys shown on mobile (compact) — only the two headline indices
const MOBILE_KEYS = ['nifty50', 'sensex']

// Keys shown on desktop — full set including sectoral indices
const DESKTOP_KEYS = [
  'nifty50', 'sensex', 'vix',
  'niftyBank', 'niftyAuto', 'niftyFin', 'niftyIT', 'nifty100', 'niftyInfra',
]

export default function LiveTicker() {
  const [data, setData] = useState<TickerResponse | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/market/indices', { cache: 'no-store' })
      if (r.ok) setData(await r.json())
    } catch { /* silent */ }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  if (!data?.indices) return null
  const indices = data.indices

  function renderItem(key: string, i: number, isFirst: boolean) {
    const idx = indices[key]
    if (!idx || idx.source === 'unavailable') return null
    const chg = idx.changePct
    const positive = chg !== null && chg > 0
    const negative = chg !== null && chg < 0
    const valueColor = positive ? '#52b788' : negative ? '#e05a5e' : 'rgba(255,255,255,0.65)'
    const arrow = chg === null ? '' : chg > 0 ? '▲' : chg < 0 ? '▼' : '─'
    const isBriefing = idx.source === 'briefing'

    return (
      <div key={key} className="flex items-center gap-1.5 whitespace-nowrap"
        style={{ borderLeft: isFirst ? 'none' : '1px solid rgba(255,255,255,0.08)', paddingLeft: isFirst ? 0 : 14 }}>
        <span style={{ color: 'rgba(201,168,76,0.7)', fontSize: 11, letterSpacing: '0.06em', fontFamily:'JetBrains Mono, monospace' }}>
          {idx.label}
          {isBriefing && <span style={{ color:'rgba(255,255,255,0.3)', fontSize:9, marginLeft:3 }}>(pre)</span>}
        </span>
        {idx.ltp !== null && (
          <span style={{ color: valueColor, fontSize: 12, fontWeight: 700, fontFamily:'JetBrains Mono, monospace' }}>
            {idx.ltp.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </span>
        )}
        {chg !== null && (
          <span style={{ color: valueColor, fontSize: 11, fontWeight: 600, fontFamily:'JetBrains Mono, monospace' }}>
            {arrow} {Math.abs(chg).toFixed(2)}%
          </span>
        )}
      </div>
    )
  }

  const mobileItems = MOBILE_KEYS.map((k, i) => renderItem(k, i, i === 0)).filter(Boolean)
  const desktopItems = DESKTOP_KEYS.map((k, i) => renderItem(k, i, i === 0)).filter(Boolean)

  if (mobileItems.length === 0 && desktopItems.length === 0) return null

  return (
    <div className="w-full overflow-x-hidden ticker-strip"
      style={{ background: 'rgba(8,6,4,0.95)', borderBottom: '1px solid rgba(201,168,76,0.15)', backdropFilter: 'blur(8px)' }}>

      {/* Mobile — NIFTY 50 + SENSEX only */}
      <div className="flex sm:hidden items-center gap-0 px-4 py-2 min-w-fit">
        {mobileItems}
      </div>

      {/* Desktop — full set */}
      <div className="hidden sm:flex items-center gap-0 px-4 py-2 min-w-fit">
        {desktopItems}
      </div>
    </div>
  )
}
