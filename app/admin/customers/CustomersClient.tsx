'use client'

// Shared client component for the customer list — used by both
// app/admin/customers/page.tsx (Task 6.4, all customers) and
// app/manager/customers/page.tsx (pre-filtered server-side to this AM's
// assigned customers, AM filter hidden since there's nothing to filter by).

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { CustomerListRow } from '@/lib/dalgoAdmin'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { Badge, EmptyState, STATUS_LABELS, Table, Td, Th, statusTone } from '@/components/dalgo/ui'

interface Manager {
  id: string
  full_name: string
}

interface Props {
  customers: CustomerListRow[]
  accountManagers?: Manager[] // omit to hide the AM filter (manager view)
  basePath: string // '/admin/customers' | '/manager/customers'
}

const STATUS_OPTIONS = ['all', 'active', 'identity_verified', 'pending', 'suspended'] as const

const inputStyle: React.CSSProperties = {
  fontFamily: FONT_INTER,
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  background: '#fff',
  color: COLORS.body,
}

export default function CustomersClient({ customers, accountManagers, basePath }: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('all')
  const [amFilter, setAmFilter] = useState('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customers.filter(c => {
      if (status !== 'all' && c.profile.status !== status) return false
      if (amFilter !== 'all' && c.profile.assigned_account_manager_id !== amFilter) return false
      if (q && !c.profile.full_name.toLowerCase().includes(q) && !c.profile.email.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [customers, search, status, amFilter])

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
        {accountManagers && (
          <select value={amFilter} onChange={e => setAmFilter(e.target.value)} style={inputStyle}>
            <option value="all">All Account Managers</option>
            {accountManagers.map(am => (
              <option key={am.id} value={am.id}>
                {am.full_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>No customers match these filters.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Status</Th>
              <Th>Account Manager</Th>
              <Th>Registered</Th>
              <Th>Last Active</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const lastActive = c.instance?.last_heartbeat_at ?? c.profile.updated_at
              return (
                <tr key={c.profile.id} style={{ cursor: 'pointer' }}>
                  <Td>
                    <Link
                      href={`${basePath}/${c.profile.id}`}
                      style={{ color: COLORS.heading, textDecoration: 'none', fontWeight: 500 }}
                    >
                      {c.profile.full_name}
                    </Link>
                  </Td>
                  <Td>{c.profile.email}</Td>
                  <Td>
                    <Badge tone={statusTone(c.profile.status)}>{STATUS_LABELS[c.profile.status] ?? c.profile.status}</Badge>
                  </Td>
                  <Td>{c.amName ?? <span style={{ color: COLORS.muted }}>Unassigned</span>}</Td>
                  <Td>{new Date(c.profile.created_at).toLocaleDateString('en-IN')}</Td>
                  <Td>{lastActive ? new Date(lastActive).toLocaleString('en-IN') : '—'}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}
