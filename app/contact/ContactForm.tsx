// app/contact/ContactForm.tsx — Phase 7, Task 7.10.
//
// Client component: the only interactive piece of the /contact page.
// POSTs to /api/dalgo/contact (added to middleware.ts PUBLIC_EXACT).

'use client'

import { useState } from 'react'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: FONT_INTER,
  fontSize: 14,
  color: COLORS.heading,
  background: '#fff',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  padding: '10px 12px',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: FONT_INTER,
  fontSize: 13,
  fontWeight: 500,
  color: COLORS.heading,
  marginBottom: 6,
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

export default function ContactForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [feedback, setFeedback] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('submitting')
    setFeedback('')
    try {
      const res = await fetch('/api/dalgo/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setFeedback(data.error || 'Something went wrong. Please try again.')
        return
      }
      setStatus('success')
      setFeedback(data.message || 'Thank you. We will respond within 2 business days.')
      setName('')
      setEmail('')
      setMessage('')
    } catch {
      setStatus('error')
      setFeedback('Network error. Please try again.')
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
      <div>
        <label style={labelStyle} htmlFor="contact-name">
          Name
        </label>
        <input
          id="contact-name"
          type="text"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle} htmlFor="contact-email">
          Email
        </label>
        <input
          id="contact-email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle} htmlFor="contact-message">
          Message
        </label>
        <textarea
          id="contact-message"
          required
          rows={5}
          value={message}
          onChange={e => setMessage(e.target.value)}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      {feedback && (
        <div
          style={{
            fontFamily: FONT_INTER,
            fontSize: 13,
            padding: '10px 12px',
            borderRadius: 8,
            background: status === 'success' ? COLORS.statusGreenBg : COLORS.statusRedBg,
            color: status === 'success' ? COLORS.statusGreenText : COLORS.statusRedText,
          }}
        >
          {feedback}
        </div>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        style={{
          fontFamily: FONT_INTER,
          fontWeight: 600,
          fontSize: 14,
          color: '#fff',
          background: COLORS.primary,
          border: 'none',
          borderRadius: 8,
          padding: '12px 20px',
          cursor: status === 'submitting' ? 'not-allowed' : 'pointer',
          opacity: status === 'submitting' ? 0.7 : 1,
          alignSelf: 'flex-start',
        }}
      >
        {status === 'submitting' ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}
