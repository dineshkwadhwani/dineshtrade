import { listAccountManagers } from '@/lib/dalgoAdmin'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import ManagersClient from './ManagersClient'

// Task 6.6 — Account Managers.
export default async function AdminManagersPage() {
  const managers = await listAccountManagers()
  return (
    <div>
      <PageHeader title="Account Managers" subtitle="Manage who reviews and activates customers" />
      <SectionCard>
        <ManagersClient managers={managers} />
      </SectionCard>
    </div>
  )
}
