export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { getProfile } from '@/lib/dalgoAuth'
import { getRegistrationById } from '@/lib/dalgoAdmin'
import { getFileUrl } from '@/lib/storage'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import RegistrationDetailClient from '@/app/admin/registrations/[id]/RegistrationDetailClient'

// Task 6.11 — AM registration detail view. An AM may only view/act on a
// registration assigned to them — anything else 404s rather than leaking
// another AM's applicant data.
export default async function ManagerRegistrationDetailPage({ params }: { params: { id: string } }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const record = await getRegistrationById(params.id)
  if (!record || record.registration.assigned_to !== profile.id) notFound()

  const { registration } = record
  const [aadharFrontUrl, aadharBackUrl] = await Promise.all([
    registration.aadhar_front_url ? getFileUrl(registration.aadhar_front_url).catch(() => null) : null,
    registration.aadhar_back_url ? getFileUrl(registration.aadhar_back_url).catch(() => null) : null,
  ])

  return (
    <div>
      <PageHeader title={registration.full_name} subtitle="Registration detail" />
      <SectionCard>
        <RegistrationDetailClient
          registration={registration}
          profileEmail={record.profileEmail}
          profileStatus={record.profileStatus}
          assignedToName={record.assignedToName}
          aadharFrontUrl={aadharFrontUrl}
          aadharBackUrl={aadharBackUrl}
          canAct
        />
      </SectionCard>
    </div>
  )
}
