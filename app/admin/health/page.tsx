export const dynamic = 'force-dynamic'

import { PageHeader } from '@/components/dalgo/ui'
import HealthCheckPanel from '@/components/dalgo/HealthCheckPanel'

export default function AdminHealthPage() {
  return (
    <div>
      <PageHeader title="Health Check" subtitle="System status and customer readiness overview" />
      <HealthCheckPanel />
    </div>
  )
}
