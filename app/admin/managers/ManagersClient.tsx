'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AccountManagerRow } from '@/lib/dalgoAdmin'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { EmptyState, Table, Td, Th, primaryButtonStyle, secondaryButtonStyle } from '@/components/dalgo/ui'

interface Props {
  managers: AccountManagerRow[]
}

const inputStyle: React.CSSProperties = {
  fontFamily: FONT_INTER,
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  width: '100%',
}

export default function ManagersClient({ managers }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleCreate() {
    if (!fullName.trim() || !email.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/dalgo/admin/managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullName.trim(), email: email.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error || 'Failed to create account manager.')
      } else {
        setFullName('')
        setEmail('')
        setShowForm(false)
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        {!showForm ? (
          <button onClick={() => setShowForm(true)} style={primaryButtonStyle}>
            Create Account Manager
          </button>
        ) : (
          <div
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
              padding: 16,
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              background: '#F8FAFF',
            }}
          >
            <div style={{ minWidth: 200 }}>
              <label style={{ fontSize: 11, color: COLORS.muted }}>Full Name</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
            </div>
            <div style={{ minWidth: 220 }}>
              <label style={{ fontSize: 11, color: COLORS.muted }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ ...inputStyle, marginTop: 4 }}
              />
            </div>
            <button onClick={handleCreate} disabled={busy} style={{ ...primaryButtonStyle, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => {
                setShowForm(false)
                setFullName('')
                setEmail('')
              }}
              disabled={busy}
              style={secondaryButtonStyle}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {managers.length === 0 ? (
        <EmptyState>No account managers yet.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th align="right">Customers Assigned</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {managers.map(m => (
              <tr key={m.id}>
                <Td>{m.full_name}</Td>
                <Td>{m.email}</Td>
                <Td align="right">{m.customerCount}</Td>
                <Td>{new Date(m.created_at).toLocaleDateString('en-IN')}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
