'use client'

import { useState } from 'react'
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
  'Panic trade prevention — rules-first execution, no emotional entries.',
  'Free-fall protection — circuit checks pause trading in fast drawdowns.',
  'Broker-native control — your account stays in custody, DAlgo only executes.',
  'Mobile-first — monitor and intervene from anywhere in seconds.',
]

export default function AuthShowcasePanel() {
  const [snapshotOpen, setSnapshotOpen] = useState(false)

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
            maxWidth: 560,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {HERO_PILLS.map(line => {
            const [title, description] = line.split(' — ')
            return (
              <div key={line} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: 99, background: '#F59E0B' }} />
                <div className="dt-register-soft" style={{ fontFamily: FONT_INTER, fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.45 }}>
                  <span style={{ color: '#FCD34D', fontWeight: 600 }}>{title}</span>
                  <span> — {description}</span>
                </div>
              </div>
            )
          })}
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
