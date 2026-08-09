import { getProfile } from '@/lib/dalgoAuth'
import { getReportsRows, listCustomers } from '@/lib/dalgoAdmin'
import { PageHeader, SectionCard, Table, Th, Td, EmptyState } from '@/components/dalgo/ui'
import ReportsFiltersClient from '@/app/admin/reports/ReportsFiltersClient'

// Task 6.14 — AM Reports. Same as /admin/reports but pre-scoped to this AM's
// assigned customers (AM filter dropdown omitted — nothing to filter by).
function defaultRange() {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - 30)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export default async function ManagerReportsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; customer?: string }
}) {
  const profile = await getProfile()
  if (!profile) return null

  const { from: defFrom, to: defTo } = defaultRange()
  const from = searchParams.from || defFrom
  const to = searchParams.to || defTo

  const [rows, customers] = await Promise.all([
    getReportsRows({ fromDate: from, toDate: to, customerId: searchParams.customer, assignedTo: profile.id }),
    listCustomers({ assignedTo: profile.id }),
  ])

  return (
    <div>
      <PageHeader title="Reports" subtitle={`${from} to ${to}`} />
      <SectionCard>
        <ReportsFiltersClient
          basePath="/manager/reports"
          exportPath="/api/dalgo/admin/reports/export"
          customers={customers.map(c => ({ id: c.profile.id, label: c.profile.full_name }))}
        />
        {rows.length === 0 ? (
          <EmptyState>No orders or trades in this date range.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th align="right">Total Orders</Th>
                <Th align="right">Total Buys</Th>
                <Th align="right">Total Sells</Th>
                <Th align="right">Winning Trades</Th>
                <Th align="right">Win Rate</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.customerId}>
                  <Td>{r.customerName}</Td>
                  <Td align="right">{r.totalOrders}</Td>
                  <Td align="right">{r.totalBuys}</Td>
                  <Td align="right">{r.totalSells}</Td>
                  <Td align="right">
                    {r.winningTrades} / {r.totalTrades}
                  </Td>
                  <Td align="right">{r.winRatePct}%</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </SectionCard>
    </div>
  )
}
