// GET /api/dalgo/customer/quotes?symbols=NSE:RELIANCE,NSE:INFY
// Returns live Kite quotes for the given symbols using customer's broker creds.
// symbols param: comma-separated NSE:SYMBOL strings.

import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { loadBrokerAccountCreds, kiteRequest } from '@/lib/kite'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const symbols = new URL(req.url).searchParams.get('symbols') || ''
    if (!symbols) return NextResponse.json({ quotes: {} })

    // Try primary customer creds first (paid Connect plan has /quote access)
    const primaryCustomerId = (process.env.CUSTOMER_IDS || '').split(',')[0]?.trim() || profile.id
    const creds = await loadBrokerAccountCreds(primaryCustomerId) ?? await loadBrokerAccountCreds(profile.id)
    if (!creds) return NextResponse.json({ quotes: {}, error: 'Kite not connected' })

    // Kite requires repeated i= params, not comma-separated
    const paramList = symbols.split(',').map(s => `i=${encodeURIComponent(s.trim())}`).join('&')
    const r = await kiteRequest<{ data?: Record<string, any> }>(`/quote?${paramList}`, creds)
    return NextResponse.json({ quotes: r.data?.data ?? {} })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    return NextResponse.json({ quotes: {}, error: String(err) })
  }
}
