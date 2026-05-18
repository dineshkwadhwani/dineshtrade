import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getAccountSecrets, isAccountConfigured } from '@/lib/accounts'
import { getState } from '@/lib/state'
import { runPreflight, markPlaced } from '@/lib/preflight'

const KITE_BASE = 'https://api.kite.trade'

async function authed(): Promise<boolean> {
  const session = cookies().get('dt_session')?.value
  if (!session) return false
  return verifySession(session)
}

// Resolve { apiKey, accessToken } for a configured account. Returns an error
// description if anything is missing — caller maps that to a 400.
async function resolveAccountCreds(account: string): Promise<
  | { ok: true; apiKey: string; accessToken: string }
  | { ok: false; error: string }
> {
  if (!isAccountConfigured(account)) return { ok: false, error: `Unknown account: ${account}` }
  const secrets = getAccountSecrets(account)!
  const state = await getState()
  const accessToken = state.kiteTokens[account]
  if (!accessToken) return { ok: false, error: `${account} not connected — paste today's Kite access token in Settings` }
  return { ok: true, apiKey: secrets.apiKey, accessToken }
}

async function kiteRequest(endpoint: string, apiKey: string, accessToken: string, method = 'GET', body?: Record<string, string>) {
  const res = await fetch(`${KITE_BASE}${endpoint}`, {
    method,
    headers: {
      'X-Kite-Version': '3',
      'Authorization': `token ${apiKey}:${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, data }
}

export async function GET(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const account = sp.get('account')
  const action = sp.get('action')
  if (!account) return NextResponse.json({ error: 'account query param required' }, { status: 400 })

  const creds = await resolveAccountCreds(account)
  if (!creds.ok) return NextResponse.json({ error: creds.error }, { status: 400 })

  let endpoint = ''
  switch (action) {
    case 'holdings':  endpoint = '/portfolio/holdings'; break
    case 'positions': endpoint = '/portfolio/positions'; break
    case 'orders':    endpoint = '/orders'; break
    case 'margins':
    case 'funds':     endpoint = '/user/margins'; break
    case 'profile':   endpoint = '/user/profile'; break
    case 'quote': {
      const symbols = sp.get('symbols') || ''
      endpoint = `/quote?i=${encodeURIComponent(symbols)}`
      break
    }
    default:
      return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 })
  }

  const r = await kiteRequest(endpoint, creds.apiKey, creds.accessToken)
  return NextResponse.json({ account, ...r.data }, { status: r.ok ? 200 : (r.status || 502) })
}

export async function POST(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { account, action, order } = body
  if (!account) return NextResponse.json({ error: 'account is required' }, { status: 400 })

  const creds = await resolveAccountCreds(account)
  if (!creds.ok) return NextResponse.json({ error: creds.error }, { status: 400 })

  if (action !== 'place_order') {
    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 })
  }
  if (!order?.symbol || !order?.quantity || !order?.transaction_type) {
    return NextResponse.json({ error: 'order requires symbol, quantity, transaction_type' }, { status: 400 })
  }

  const side = String(order.transaction_type).toUpperCase() as 'BUY' | 'SELL'
  const pricePerShare = Number(order.price) || 0  // used by preflight funds/perTrade math; not sent to Kite

  // Pre-flight gates — must all pass before we hit Kite's place_order.
  const pre = await runPreflight({
    account,
    symbol: String(order.symbol).toUpperCase(),
    side,
    quantity: Number(order.quantity),
    pricePerShare,
  })
  if (!pre.ok) {
    return NextResponse.json({ account, error: 'Preflight failed', gate: pre.gate, reason: pre.reason }, { status: 422 })
  }

  const r = await kiteRequest('/orders/regular', creds.apiKey, creds.accessToken, 'POST', {
    tradingsymbol: order.symbol,
    exchange: 'NSE',
    transaction_type: side,
    quantity: String(order.quantity),
    product: 'CNC',
    order_type: 'MARKET',
    validity: 'DAY',
    market_protection: '-1',
  })

  // On success, record in idempotency ledger so we don't double-place.
  if (r.ok && r.data?.data?.order_id) {
    markPlaced(account, String(order.symbol).toUpperCase(), side)
  }

  return NextResponse.json({ account, ...r.data }, { status: r.ok ? 200 : (r.status || 502) })
}
