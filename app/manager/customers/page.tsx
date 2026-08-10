export const dynamic = 'force-dynamic'

import { getProfile } from '@/lib/dalgoAuth'
import { listCustomers } from '@/lib/dalgoAdmin'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import CustomersClient from '@/app/admin/customers/CustomersClient'

// "My Customers" nav item (Task 6.1) — reuses the admin CustomersClient,
// pre-filtered server-side to this AM's assigned customers. The AM filter
// dropdown is hidden (accountManagers omitted) since there's nothing to
// filter by — every row here is already this AM's own customer.
export default async function ManagerCustomersPage() {
  const profile = await getProfile()
  if (!profile) return null
  const customers = await listCustomers({ assignedTo: profile.id })

  return (
    <div>
      <PageHeader title="My Customers" subtitle="Customers assigned to you" />
      <SectionCard>
        <CustomersClient customers={customers} basePath="/manager/customers" />
      </SectionCard>
    </div>
  )
}
