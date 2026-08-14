'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

const INTERVAL_MS = 3 * 60 * 1000 // 3 minutes

export default function RefreshBar() {
  const router = useRouter()
  const [spinning, setSpinning] = useState(false)
  const [countdown, setCountdown] = useState(INTERVAL_MS / 1000)
  const nextRefreshAt = useRef(Date.now() + INTERVAL_MS)

  function doRefresh() {
    setSpinning(true)
    router.refresh()
    nextRefreshAt.current = Date.now() + INTERVAL_MS
    setCountdown(INTERVAL_MS / 1000)
    setTimeout(() => setSpinning(false), 800)
  }

  useEffect(() => {
    const tick = setInterval(() => {
      const remaining = Math.ceil((nextRefreshAt.current - Date.now()) / 1000)
      setCountdown(Math.max(0, remaining))
      if (remaining <= 0) doRefresh()
    }, 1000)
    return () => clearInterval(tick)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mm = String(Math.floor(countdown / 60)).padStart(2, '0')
  const ss = String(countdown % 60).padStart(2, '0')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
      <button
        onClick={doRefresh}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', borderRadius: 8,
          background: '#EFF6FF', border: '1px solid #BFDBFE',
          color: '#1E3A8A', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <span style={{
          display: 'inline-block',
          animation: spinning ? 'spin 0.6s linear' : 'none',
        }}>↻</span>
        Refresh
      </button>
      <span style={{ fontSize: 12, color: '#94A3B8' }}>
        Auto-refreshes in {mm}:{ss}
      </span>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
