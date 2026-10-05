'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import AuthShowcasePanel from '@/components/marketing/AuthShowcasePanel'

// Minimal anon client — cannot import lib/supabase.ts here (server-only module)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { detectSessionInUrl: false } }
)

const FONT_SORA = "'Sora', sans-serif"
const FONT_INTER = "'Inter', sans-serif"

type Stage = 'loading' | 'form' | 'success' | 'error'

export default function ResetPasswordPage() {
  const [stage, setStage] = useState<Stage>('loading')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Supabase puts the recovery token in the URL hash on redirect.
  // Parse it, set the session, then show the form.
  useEffect(() => {
    async function establishRecoverySession() {
      try {
        const searchParams = new URLSearchParams(window.location.search)
        const code = searchParams.get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) { setStage('error'); return }
          window.history.replaceState(null, '', window.location.pathname)
          setStage('form')
          return
        }

        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')
        if (hashParams.get('type') !== 'recovery' || !accessToken || !refreshToken) {
          setStage('error')
          return
        }

        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        if (error) { setStage('error'); return }
        window.history.replaceState(null, '', window.location.pathname)
        setStage('form')
      } catch {
        setStage('error')
      }
    }

    void establishRecoverySession()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setSubmitting(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) { setError(error.message); return }
      setStage('success')
    } catch {
      setError('Unable to update your password. Please request a new reset link.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Inter:wght@400;500&display=swap"
      />
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
              style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 26, marginBottom: 24, textAlign: 'center', textDecoration: 'none', display: 'block' }}
            >
              <span style={{ color: '#1E3A8A' }}>D</span>
              <span style={{ color: '#F59E0B' }}>A</span>
              <span style={{ color: '#1E3A8A' }}>lgo</span>
            </a>

            {stage === 'loading' && (
              <p style={{ color: '#475569', fontSize: 14, textAlign: 'center' }}>Verifying reset link…</p>
            )}

            {stage === 'error' && (
              <>
                <h1 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 20, color: '#1E3A8A', margin: '0 0 12px' }}>
                  Link expired or invalid
                </h1>
                <p style={{ fontSize: 14, color: '#475569', marginBottom: 24 }}>
                  This password reset link has expired or already been used. Please request a new one.
                </p>
                <a
                  href="/login"
                  style={{
                    display: 'block', textAlign: 'center', padding: '11px 0',
                    background: '#1E3A8A', color: '#fff', borderRadius: 8,
                    fontFamily: FONT_INTER, fontWeight: 500, fontSize: 15, textDecoration: 'none',
                  }}
                >
                  Back to login
                </a>
              </>
            )}

            {stage === 'form' && (
              <>
                <h1 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 22, color: '#1E3A8A', margin: '0 0 6px' }}>
                  Set new password
                </h1>
                <p style={{ fontSize: 14, color: '#475569', marginBottom: 24 }}>
                  Choose a strong password for your DAlgo account.
                </p>

                <form onSubmit={handleSubmit}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1E3A8A', marginBottom: 6 }}>
                    New password
                  </label>
                  <input
                    type="password"
                    required
                    autoFocus
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError('') }}
                    style={{
                      width: '100%', padding: '10px 14px', marginBottom: 16,
                      border: '1px solid #BFDBFE', borderRadius: 8,
                      fontFamily: FONT_INTER, fontSize: 14, color: '#0F172A', outline: 'none',
                    }}
                  />

                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1E3A8A', marginBottom: 6 }}>
                    Confirm password
                  </label>
                  <input
                    type="password"
                    required
                    value={confirm}
                    onChange={e => { setConfirm(e.target.value); setError('') }}
                    style={{
                      width: '100%', padding: '10px 14px', marginBottom: 24,
                      border: '1px solid #BFDBFE', borderRadius: 8,
                      fontFamily: FONT_INTER, fontSize: 14, color: '#0F172A', outline: 'none',
                    }}
                  />

                  {error && (
                    <p style={{ fontSize: 13, color: '#e05a5e', marginBottom: 16, marginTop: -8 }}>{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    style={{
                      width: '100%', padding: '11px 0',
                      background: submitting ? '#93C5FD' : '#1E3A8A',
                      color: '#fff', border: 'none', borderRadius: 8, cursor: submitting ? 'not-allowed' : 'pointer',
                      fontFamily: FONT_INTER, fontWeight: 500, fontSize: 15,
                    }}
                  >
                    {submitting ? 'Saving…' : 'Set password'}
                  </button>
                </form>
              </>
            )}

            {stage === 'success' && (
              <>
                <h1 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 22, color: '#1E3A8A', margin: '0 0 12px' }}>
                  Password updated
                </h1>
                <p style={{ fontSize: 14, color: '#475569', marginBottom: 24 }}>
                  Your password has been changed. You can now log in with your new password.
                </p>
                <a
                  href="/login"
                  style={{
                    display: 'block', textAlign: 'center', padding: '11px 0',
                    background: '#1E3A8A', color: '#fff', borderRadius: 8,
                    fontFamily: FONT_INTER, fontWeight: 500, fontSize: 15, textDecoration: 'none',
                  }}
                >
                  Go to login
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
