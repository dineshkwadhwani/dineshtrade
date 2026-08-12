'use client'

import { useEffect, useState } from 'react'

type TaglineRotatorProps = {
  lines: string[]
  intervalMs?: number
  className?: string
}

export default function TaglineRotator({
  lines,
  intervalMs = 3200,
  className,
}: TaglineRotatorProps) {
  const safeLines = lines.length ? lines : ['Trade smarter.']
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (safeLines.length <= 1) return
    const timer = setInterval(() => {
      setIndex(prev => (prev + 1) % safeLines.length)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [safeLines.length, intervalMs])

  return (
    <span className={className} aria-live="polite">
      {safeLines[index]}
    </span>
  )
}
