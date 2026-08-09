import Link from 'next/link'
import { getProfile } from '@/lib/dalgoAuth'
import { getManagerDashboardStats, listCustomers } from '@/lib/dalgoAdmin'
import { PageHeader, StatGrid, StatCard, SectionCard, Table, Th, Td, Badge, EmptyState, statusTone, STATUS_LABELS } from '@/components/dalgo/ui'
import { COLORS } from '@/components/dalgo/theme'

// Task 6.10 — Account Manager Dashboard. Shows only this AM's assigned
// customers (see lib/dalgoAdmin.ts's {assignedTo} filter on every query).
export default async function ManagerDashboardPage() {
  const profile = await getProfile()
  if (!profile) return null

  const [stats, customers] = await Promise.all([
    getManagerDashboardStats(profile.id),
    listCustomers({ assignedTo: profile.id }),
  ])

  return (
    <div>
      <PageHeader title={`Welcome, ${profile.full_name}`} subtitle="Your assigned customers" />

      <StatGrid>
        <StatCard label="My Customers" value={stats.myCustomers} />
        <StatCard label="Pending Registrations" value={stats.myPendingRegistrations} tone="amber" />
        <StatCard label="Active Customers" value={stats.myActiveCustomers} tone="green" />
        <StatCard label="In Auto Mode" value={stats.myAutoModeCustomers} tone="teal" />
      </StatGrid>

      <SectionCard title="My Customers">
        {customers.length === 0 ? (
          <EmptyState>No customers assigned to you yet.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Status</Th>
                <Th>Token</Th>
                <Th>Cron Mode</Th>
                <Th>Last Active</Th>
                <Th align="right">Positions</Th>
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.profile.id}>
                  <Td>
                    <Link href={`/manager/customers/${c.profile.id}`} style={{ color: COLORS.heading, textDecoration: 'none', fontWeight: 500 }}>
                      {c.profile.full_name}
                    </Link>
                  </Td>
                  <Td>{c.profile.email}</Td>
                  <Td>
                    <Badge tone={statusTone(c.profile.status)}>{STATUS_LABELS[c.profile.status] ?? c.profile.status}</Badge>
                  </Td>
                  <Td>
                    {c.instance ? (
                      <Badge tone={statusTone(c.instance.kite_token_status)}>{c.instance.kite_token_status}</Badge>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    {c.instance ? (
                      <Badge tone={c.instance.cron_mode === 'auto' ? 'green' : 'amber'}>{c.instance.cron_mode}</Badge>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>{c.instance?.last_heartbeat_at ? new Date(c.instance.last_heartbeat_at).toLocaleString('en-IN') : '—'}</Td>
                  <Td align="right">{c.instance?.open_positions_count ?? 0}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </SectionCard>
    </div>
  )
}
