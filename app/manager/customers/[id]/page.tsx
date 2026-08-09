import { notFound, redirect } from 'next/navigation'
import { getProfile } from '@/lib/dalgoAuth'
import { getCustomerFullDetail } from '@/lib/dalgoAdmin'
import { PageHeader } from '@/components/dalgo/ui'
import CustomerDetailClient from '@/app/admin/customers/[id]/CustomerDetailClient'

// Task 6.12 — AM customer detail. Same as /admin/customers/[id] but:
//   - no reassign control (accountManagers prop omitted entirely)
//   - no audit log section (CustomerDetailClient never renders one either way)
//   - can activate (Step 2) and edit capital config (Manual mode only), both
//     scoped to "this customer must be assigned to me" below
//   - read-only strategies view (same as admin — CustomerDetailClient never
//     renders strategy edit controls at all)
export default async function ManagerCustomerDetailPage({ params }: { params: { id: string } }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const detail = await getCustomerFullDetail(params.id)
  if (!detail || detail.profile.assigned_account_manager_id !== profile.id) notFound()

  return (
    <div>
      <PageHeader title={detail.profile.full_name} subtitle={detail.profile.email} />
      <CustomerDetailClient detail={detail} canActivate canEditCapital />
    </div>
  )
}
