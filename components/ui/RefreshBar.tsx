'use client'
import { useEffect, useRef, useState } from 'react'

const INTERVAL_MS = 3 * 60 * 1000 // 3 minutes

export default function RefreshBar() {
  const [spinning, setSpinning] = useState(false)
  const [countdown, setCountdown] = useState(INTERVAL_MS / 1000)
  const nextRefreshAt = useRef(Date.now() + INTERVAL_MS)

  function doRefresh() {
    setSpinning(true)
    // Cache-bust via query param — window.location.reload() can hit browser cache
    const url = new URL(window.location.href)
    url.searchParams.set('_t', String(Date.now()))
    window.location.replace(url.toString())
  }

  function resetTimer() {
    nextRefreshAt.current = Date.now() + INTERVAL_MS
    setCountdown(INTERVAL_MS / 1000)
  }

  useEffect(() => {
    // Pause countdown while page is hidden; refresh + reset when it becomes visible again
    function onVisibilityChange() {
      if (document.hidden) return
      // Page just became visible — do one refresh and restart the timer
      doRefresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const tick = setInterval(() => {
      if (document.hidden) {
        // Keep timer frozen while hidden so no burst fires on return
        nextRefreshAt.current = Date.now() + INTERVAL_MS
        return
      }
      const remaining = Math.ceil((nextRefreshAt.current - Date.now()) / 1000)
      setCountdown(Math.max(0, remaining))
      if (remaining <= 0) doRefresh()
    }, 1000)

    return () => {
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
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
