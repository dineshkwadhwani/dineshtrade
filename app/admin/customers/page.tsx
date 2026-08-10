export const dynamic = 'force-dynamic'

import { listCustomers, listAccountManagers } from '@/lib/dalgoAdmin'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import CustomersClient from './CustomersClient'

// Task 6.4 — SuperAdmin customer list.
export default async function AdminCustomersPage() {
  const [customers, managers] = await Promise.all([listCustomers(), listAccountManagers()])

  return (
    <div>
      <PageHeader title="Customers" subtitle="All customers on the platform" />
      <SectionCard>
        <CustomersClient
          customers={customers}
          accountManagers={managers.map(m => ({ id: m.id, full_name: m.full_name }))}
          basePath="/admin/customers"
        />
      </SectionCard>
    </div>
  )
}
