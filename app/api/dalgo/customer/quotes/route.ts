// GET /api/dalgo/customer/quotes?symbols=NSE:RELIANCE,NSE:INFY
// Returns live Kite quotes for the given symbols using customer's broker creds.
// symbols param: comma-separated NSE:SYMBOL strings.

import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { loadCustomerBroker } from '@/lib/broker/customer'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const symbols = new URL(req.url).searchParams.get('symbols') || ''
    if (!symbols) return NextResponse.json({ quotes: {} })

    const customerBroker = await loadCustomerBroker(profile.id).catch(() => null)
    if (!customerBroker) return NextResponse.json({ quotes: {}, error: 'Selected broker not connected' })
    const symbolList = symbols.split(',').map(value => value.trim().replace(/^NSE:/i, '')).filter(Boolean)
    const quotes = await customerBroker.broker.getQuotes(symbolList)
    const normalized = Object.fromEntries(Object.entries(quotes).map(([symbol, quote]) => [
      `NSE:${symbol}`,
      {
        last_price: quote.lastPrice,
        volume: quote.volume,
        net_change: quote.netChange,
        ohlc: { open: quote.open, high: quote.high, low: quote.low, close: quote.close },
      },
    ]))
    return NextResponse.json({ quotes: normalized })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    return NextResponse.json({ quotes: {}, error: String(err) })
  }
}
