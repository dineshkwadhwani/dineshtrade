'use client'

// Shared client component for the registrations queue — used by both
// app/admin/registrations/page.tsx (Task 6.3) and
// app/manager/registrations/page.tsx (Task 6.11, `canAssign=false`,
// pre-filtered server-side to this AM's assigned registrations).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { RegistrationWithProfile } from '@/lib/dalgoAdmin'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { Badge, EmptyState, STATUS_LABELS, Table, Td, Th, statusTone } from '@/components/dalgo/ui'

interface Manager {
  id: string
  full_name: string
}

interface Props {
  registrations: RegistrationWithProfile[]
  accountManagers: Manager[]
  canAssign: boolean
  basePath: string // '/admin/registrations' | '/manager/registrations'
}

const STATUS_OPTIONS = ['all', 'pending', 'under_review', 'identity_verified', 'rejected'] as const
const TYPE_OPTIONS = ['all', 'customer', 'broking_company'] as const

const inputStyle: React.CSSProperties = {
  fontFamily: FONT_INTER,
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  background: '#fff',
  color: COLORS.body,
}

export default function RegistrationsClient({ registrations, accountManagers, canAssign, basePath }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('all')
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]>('all')
  const [search, setSearch] = useState('')
  const [assigning, setAssigning] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return registrations.filter(r => {
      if (status !== 'all' && r.profileStatus !== status) return false
      if (type !== 'all' && r.registration.registration_type !== type) return false
      if (q && !r.registration.full_name.toLowerCase().includes(q) && !r.profileEmail.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [registrations, status, type, search])

  async function handleAssign(registrationId: string, assignedTo: string) {
    if (!assignedTo) return
    setAssigning(registrationId)
    try {
      const res = await fetch(`/api/dalgo/admin/registrations/${registrationId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error || 'Failed to assign registration.')
      } else {
        router.refresh()
      }
    } finally {
      setAssigning(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, minWidth: 220 }}
        />
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)} style={inputStyle}>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
        <select value={type} onChange={e => setType(e.target.value as typeof type)} style={inputStyle}>
          {TYPE_OPTIONS.map(t => (
            <option key={t} value={t}>
              {t === 'all' ? 'All types' : t === 'customer' ? 'Customer' : 'Broking Company'}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState>No registrations match these filters.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>Submitted</Th>
              <Th>Assigned AM</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.registration.id}>
                <Td>{r.registration.full_name}</Td>
                <Td>{r.profileEmail}</Td>
                <Td>
                  <Badge tone="teal">{r.registration.registration_type === 'customer' ? 'Customer' : 'Broking Co.'}</Badge>
                </Td>
                <Td>
                  <Badge tone={statusTone(r.profileStatus)}>{STATUS_LABELS[r.profileStatus] ?? r.profileStatus}</Badge>
                </Td>
                <Td>{new Date(r.registration.created_at).toLocaleDateString('en-IN')}</Td>
                <Td>
                  {canAssign ? (
                    <select
                      value={r.registration.assigned_to ?? ''}
                      disabled={assigning === r.registration.id}
                      onChange={e => handleAssign(r.registration.id, e.target.value)}
                      style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}
                    >
                      <option value="">Unassigned</option>
                      {accountManagers.map(am => (
                        <option key={am.id} value={am.id}>
                          {am.full_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    r.assignedToName ?? <span style={{ color: COLORS.muted }}>Unassigned</span>
                  )}
                </Td>
                <Td align="right">
                  <Link href={`${basePath}/${r.registration.id}`} style={{ color: COLORS.primary, textDecoration: 'none', fontWeight: 500, fontSize: 13 }}>
                    View
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
