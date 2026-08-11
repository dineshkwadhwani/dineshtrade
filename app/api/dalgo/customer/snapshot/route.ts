// GET /api/dalgo/customer/snapshot
// Live portfolio value (holdings × LTP) and available margin funds from Kite.
// Requires dalgo_access_token. Returns null values gracefully when not connected.

import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { loadBrokerAccountCreds, kiteRequest, getHoldings } from '@/lib/kite'

export const dynamic = 'force-dynamic'

interface MarginsResp {
  equity?: { available?: { live_balance?: number; cash?: number } }
}

export async function GET() {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creds = await loadBrokerAccountCreds(profile.id)
  if (!creds) {
    return NextResponse.json({ portfolioValue: null, availableFunds: null })
  }

  const [marginsResult, holdings] = await Promise.all([
    kiteRequest<{ data?: MarginsResp }>('/user/margins', creds).catch(() => null),
    getHoldings(creds).catch(() => []),
  ])

  const m = marginsResult?.data?.data?.equity?.available
  const availableFunds = m?.live_balance != null ? Number(m.live_balance) : m?.cash != null ? Number(m.cash) : null

  const portfolioValue = Number(
    holdings.reduce((sum, h) => {
      const qty = (h.quantity || 0) + (h.t1_quantity || 0)
      return sum + qty * (h.last_price || 0)
    }, 0).toFixed(2),
  )

  return NextResponse.json({ portfolioValue, availableFunds })
}
