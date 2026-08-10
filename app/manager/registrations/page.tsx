export const dynamic = 'force-dynamic'

import { getProfile } from '@/lib/dalgoAuth'
import { listRegistrations } from '@/lib/dalgoAdmin'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import RegistrationsClient from '@/app/admin/registrations/RegistrationsClient'

// Task 6.11 — AM Registrations. Same as /admin/registrations but filtered to
// registrations assigned to the current AM; assign-to-AM control hidden
// (canAssign=false) — only SuperAdmin assigns registrations (spec §3.5).
export default async function ManagerRegistrationsPage() {
  const profile = await getProfile()
  if (!profile) return null
  const registrations = await listRegistrations({ assignedTo: profile.id })

  return (
    <div>
      <PageHeader title="Registrations" subtitle="Registrations assigned to you for review" />
      <SectionCard>
        <RegistrationsClient registrations={registrations} accountManagers={[]} canAssign={false} basePath="/manager/registrations" />
      </SectionCard>
    </div>
  )
}
