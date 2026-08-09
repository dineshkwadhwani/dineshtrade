import { notFound } from 'next/navigation'
import { getRegistrationById } from '@/lib/dalgoAdmin'
import { getFileUrl } from '@/lib/storage'
import { PageHeader, SectionCard } from '@/components/dalgo/ui'
import RegistrationDetailClient from './RegistrationDetailClient'

// Task 6.3 — SuperAdmin registration detail view. SuperAdmin can act on any
// registration regardless of assignment.
export default async function AdminRegistrationDetailPage({ params }: { params: { id: string } }) {
  const record = await getRegistrationById(params.id)
  if (!record) notFound()

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
