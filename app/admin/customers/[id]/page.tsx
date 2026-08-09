import { notFound } from 'next/navigation'
import { getCustomerFullDetail, listAccountManagers } from '@/lib/dalgoAdmin'
import { PageHeader } from '@/components/dalgo/ui'
import CustomerDetailClient from './CustomerDetailClient'

// Task 6.5 — SuperAdmin customer detail.
export default async function AdminCustomerDetailPage({ params }: { params: { id: string } }) {
  const [detail, managers] = await Promise.all([getCustomerFullDetail(params.id), listAccountManagers()])
  if (!detail) notFound()

  return (
    <div>
      <PageHeader title={detail.profile.full_name} subtitle={detail.profile.email} />
      <CustomerDetailClient
        detail={detail}
        accountManagers={managers.map(m => ({ id: m.id, full_name: m.full_name }))}
        canActivate
        canEditCapital
      />
    </div>
  )
}
