'use client'

import { useState, useEffect } from 'react'

const FONT_SORA = "'Sora', sans-serif"
const FONT_INTER = "'Inter', sans-serif"

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  fontFamily: FONT_INTER,
  fontSize: 14,
  border: '1px solid #BFDBFE',
  borderRadius: 8,
  outline: 'none',
  boxSizing: 'border-box',
  background: '#F8FAFF',
  color: '#1E293B',
}

const BROKERS = [
  { value: 'zerodha', label: 'Zerodha', available: true },
  { value: 'upstox', label: 'Upstox', available: false },
  { value: 'angelone', label: 'Angel One', available: false },
  { value: 'dhan', label: 'Dhan', available: false },
]

interface Props {
  profile: { id: string; full_name: string; email: string }
  initialHasCreds: boolean
  initialIsConnected: boolean
  initialError: string | null
  isActive?: boolean
}

type Stage = 'credentials' | 'connect' | 'done'

function StepBar({ stage }: { stage: Stage }) {
  const steps = [
    { key: 'identity', label: 'Identity verified', done: true },
    { key: 'credentials', label: 'Broker credentials', done: stage === 'connect' || stage === 'done' },
    { key: 'connect', label: 'Kite connected', done: stage === 'done' },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
      {steps.map((s, i) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 'auto' : undefined }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: '50%',
              background: s.done ? '#D1FAE5' : '#1E3A8A',
              color: s.done ? '#065F46' : '#fff',
              fontFamily: FONT_INTER, fontWeight: 700, fontSize: 12,
            }}>
              {s.done ? '✓' : i + 1}
            </div>
            <span style={{ fontFamily: FONT_INTER, fontSize: 11, color: s.done ? '#065F46' : '#1E3A8A', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 1, background: '#E2E8F0', margin: '0 8px', marginBottom: 18 }} />
          )}
        </div>
      ))}
    </div>
  )
}

export default function SetupClient({ profile, initialHasCreds, initialIsConnected, initialError, isActive }: Props) {
  const [stage, setStage] = useState<Stage>(
    initialIsConnected ? 'done' : initialHasCreds ? 'connect' : 'credentials'
  )
  const [reconnecting, setReconnecting] = useState(false)
  const [broker, setBroker] = useState('zerodha')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError ?? '')

  async function handleSaveCreds(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim() || !apiSecret.trim()) {
      setError('Both API Key and API Secret are required.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/dalgo/setup/broker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker, apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to save credentials.')
      } else {
        setStage('connect')
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFF', padding: '32px 16px' }}>
        <div style={{ width: '100%', maxWidth: 480, background: '#FFFFFF', border: '1px solid #BFDBFE', borderRadius: 16, padding: 40, boxShadow: '0 4px 24px rgba(30,58,138,0.06)' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 24 }}>
            <span style={{ fontFamily: FONT_SORA, fontWeight: 800, fontSize: 22, color: '#1E3A8A' }}>D</span>
            <span style={{ fontFamily: FONT_SORA, fontWeight: 800, fontSize: 22, color: '#F59E0B' }}>A</span>
            <span style={{ fontFamily: FONT_SORA, fontWeight: 800, fontSize: 22, color: '#1E3A8A' }}>lgo</span>
          </div>

          {isActive && !reconnecting ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>🚀</div>
              <h1 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 22, color: '#1E3A8A', margin: '0 0 12px' }}>
                Welcome, {profile.full_name}!
              </h1>
              <p style={{ fontFamily: FONT_INTER, fontSize: 14, color: '#475569', margin: '0 0 24px', lineHeight: 1.6 }}>
                Your account is active and trading is enabled.
                Connect to your trading dashboard to start.
              </p>
              {error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 16, textAlign: 'left' }}>
                  <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#DC2626', margin: 0 }}>⚠ {error}</p>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {initialHasCreds && (
                  <a href="/api/dalgo/setup/kite-login" style={{
                    display: 'block', padding: '13px 0', background: '#387ED1', color: '#fff',
                    fontFamily: FONT_INTER, fontWeight: 600, fontSize: 15, textAlign: 'center',
                    borderRadius: 8, textDecoration: 'none',
                  }}>
                    Connect to Kite →
                  </a>
                )}
                <button onClick={() => { setError(''); setStage('credentials'); setReconnecting(true) }} style={{
                  display: 'block', width: '100%', padding: '12px 0',
                  background: initialHasCreds ? 'none' : '#1E3A8A',
                  color: initialHasCreds ? '#475569' : '#fff',
                  fontFamily: FONT_INTER, fontWeight: 600, fontSize: 14,
                  border: initialHasCreds ? '1px solid #CBD5E1' : 'none',
                  borderRadius: 8, cursor: 'pointer',
                }}>
                  🔄 {initialHasCreds ? 'Update Credentials & Reconnect' : 'Set Up Broker Credentials'}
                </button>
                <a href="/api/dalgo/auth/logout" style={{
                  display: 'block', padding: '12px 0', background: 'none',
                  border: '1px solid #CBD5E1', borderRadius: 8,
                  fontFamily: FONT_INTER, fontSize: 13, color: '#475569',
                  textDecoration: 'none', textAlign: 'center',
                }}>
                  ⏻ Log out
                </a>
              </div>
            </div>
          ) : (
            <>
          <h1 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 22, color: '#1E3A8A', margin: '0 0 6px' }}>
            Complete your setup
          </h1>
          <p style={{ fontFamily: FONT_INTER, fontSize: 14, color: '#475569', margin: '0 0 28px' }}>
            Hi {profile.full_name} — connect your broker to start trading.
          </p>

          <StepBar stage={stage} />

          {stage === 'credentials' && (
            <form onSubmit={handleSaveCreds} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontFamily: FONT_INTER, fontSize: 13, fontWeight: 600, color: '#1E3A8A', display: 'block', marginBottom: 6 }}>Broker</label>
                <select value={broker} onChange={e => setBroker(e.target.value)} style={inputStyle}>
                  {BROKERS.map(b => (
                    <option key={b.value} value={b.value} disabled={!b.available}>
                      {b.label}{!b.available ? ' (Coming Soon)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontFamily: FONT_INTER, fontSize: 13, fontWeight: 600, color: '#1E3A8A', display: 'block', marginBottom: 6 }}>API Key</label>
                <input type="text" value={apiKey} autoComplete="off"
                  onChange={e => { setApiKey(e.target.value); setError('') }}
                  placeholder="Paste your Kite Connect API key" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontFamily: FONT_INTER, fontSize: 13, fontWeight: 600, color: '#1E3A8A', display: 'block', marginBottom: 6 }}>API Secret</label>
                <input type="password" value={apiSecret} autoComplete="off"
                  onChange={e => { setApiSecret(e.target.value); setError('') }}
                  placeholder="Paste your Kite Connect API secret" style={inputStyle} />
              </div>
              <p style={{ fontFamily: FONT_INTER, fontSize: 12, color: '#64748B', background: '#F1F5F9', borderRadius: 8, padding: '10px 14px', margin: 0, lineHeight: 1.6 }}>
                <strong>How to find your credentials:</strong><br />
                Log into Zerodha → Kite Connect → Create App → Copy API Key and Secret
              </p>
              {error && <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#EF4444', margin: 0 }}>{error}</p>}
              <button type="submit" disabled={loading} style={{
                width: '100%', padding: '12px 0', background: loading ? '#93C5FD' : '#1E3A8A', color: '#fff',
                fontFamily: FONT_INTER, fontWeight: 600, fontSize: 15,
                border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 4,
              }}>
                {loading ? 'Saving…' : 'Save & Continue'}
              </button>
            </form>
          )}

          {stage === 'connect' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '14px 18px' }}>
                <p style={{ fontFamily: FONT_INTER, fontSize: 14, color: '#065F46', fontWeight: 600, margin: '0 0 4px' }}>✓ Credentials saved</p>
                <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#475569', margin: 0 }}>
                  Now connect to Kite to verify your credentials and allow DAlgo to place trades on your behalf.
                </p>
              </div>
              <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '14px 18px' }}>
                <p style={{ fontFamily: FONT_INTER, fontSize: 12, color: '#1E3A8A', fontWeight: 600, margin: '0 0 6px' }}>
                  Set this Redirect URL in your Zerodha Developer Console:
                </p>
                <code style={{ fontFamily: 'monospace', fontSize: 12, color: '#1E3A8A', background: '#DBEAFE', padding: '4px 8px', borderRadius: 4, wordBreak: 'break-all' }}>
                  https://www.dalgo.online/api/zerodha/callback
                </code>
                <p style={{ fontFamily: FONT_INTER, fontSize: 11, color: '#64748B', margin: '6px 0 0' }}>
                  For local dev testing: http://localhost:3000/api/zerodha/callback
                </p>
              </div>

              <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, padding: '14px 18px' }}>
                <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#92400E', margin: '0 0 6px', fontWeight: 600 }}>What happens next:</p>
                <ol style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#78350F', margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                  <li>You will be redirected to Zerodha&apos;s Kite login page</li>
                  <li>Log in with your Zerodha credentials</li>
                  <li>You will be redirected back here — connection verified</li>
                </ol>
              </div>
              {error && <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#EF4444', margin: 0 }}>{error}</p>}
              <a href="/api/dalgo/setup/kite-login" style={{
                display: 'block', width: '100%', padding: '13px 0', background: '#387ED1', color: '#fff',
                fontFamily: FONT_INTER, fontWeight: 600, fontSize: 15, textAlign: 'center',
                borderRadius: 8, textDecoration: 'none', boxSizing: 'border-box',
              }}>
                Connect to Kite →
              </a>
              <button onClick={() => setStage('credentials')} style={{
                background: 'none', border: 'none', fontFamily: FONT_INTER, fontSize: 13, color: '#64748B', cursor: 'pointer', padding: 0,
              }}>
                ← Change API credentials
              </button>
            </div>
          )}

          {stage === 'done' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <h2 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 20, color: '#1E3A8A', margin: '0 0 12px' }}>
                Kite connected!
              </h2>
              <p style={{ fontFamily: FONT_INTER, fontSize: 14, color: '#475569', margin: '0 0 24px', lineHeight: 1.6 }}>
                Your broker credentials have been verified and your access token is saved.
                Your account will be activated by your account manager shortly.
              </p>
              <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '14px 18px', textAlign: 'left', marginBottom: 20 }}>
                <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#065F46', margin: 0, lineHeight: 1.6 }}>
                  <strong>What&apos;s next:</strong><br />
                  Your account manager will review your setup and activate your account.
                  You will receive an email once trading is enabled.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setApiKey(''); setApiSecret(''); setError(''); setStage('credentials') }}
                  style={{
                    background: 'none', border: '1px solid #CBD5E1', borderRadius: 8,
                    fontFamily: FONT_INTER, fontSize: 13, color: '#475569', cursor: 'pointer',
                    padding: '9px 18px',
                  }}
                >
                  ✎ Edit API credentials
                </button>
                <a
                  href="/api/dalgo/auth/logout"
                  style={{
                    background: 'none', border: '1px solid #FECACA', borderRadius: 8,
                    fontFamily: FONT_INTER, fontSize: 13, color: '#EF4444', cursor: 'pointer',
                    padding: '9px 18px', textDecoration: 'none', display: 'inline-block',
                  }}
                >
                  ⏻ Log out
                </a>
              </div>
            </div>
          )}
            </>
          )}

        </div>
      </div>
    </>
  )
}
