import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getAccountSecrets, isAccountConfigured, getAccountList } from '@/lib/accounts'
import { getState } from '@/lib/state'
import { runPreflight, markPlaced } from '@/lib/preflight'
import { sendEmail } from '@/lib/email'

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
  const symbolUpper = String(order.symbol).toUpperCase()
  const qty = Number(order.quantity)
  const pricePerShare = Number(order.price) || 0  // used by preflight funds/perTrade math; not sent to Kite

  // Optional enrichment for nicer emails (Engine page passes these through).
  const target1 = order.target1 !== undefined ? Number(order.target1) : undefined
  const target2 = order.target2 !== undefined ? Number(order.target2) : undefined
  const stopLoss = order.stopLoss !== undefined ? Number(order.stopLoss) : undefined
  const source = typeof order.source === 'string' ? order.source : 'Manual Execute'
  const reason = typeof order.reason === 'string' ? order.reason : undefined
  const symbolName = typeof order.symbolName === 'string' ? order.symbolName : undefined

  const state = await getState()
  const mode = state.mode === 'auto' ? 'auto' as const : 'manual' as const
  const accountDisplayName = getAccountList().find(a => a.name === account)?.displayName

  // Pre-flight gates — must all pass before we hit Kite's place_order.
  const pre = await runPreflight({
    account,
    symbol: symbolUpper,
    side,
    quantity: qty,
    pricePerShare,
  })
  if (!pre.ok) {
    // Email the user when a preflight gate blocked the trade — they explicitly clicked Execute
    // (or the cron tried it) and deserve a notification with the reason.
    sendEmail('trade_failed', {
      account,
      accountDisplayName,
      symbol: symbolUpper,
      side,
      quantity: qty,
      price: pricePerShare || undefined,
      failedAt: 'preflight',
      gate: pre.gate,
      reason: pre.reason || 'Unknown preflight failure',
      mode,
    }).catch(err => console.error('[email] preflight-failed notification:', err))

    return NextResponse.json({ account, error: 'Preflight failed', gate: pre.gate, reason: pre.reason }, { status: 422 })
  }

  const orderTag = typeof order.tag === 'string' && order.tag ? String(order.tag).slice(0, 20) : undefined
  const kiteBody: Record<string, string> = {
    tradingsymbol: order.symbol,
    exchange: 'NSE',
    transaction_type: side,
    quantity: String(qty),
    product: 'CNC',
    order_type: 'MARKET',
    validity: 'DAY',
    market_protection: '-1',
  }
  if (orderTag) kiteBody.tag = orderTag
  const r = await kiteRequest('/orders/regular', creds.apiKey, creds.accessToken, 'POST', kiteBody)

  if (r.ok && r.data?.data?.order_id) {
    markPlaced(account, symbolUpper, side)
    sendEmail('trade_executed', {
      account,
      accountDisplayName,
      symbol: symbolUpper,
      symbolName,
      side,
      quantity: qty,
      price: pricePerShare || undefined,
      target1,
      target2,
      stopLoss,
      orderId: r.data.data.order_id,
      source,
      reason,
      mode,
    }).catch(err => console.error('[email] trade-executed notification:', err))
  } else if (!r.ok) {
    const errMsg = r.data?.message || r.data?.error_type || `Kite HTTP ${r.status}`
    sendEmail('trade_failed', {
      account,
      accountDisplayName,
      symbol: symbolUpper,
      side,
      quantity: qty,
      price: pricePerShare || undefined,
      failedAt: 'kite',
      reason: errMsg,
      mode,
    }).catch(err => console.error('[email] kite-failed notification:', err))
  }

  return NextResponse.json({ account, ...r.data }, { status: r.ok ? 200 : (r.status || 502) })
}
