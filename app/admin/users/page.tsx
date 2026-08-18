export const dynamic = 'force-dynamic'

import { listCustomers, listAccountManagers } from '@/lib/dalgoAdmin'
import { PageHeader } from '@/components/dalgo/ui'
import UsersClient from './UsersClient'
import CustomersClient from '../customers/CustomersClient'
import ManagersClient from '../managers/ManagersClient'

export default async function AdminUsersPage() {
  const [customers, managers] = await Promise.all([listCustomers(), listAccountManagers()])

  return (
    <div>
      <PageHeader title="Users" subtitle="Account managers, broker companies, and customers" />
      <UsersClient
        managersTab={<ManagersClient managers={managers} />}
        customersTab={
          <CustomersClient
            customers={customers}
            accountManagers={managers.map(m => ({ id: m.id, full_name: m.full_name }))}
            basePath="/admin/users"
          />
        }
      />
    </div>
  )
}
