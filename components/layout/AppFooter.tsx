'use client'
import { useEffect, useState } from 'react'

export default function AppFooter() {
  const [startedAt, setStartedAt] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/version')
      .then(r => r.json())
      .then(data => {
        if (data.startedAt) {
          setStartedAt(data.startedAt)
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
    <footer className="border-t border-white/10 bg-[#0a0905] py-4 px-4 mt-auto text-center text-xs text-white/60">
      <div className="space-y-1">
        <div>
          Created by <span className="text-white/80">Dinesh Wadhwani</span> • 
          <a href="mailto:dinesh.k.wadhwani@gmail.com" className="ml-1 text-blue-400/80 hover:text-blue-400 transition-colors">
            dinesh.k.wadhwani@gmail.com
          </a> • 
          <span className="ml-1 text-white/80">+91 9767676738</span>
        </div>
        <div>
          Version: {loading ? 'Loading...' : startedAt ? formatTime(startedAt) : 'Unknown'}
        </div>
      </div>
    </footer>
  )
}
