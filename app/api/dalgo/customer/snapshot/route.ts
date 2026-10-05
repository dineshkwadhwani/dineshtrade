// GET /api/dalgo/customer/snapshot
// Live portfolio value (holdings × LTP) and available margin funds from Kite.
// Requires dalgo_access_token. Returns null values gracefully when not connected.

import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { loadCustomerBroker } from '@/lib/broker/customer'

export const dynamic = 'force-dynamic'

export async function GET() {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customerBroker = await loadCustomerBroker(profile.id).catch(() => null)
  if (!customerBroker) {
    return NextResponse.json({ portfolioValue: null, availableFunds: null })
  }

  const [margins, holdings] = await Promise.all([
    customerBroker.broker.getMargins().catch(() => null),
    customerBroker.broker.getHoldings().catch(() => []),
  ])

  const availableFunds = margins ? Number(margins.available) : null

  const portfolioValue = Number(
    holdings.reduce((sum, h) => {
      const qty = (h.quantity || 0) + (h.t1Quantity || 0)
      return sum + qty * (h.lastPrice || 0)
    }, 0).toFixed(2),
  )

  const investedValue = Number(
    holdings.reduce((sum, h) => {
      const qty = (h.quantity || 0) + (h.t1Quantity || 0)
      return sum + qty * (h.averagePrice || 0)
    }, 0).toFixed(2),
  )

  return NextResponse.json({ portfolioValue, investedValue, availableFunds })
}
