'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { completeSso } from './actions'

const FONT_SORA = "'Sora', sans-serif"
const FONT_INTER = "'Inter', sans-serif"

// Fires the (one-time-use) SSO token at the server exactly once on mount —
// the ref guard is needed because React 18 Strict Mode double-invokes effects
// in development, which would otherwise burn the token on its first,
// discarded call and always fail on the second. Only ever shows the loading
// message — on failure it navigates straight to /login?error=invalid_sso,
// which renders its own explanation, rather than flashing an error here too.
export default function SsoClient({ token }: { token: string }) {
  const router = useRouter()
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true

    completeSso(token).then(result => {
      if (result.ok) {
        router.replace('/dashboard')
      } else {
        router.replace('/login?error=invalid_sso')
      }
    })
  }, [token, router])

  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#F8FAFF', padding: '32px 16px',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 440, background: '#FFFFFF', border: '1px solid #BFDBFE',
          borderRadius: 16, padding: 40, boxShadow: '0 4px 24px rgba(30,58,138,0.06)', textAlign: 'center',
        }}
      >
        <div style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 26, marginBottom: 24 }}>
          <span style={{ color: '#1E3A8A' }}>D</span>
          <span style={{ color: '#F59E0B' }}>A</span>
          <span style={{ color: '#1E3A8A' }}>lgo</span>
        </div>

        <div
          aria-hidden="true"
          style={{
            width: 32, height: 32, margin: '0 auto 20px', borderRadius: '50%',
            border: '3px solid #DBEAFE', borderTopColor: '#1E3A8A',
            animation: 'dalgo-sso-spin 0.8s linear infinite',
          }}
        />
        <style>{'@keyframes dalgo-sso-spin { to { transform: rotate(360deg) } }'}</style>

        <p style={{ fontFamily: FONT_INTER, fontSize: 15, color: '#1E3A8A', fontWeight: 500, margin: 0 }}>
          Redirecting to your dashboard...
        </p>
      </div>
    </div>
  )
}
