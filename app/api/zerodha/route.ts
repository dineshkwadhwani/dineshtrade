import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'
import { cookies } from 'next/headers'

const KITE_BASE = 'https://api.kite.trade'
const TOKEN_COOKIE = 'dt_zerodha_token'

async function kiteRequest(endpoint: string, accessToken: string, method = 'GET', body?: any) {
  const res = await fetch(`${KITE_BASE}${endpoint}`, {
    method,
    headers: {
      'X-Kite-Version': '3',
      'Authorization': `token ${process.env.ZERODHA_API_KEY}:${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  })
  return res.json()
}

function getAccessToken(): string {
  // Always read from session cookie — never from env
  return cookies().get(TOKEN_COOKIE)?.value || ''
}

export async function GET(req: NextRequest) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accessToken = getAccessToken()
  if (!accessToken) {
    return NextResponse.json({
      error: 'Zerodha not connected',
      action: 'Please paste your Zerodha access token in Settings → Zerodha Connection'
    }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  try {
    switch (action) {
      case 'holdings':
        return NextResponse.json(await kiteRequest('/portfolio/holdings', accessToken))
      case 'positions':
        return NextResponse.json(await kiteRequest('/portfolio/positions', accessToken))
      case 'orders':
        return NextResponse.json(await kiteRequest('/orders', accessToken))
      case 'funds':
        return NextResponse.json(await kiteRequest('/user/margins', accessToken))
      case 'quote':
        const symbols = searchParams.get('symbols') || ''
        return NextResponse.json(await kiteRequest(`/quote?i=${encodeURIComponent(symbols)}`, accessToken))
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Zerodha API error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accessToken = getAccessToken()
  if (!accessToken) {
    return NextResponse.json({
      error: 'Zerodha not connected',
      action: 'Please paste your Zerodha access token in Settings'
    }, { status: 400 })
  }

  const { action, order } = await req.json()

  if (action === 'place_order') {
    if (!order?.symbol || !order?.quantity || !order?.transaction_type) {
      return NextResponse.json({ error: 'Invalid order parameters' }, { status: 400 })
    }
    const data = await kiteRequest('/orders/regular', accessToken, 'POST', {
      tradingsymbol: order.symbol,
      exchange: 'NSE',
      transaction_type: order.transaction_type.toUpperCase(),
      quantity: String(order.quantity),
      product: 'CNC',
      order_type: 'MARKET',
      validity: 'DAY',
      market_protection: '-1', // SEBI mandated market protection
    })
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
