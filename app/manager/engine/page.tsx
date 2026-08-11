export const dynamic = 'force-dynamic'

import { getProfile } from '@/lib/dalgoAuth'
import { listCustomers } from '@/lib/dalgoAdmin'
import { PageHeader } from '@/components/dalgo/ui'
import PrivilegedEnginePanel, { type CustomerOption } from '@/components/dalgo/PrivilegedEnginePanel'

export default async function ManagerEnginePage() {
  const profile = await getProfile()
  if (!profile) return null

  // AM sees only their assigned customers
  const rows = await listCustomers({ assignedTo: profile.id })

  const customers: CustomerOption[] = rows
    .filter(r => r.profile.status === 'active')
    .map(r => ({
      id: r.profile.id,
      name: r.profile.full_name,
      email: r.profile.email,
      kiteStatus: r.instance?.kite_token_status ?? undefined,
      cronMode: r.instance?.cron_mode ?? undefined,
    }))

  return (
    <div>
      <PageHeader
        title="Trading Engine"
        subtitle="Run strategy scans and place orders for your assigned customers"
      />
      <PrivilegedEnginePanel customers={customers} />
    </div>
  )
}
