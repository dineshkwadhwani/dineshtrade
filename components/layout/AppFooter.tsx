'use client'
import { useEffect, useState } from 'react'

export default function AppFooter() {
  const [startedAt, setStartedAt] = useState<string>('')
  const [build, setBuild] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/version')
      .then(r => r.json())
      .then(data => {
        if (data.startedAt) {
          setStartedAt(data.startedAt)
        }
        if (data.build) {
          setBuild(data.build)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const formatTime = (iso: string) => {
    try {
      const date = new Date(iso)
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
    } catch {
      return iso
    }
  }

  return (
    <footer className="dt-footer py-4 px-4 mt-auto text-center text-xs">
      <div className="space-y-1">
        <div>
          Created by <span className="dt-footer-emphasis">Dinesh Wadhwani</span> • 
          <a href="mailto:contact@thecoachdinesh.com" className="dt-footer-link ml-1">
            contact@thecoachdinesh.com
          </a> • 
          <span className="ml-1 dt-footer-emphasis">+91 9767676738</span>
        </div>
        <div>
          Version: {loading ? 'Loading...' : (build || 'v1.0.0')}
          {startedAt ? ` • Started: ${formatTime(startedAt)}` : ''}
        </div>
      </div>
    </footer>
  )
}
