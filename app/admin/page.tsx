import Link from 'next/link'
import { getProfile } from '@/lib/dalgoAuth'
import { getDashboardStats, getCustomerHealthRows, getRecentRegistrations } from '@/lib/dalgoAdmin'
import { PageHeader, StatGrid, StatCard, SectionCard, Table, Th, Td, Badge, StatusDot, EmptyState, statusTone, STATUS_LABELS, primaryButtonStyle, secondaryButtonStyle } from '@/components/dalgo/ui'

// Task 6.2 — SuperAdmin Dashboard. Server Component: getProfile()/role are
// already enforced by app/admin/layout.tsx, so this only needs the data.

export default async function AdminDashboardPage() {
  const profile = await getProfile()
  const [stats, healthRows, recentRegs] = await Promise.all([
    getDashboardStats(),
    getCustomerHealthRows(),
    getRecentRegistrations(5),
  ])

  return (
    <div>
      <PageHeader title={`Welcome, ${profile?.full_name ?? ''}`} subtitle="Platform overview and customer health" />

      <StatGrid>
        <StatCard label="Total Customers" value={stats.totalCustomers} />
        <StatCard label="Active Customers" value={stats.activeCustomers} tone="green" />
        <StatCard label="Pending Registrations" value={stats.pendingRegistrations} tone="amber" />
        <StatCard label="Account Managers" value={stats.accountManagers} tone="teal" />
      </StatGrid>

      <SectionCard
        title="Customer Health"
        actions={
          <Link href="/admin/customers" style={secondaryButtonStyle}>
            View all customers
          </Link>
        }
        style={{ marginBottom: 20 }}
      >
        {healthRows.length === 0 ? (
          <EmptyState>No active customer instances yet.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Subdomain</Th>
                <Th>Last Tick</Th>
                <Th>Token</Th>
                <Th>Cron Mode</Th>
                <Th align="right">Positions</Th>
                <Th align="right">Orders Today</Th>
              </tr>
            </thead>
            <tbody>
              {healthRows.map(row => (
                <tr key={row.instance.id}>
                  <Td>
                    <div style={{ fontWeight: 500, color: '#1E3A8A' }}>{row.customerName}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{row.customerEmail}</div>
                  </Td>
                  <Td>{row.instance.subdomain ?? '—'}</Td>
                  <Td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <StatusDot tone={row.lastTickDot} />
                      {row.instance.last_cron_tick_at
                        ? new Date(row.instance.last_cron_tick_at).toLocaleTimeString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'never'}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(row.instance.kite_token_status)}>{row.instance.kite_token_status}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={row.instance.cron_mode === 'auto' ? 'green' : 'amber'}>{row.instance.cron_mode}</Badge>
                  </Td>
                  <Td align="right">{row.instance.open_positions_count}</Td>
                  <Td align="right">{row.instance.todays_orders_count}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Recent Registrations"
        actions={
          <Link href="/admin/registrations" style={primaryButtonStyle}>
            View all registrations
          </Link>
        }
      >
        {recentRegs.length === 0 ? (
          <EmptyState>No registrations yet.</EmptyState>
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
              </tr>
            </thead>
            <tbody>
              {recentRegs.map(r => (
                <tr key={r.registration.id}>
                  <Td>
                    <Link href={`/admin/registrations/${r.registration.id}`} style={{ color: '#1E3A8A', textDecoration: 'none', fontWeight: 500 }}>
                      {r.registration.full_name}
                    </Link>
                  </Td>
                  <Td>{r.profileEmail}</Td>
                  <Td>
                    <Badge tone="teal">{r.registration.registration_type === 'customer' ? 'Customer' : 'Broking Co.'}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.profileStatus)}>{STATUS_LABELS[r.profileStatus] ?? r.profileStatus}</Badge>
                  </Td>
                  <Td>{new Date(r.registration.created_at).toLocaleDateString('en-IN')}</Td>
                  <Td>{r.assignedToName ?? <span style={{ color: '#94A3B8' }}>Unassigned</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </SectionCard>
    </div>
  )
}
