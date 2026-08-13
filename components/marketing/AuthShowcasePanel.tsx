'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import TaglineRotator from '@/components/marketing/TaglineRotator'

const FONT_SORA = "'Sora', sans-serif"
const FONT_INTER = "'Inter', sans-serif"

const MARKETING_LINES = [
  'West-coast polish. Indian market precision.',
  'Bull, bear, sideways. Rules stay in control.',
  'Calm execution when markets turn chaotic.',
  'Disciplined entries. Smarter exits. No panic.',
  'Consistent process. No emotional trading.',
]

const HERO_PILLS = [
  {
    pill: 'Panic Trade Prevention',
    detail: 'Rules-first execution helps remove emotional entries and exits during volatile sessions.',
    x: 44,
    y: 138,
  },
  {
    pill: 'Free-Fall Protection',
    detail: 'Circuit-aware risk checks pause reckless actions when the market is in fast drawdown mode.',
    x: 182,
    y: 116,
  },
  {
    pill: 'Broker-Native Control',
    detail: 'Your brokerage account stays in your custody while DAlgo executes only within your guardrails.',
    x: 324,
    y: 90,
  },
  {
    pill: 'Mobile-First Workflow',
    detail: 'Fast, thumb-friendly control surfaces let you monitor and intervene from anywhere in seconds.',
    x: 500,
    y: 58,
  },
]

export default function AuthShowcasePanel() {
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [activePill, setActivePill] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setActivePill(prev => (prev + 1) % HERO_PILLS.length)
    }, 2800)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      <div
        className="hidden md:flex dt-register-marketing"
        style={{
          flex: 1,
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignSelf: 'flex-start',
          position: 'sticky',
          top: 0,
          minHeight: '100vh',
          padding: '50px 52px 40px',
          background:
            'radial-gradient(560px 260px at 8% 0%, rgba(56, 189, 248, 0.2), transparent 65%), radial-gradient(420px 240px at 90% 10%, rgba(245,158,11,0.2), transparent 60%), linear-gradient(156deg, #1E3A8A 0%, #1D4ED8 58%, #1E40AF 100%)',
          color: '#fff',
        }}
      >
        <a
          href="/"
          aria-label="Go to DAlgo landing page"
          style={{
            fontFamily: FONT_SORA,
            fontWeight: 700,
            fontSize: 46,
            letterSpacing: '-0.03em',
            textDecoration: 'none',
            display: 'inline-block',
            lineHeight: 1,
          }}
        >
          <span style={{ color: '#FFFFFF' }}>D</span>
          <span className="dt-register-amber" style={{ color: '#F59E0B' }}>A</span>
          <span style={{ color: '#FFFFFF' }}>lgo</span>
        </a>

        <div
          style={{
            marginTop: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(255,255,255,0.12)',
            padding: '7px 12px',
            fontFamily: FONT_INTER,
            fontSize: 12,
            letterSpacing: '0.02em',
            maxWidth: 'fit-content',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, background: '#22C55E' }} />
          Live FinTech automation stack
        </div>

        <p
          className="dt-register-soft"
          style={{
            marginTop: 20,
            fontFamily: FONT_INTER,
            fontSize: 23,
            lineHeight: 1.34,
            color: 'rgba(255,255,255,0.96)',
            maxWidth: 620,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <TaglineRotator lines={MARKETING_LINES} intervalMs={3400} />
        </p>

        <div
          style={{
            marginTop: 10,
            border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: 14,
            background: 'rgba(15, 23, 42, 0.22)',
            padding: 12,
            maxWidth: 560,
          }}
        >
          <div className="dt-register-soft" style={{ fontFamily: FONT_SORA, fontWeight: 600, fontSize: 13, marginBottom: 8, letterSpacing: '0.01em' }}>
            Live strategy curve snapshot
          </div>
          <button
            type="button"
            onClick={() => setSnapshotOpen(true)}
            aria-label="Open live strategy snapshot"
            style={{
              width: '100%',
              borderRadius: 10,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent',
              padding: 0,
              cursor: 'zoom-in',
            }}
          >
            <Image
              src="/zerodha.png"
              alt="Zerodha live performance chart"
              width={960}
              height={540}
              style={{ width: '100%', height: 'auto', display: 'block' }}
              priority
            />
          </button>
        </div>

        <div
          style={{
            marginTop: 14,
            border: '1px solid rgba(255,255,255,0.24)',
            borderRadius: 14,
            background: 'rgba(15, 23, 42, 0.2)',
            padding: '14px 14px 12px',
            maxWidth: 560,
          }}
        >
          <div className="dt-register-soft" style={{ fontFamily: FONT_SORA, fontWeight: 600, fontSize: 13, letterSpacing: '0.01em' }}>
            Strategy signal map
          </div>

          <div style={{ marginTop: 8, borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(30, 64, 175, 0.2)', padding: 8 }}>
            <svg viewBox="0 0 560 220" width="100%" height="220" aria-label="Growing line and candle chart preview">
              {[46, 82, 118, 154].map(y => (
                <line key={y} x1="12" y1={y} x2="548" y2={y} stroke="rgba(191, 219, 254, 0.22)" strokeWidth="1" />
              ))}

              {HERO_PILLS.map((item, idx) => (
                <rect
                  key={`bar-${item.pill}`}
                  x={item.x - 14}
                  y={item.y}
                  width="10"
                  height={170 - item.y}
                  rx="4"
                  fill={idx <= activePill ? 'rgba(56, 189, 248, 0.8)' : 'rgba(148, 163, 184, 0.35)'}
                />
              ))}

              <polyline
                points={HERO_PILLS.slice(0, activePill + 1).map(item => `${item.x},${item.y}`).join(' ')}
                fill="none"
                stroke="#FCD34D"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {HERO_PILLS.map((item, idx) => (
                <circle
                  key={`dot-${item.pill}`}
                  cx={item.x}
                  cy={item.y}
                  r={idx === activePill ? 6 : 4}
                  fill={idx === activePill ? '#FFFFFF' : '#93C5FD'}
                  stroke={idx === activePill ? '#F59E0B' : 'rgba(30, 64, 175, 0.8)'}
                  strokeWidth={idx === activePill ? 3 : 1.5}
                />
              ))}

              {Array.from({ length: 12 }).map((_, idx) => {
                const x = 26 + idx * 44
                const wickTop = idx % 3 === 0 ? 176 : idx % 3 === 1 ? 182 : 170
                const wickBottom = idx % 2 === 0 ? 208 : 202
                const open = idx % 2 === 0 ? 198 : 187
                const close = idx % 2 === 0 ? 183 : 200
                const candleY = Math.min(open, close)
                const candleH = Math.max(6, Math.abs(open - close))
                const up = close < open
                return (
                  <g key={`candle-${x}`}>
                    <line x1={x} y1={wickTop} x2={x} y2={wickBottom} stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
                    <rect
                      x={x - 5}
                      y={candleY}
                      width="10"
                      height={candleH}
                      rx="2"
                      fill={up ? '#22C55E' : '#EF4444'}
                    />
                  </g>
                )
              })}
            </svg>
          </div>

          <div
            className="dt-register-soft"
            style={{
              marginTop: 8,
              minHeight: 44,
              fontFamily: FONT_INTER,
              fontSize: 14,
              color: 'rgba(255,255,255,0.96)',
              lineHeight: 1.45,
            }}
          >
            {HERO_PILLS[activePill].detail}
          </div>

          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {HERO_PILLS.map((item, idx) => {
              const active = idx === activePill
              return (
                <button
                  key={item.pill}
                  type="button"
                  onClick={() => setActivePill(idx)}
                  style={{
                    borderRadius: 999,
                    border: active ? '1px solid rgba(252, 211, 77, 0.9)' : '1px solid rgba(255,255,255,0.3)',
                    background: active ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.08)',
                    color: active ? '#FCD34D' : 'rgba(255,255,255,0.95)',
                    fontFamily: FONT_INTER,
                    fontWeight: active ? 600 : 500,
                    fontSize: 12,
                    lineHeight: 1,
                    padding: '9px 12px',
                    cursor: 'pointer',
                  }}
                >
                  {item.pill}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {snapshotOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Live strategy curve snapshot"
          onClick={() => setSnapshotOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 90,
            background: 'rgba(2, 6, 23, 0.84)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative',
              width: 'min(1120px, 80vw)',
              maxHeight: '88vh',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.24)',
              background: '#0b1224',
              overflow: 'hidden',
              boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
            }}
          >
            <button
              type="button"
              onClick={() => setSnapshotOpen(false)}
              aria-label="Close preview"
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                width: 34,
                height: 34,
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.3)',
                background: 'rgba(15, 23, 42, 0.85)',
                color: '#FFFFFF',
                fontSize: 20,
                lineHeight: 1,
                cursor: 'pointer',
                zIndex: 2,
              }}
            >
              ×
            </button>
            <Image
              src="/zerodha.png"
              alt="Zerodha live performance chart enlarged"
              width={1280}
              height={720}
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </div>
        </div>
      )}
    </>
  )
}
