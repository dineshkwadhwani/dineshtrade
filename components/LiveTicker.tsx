'use client'
import { useEffect, useState } from 'react'

interface IndexQuote {
  label: string
  ltp: number | null
  changePct: number | null
  source: 'kite' | 'briefing' | 'unavailable'
}

interface TickerResponse {
  indices?: {
    nifty50: IndexQuote
    sensex: IndexQuote
    vix: IndexQuote
    giftNifty: IndexQuote
  }
  fetchedAt?: string
}

const REFRESH_MS = 30 * 1000

// Thin strip rendered at the top of AppShell on every page. Polls live
// indices every 30 seconds. Silent fallback when Kite isn't connected.
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
  const order: Array<keyof typeof data.indices> = ['nifty50', 'sensex', 'vix', 'giftNifty']
  const visible = order.filter(k => data.indices![k].source !== 'unavailable')
  if (visible.length === 0) return null

  return (
    <div className="w-full overflow-x-auto ticker-strip"
      style={{ background: 'rgba(8,6,4,0.92)', borderBottom: '1px solid rgba(201,168,76,0.12)', backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center gap-6 px-4 py-1.5 min-w-fit" style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 10 }}>
        {visible.map((k, i) => {
          const idx = data.indices![k]
          const chg = idx.changePct
          const color = chg === null ? 'rgba(255,255,255,0.5)' : chg > 0 ? '#52b788' : chg < 0 ? '#e05a5e' : 'rgba(255,255,255,0.55)'
          const arrow = chg === null ? '—' : chg > 0 ? '▲' : chg < 0 ? '▼' : '─'
          const isBriefing = idx.source === 'briefing'
          return (
            <div key={k} className="flex items-center gap-2 whitespace-nowrap"
              style={{ borderLeft: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)', paddingLeft: i === 0 ? 0 : 16 }}>
              <span style={{ color: 'rgba(201,168,76,0.65)', letterSpacing: '0.1em' }}>
                {idx.label}
                {isBriefing && <span className="dt-text-muted" style={{ marginLeft: 4 }}>(pre-mkt)</span>}
              </span>
              {idx.ltp !== null && (
                <span className="dt-text-secondary">
                  {idx.ltp.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              )}
              {chg !== null && (
                <span style={{ color }}>
                  {arrow} {Math.abs(chg).toFixed(2)}%
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
