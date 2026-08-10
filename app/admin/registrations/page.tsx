export const dynamic = 'force-dynamic'

import { listRegistrations, listAccountManagers } from '@/lib/dalgoAdmin'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import RegistrationsClient from './RegistrationsClient'

// Task 6.3 — SuperAdmin registrations queue.
export default async function AdminRegistrationsPage() {
  const [registrations, managers] = await Promise.all([listRegistrations(), listAccountManagers()])

  return (
    <div>
      <PageHeader title="Registrations" subtitle="Review and assign incoming registrations" />
      <SectionCard>
        <RegistrationsClient
          registrations={registrations}
          accountManagers={managers.map(m => ({ id: m.id, full_name: m.full_name }))}
          canAssign
          basePath="/admin/registrations"
        />
      </SectionCard>
    </div>
  )
}
