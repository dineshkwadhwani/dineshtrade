'use client'
import { useEffect, useState } from 'react'
import AuthShowcasePanel from '@/components/marketing/AuthShowcasePanel'
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

// Status-aware redirect — active customers go through /api/dalgo/auth/sso-redirect
// so the server can generate a fresh SSO token and forward to their subdomain.
function resolveClientRedirect(profile: Profile): string {
  if (profile.role === 'customer') {
    if (profile.status === 'identity_verified' || profile.status === 'broker_setup_complete') return '/setup'
    if (profile.status === 'active') return '/api/dalgo/auth/sso-redirect'
    return '/pending'
  }
  if (profile.role === 'superadmin') return '/admin'
  return '/manager'
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#F8FAFF' }}>
      <AuthShowcasePanel />

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
          <a
            href="/"
            aria-label="Go to DAlgo landing page"
            className="md:hidden"
            style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 26, marginBottom: 24, textAlign: 'center', textDecoration: 'none', display: 'block' }}
          >
            <span style={{ color: '#1E3A8A' }}>D</span>
            <span style={{ color: '#F59E0B' }}>A</span>
            <span style={{ color: '#1E3A8A' }}>lgo</span>
          </a>
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
