'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import TaglineRotator from '@/components/marketing/TaglineRotator'
import type { Profile, ProfileRole } from '@/lib/dalgoAuth'

interface Props {
  initialProfile: Profile | null
  initialError?: string
}

const DISCLAIMER =
  'DAlgo is a software platform that enables automated trading. We are not a ' +
  'SEBI-registered investment advisor. All trading decisions are yours.'

// Plain font-family stacks — the page loads Sora/Inter via a scoped <link>
// tag (see page.tsx), not next/font, so there's no CSS custom property to
// reference here.
const FONT_SORA = "'Sora', sans-serif"
const FONT_INTER = "'Inter', sans-serif"

const MARKETING_LINES = [
  'Precision automation for all market moods.',
  'Bull, bear, or sideways: your rules stay in control.',
  'Calm execution when markets get chaotic.',
  'Disciplined entries. Smarter exits. Zero panic clicks.',
  'Consistent process, not emotional trading.',
]

// Status-aware redirect — mirrors resolveRedirect() in app/api/dalgo/auth/route.ts.
function resolveClientRedirect(profile: Profile): string {
  if (profile.role === 'customer') {
    if (profile.status === 'identity_verified' || profile.status === 'broker_setup_complete') return '/setup'
    if (profile.status === 'active') return '/dashboard'
    return '/pending'
  }
  if (profile.role === 'superadmin') return '/admin'
  return '/manager'
}

function CardShell({ children }: { children: React.ReactNode }) {
  const [snapshotOpen, setSnapshotOpen] = useState(false)

  const highlights = [
    { metric: '2%+', label: 'Consistent monthly return target bands' },
    { metric: '24x7', label: 'Panic-trade prevention and guardrails' },
    { metric: 'Real-time', label: 'Free-fall filters with circuit protection' },
  ]

  const bullets = [
    'Rules-first execution that helps remove emotional entries and exits.',
    'Crash-mode protocols designed for sudden market drawdowns.',
    'Broker-native flows with full account custody under your control.',
    'Mobile-friendly control surfaces for quick checks and safe actions.',
  ]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#F8FAFF' }}>
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
          padding: '56px 56px 44px',
          background:
            'radial-gradient(520px 240px at 85% 5%, rgba(245,158,11,0.22), transparent 65%), linear-gradient(160deg, #1E3A8A 0%, #1D4ED8 100%)',
          color: '#fff',
        }}
      >
        <div style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 40, letterSpacing: '-0.02em' }}>
          <span style={{ color: '#FFFFFF' }}>D</span>
          <span className="dt-register-amber" style={{ color: '#F59E0B' }}>A</span>
          <span style={{ color: '#FFFFFF' }}>lgo</span>
        </div>
        <p className="dt-register-soft" style={{ marginTop: 28, fontFamily: FONT_INTER, fontSize: 18, color: 'rgba(255,255,255,0.96)', maxWidth: 460, lineHeight: 1.5 }}>
          <TaglineRotator lines={MARKETING_LINES} intervalMs={3600} />
        </p>

        <div
          style={{
            marginTop: 24,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 10,
            maxWidth: 500,
          }}
        >
          {highlights.map(item => (
            <div
              key={item.label}
              style={{
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.1)',
                padding: '10px 10px 9px',
              }}
            >
              <div className="dt-register-gold" style={{ fontFamily: FONT_SORA, fontWeight: 700, color: '#FCD34D', fontSize: 17 }}>{item.metric}</div>
              <div className="dt-register-soft" style={{ marginTop: 4, fontFamily: FONT_INTER, fontSize: 12, color: 'rgba(255,255,255,0.95)', lineHeight: 1.35 }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 18,
            border: '1px solid rgba(255,255,255,0.24)',
            borderRadius: 14,
            background: 'rgba(15, 23, 42, 0.2)',
            padding: '14px 14px 10px',
            maxWidth: 520,
          }}
        >
          {bullets.map(text => (
            <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 10 }}>
              <span
                aria-hidden="true"
                style={{
                  marginTop: 6,
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: '#F59E0B',
                  boxShadow: '0 0 0 3px rgba(245,158,11,0.24)',
                  flex: '0 0 auto',
                }}
              />
              <span className="dt-register-soft" style={{ fontFamily: FONT_INTER, fontSize: 14, color: 'rgba(255,255,255,0.96)', lineHeight: 1.45 }}>{text}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 18,
            border: '1px solid rgba(255,255,255,0.2)',
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
              border: '1px solid rgba(255,255,255,0.18)',
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
          <div className="dt-register-soft" style={{ marginTop: 8, fontFamily: FONT_INTER, fontSize: 12, lineHeight: 1.4 }}>
            Positive trend visualization used as an illustrative sample, not a guaranteed outcome.
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

      <div
        className="flex-1 flex flex-col items-center justify-center"
        style={{ padding: '32px', fontFamily: FONT_INTER }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 400,
            background: '#FFFFFF',
            border: '1px solid #BFDBFE',
            borderRadius: 16,
            padding: 40,
            boxShadow: '0 4px 24px rgba(30,58,138,0.06)',
          }}
        >
          <div
            className="md:hidden"
            style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 26, marginBottom: 24, textAlign: 'center' }}
          >
            <span style={{ color: '#1E3A8A' }}>D</span>
            <span style={{ color: '#F59E0B' }}>A</span>
            <span style={{ color: '#1E3A8A' }}>lgo</span>
          </div>
          {children}
          <p style={{ fontFamily: FONT_INTER, fontSize: 11, color: '#94A3B8', marginTop: 24, marginBottom: 0, lineHeight: 1.6 }}>
            {DISCLAIMER}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginClient({ initialProfile, initialError }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [loading, setLoading] = useState(false)

  // Already logged in when the page loaded (page.tsx's server-side
  // getSession()/getProfile() found a valid session) — redirect immediately
  // instead of showing the form. No dedicated "signed in" card anymore per
  // your note; worst case is a brief flash of the form before navigation.
  useEffect(() => {
    if (initialProfile) {
      window.location.href = resolveClientRedirect(initialProfile)
    }
  }, [initialProfile])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/dalgo/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error === 'ACCOUNT_PENDING'
          ? 'Your account is under review. You will be notified once it is approved.'
          : (data.error || 'Login failed. Please try again.')
        setError(msg)
        setLoading(false)
        return
      }
      window.location.href = data.redirectTo
    } catch {
      setError('Connection error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <CardShell>
      <h1 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 22, color: '#1E3A8A', margin: 0 }}>
        Welcome back
      </h1>
      <p style={{ fontFamily: FONT_INTER, fontSize: 14, color: '#475569', marginTop: 6, marginBottom: 24 }}>
        Log in to your DAlgo account.
      </p>

      <form onSubmit={handleSubmit}>
        <label
          htmlFor="dalgo-login-email"
          style={{ display: 'block', fontFamily: FONT_INTER, fontSize: 13, fontWeight: 500, color: '#1E3A8A', marginBottom: 6 }}
        >
          Email
        </label>
        <input
          id="dalgo-login-email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={e => { setEmail(e.target.value); setError('') }}
          style={{
            width: '100%',
            padding: '10px 14px',
            marginBottom: 16,
            border: '1px solid #BFDBFE',
            borderRadius: 8,
            fontFamily: FONT_INTER,
            fontSize: 14,
            color: '#0F172A',
            outline: 'none',
          }}
        />

        <label
          htmlFor="dalgo-login-password"
          style={{ display: 'block', fontFamily: FONT_INTER, fontSize: 13, fontWeight: 500, color: '#1E3A8A', marginBottom: 6 }}
        >
          Password
        </label>
        <input
          id="dalgo-login-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError('') }}
          style={{
            width: '100%',
            padding: '10px 14px',
            border: error ? '1px solid #EF4444' : '1px solid #BFDBFE',
            borderRadius: 8,
            fontFamily: FONT_INTER,
            fontSize: 14,
            color: '#0F172A',
            outline: 'none',
          }}
        />

        {error && (
          <p style={{ fontFamily: FONT_INTER, color: '#EF4444', fontSize: 13, marginTop: 10, marginBottom: 0 }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '12px 0',
            background: '#3B82F6',
            color: '#FFFFFF',
            fontFamily: FONT_INTER,
            fontWeight: 600,
            fontSize: 14,
            border: 'none',
            borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Logging in…' : 'Log In'}
        </button>
      </form>
      <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#475569', textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
        Don't have an account?{' '}
        <a href="/register" style={{ color: '#3B82F6' }}>Register</a>
      </p>
    </CardShell>
  )
}
