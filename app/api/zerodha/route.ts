import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getAccountSecrets, isAccountConfigured, getAccountList } from '@/lib/accounts'
import { getState } from '@/lib/state'
import { runPreflight, markPlaced } from '@/lib/preflight'
import { recordStrategy1Buy, STRATEGY_1_BUY_TAG } from '@/lib/strategy1'
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
    cache: 'no-store',   // Kite data must be live — never cached by Next.js fetch
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
      // Kite's /quote expects REPEATED i= params, not a single comma-separated value.
      // Wrong:  /quote?i=NSE:BAJFINANCE,NSE:RELIANCE
      // Right:  /quote?i=NSE:BAJFINANCE&i=NSE:RELIANCE
      // The comma form returns an empty data object with no error — that's why
      // earlier the Watchlist showed dashes everywhere even on valid symbols.
      const symbols = sp.get('symbols') || ''
      const ids = symbols.split(',').map(s => s.trim()).filter(Boolean)
      endpoint = `/quote?${ids.map(id => `i=${encodeURIComponent(id)}`).join('&')}`
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
  const source = typeof order.source === 'string' ? order.source : 'Manual Execute'
  const reason = typeof order.reason === 'string' ? order.reason : undefined
  const symbolName = typeof order.symbolName === 'string' ? order.symbolName : undefined

  // Manual order options (BUY/SELL from Watchlist or Holdings modal).
  // - product: CNC (delivery) or MIS (intraday)
  // - orderType: MARKET or LIMIT
  // - limitPrice: required when orderType === 'LIMIT'
  // - manual: true bypasses rate-limit gates (per-trade cap / quota / position cap / idempotency / no-loss-sell)
  const product: 'CNC' | 'MIS' = order.product === 'MIS' ? 'MIS' : 'CNC'
  const orderTypeReq: 'MARKET' | 'LIMIT' = order.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET'
  const limitPrice = orderTypeReq === 'LIMIT' ? Number(order.limitPrice) : undefined
  const manual = !!order.manual
  if (orderTypeReq === 'LIMIT' && (!limitPrice || limitPrice <= 0)) {
    return NextResponse.json({ error: 'LIMIT order requires a positive limitPrice' }, { status: 400 })
  }

  const state = await getState()
  const mode = state.mode === 'auto' ? 'auto' as const : 'manual' as const
  const accountDisplayName = getAccountList().find(a => a.name === account)?.displayName

  // Pre-flight gates — must all pass before we hit Kite's place_order.
  // For manual orders: only the essential safety gates run (see lib/preflight.ts).
  const pre = await runPreflight({
    account,
    symbol: symbolUpper,
    side,
    quantity: qty,
    pricePerShare,
    manual,
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

  // Preflight may clamp SELL qty to live holdings — honor that to avoid short-selling.
  const actualQty = pre.adjustedQty ?? qty
  const sellQtyAdjusted = side === 'SELL' && pre.adjustedQty !== undefined

  const orderTag = typeof order.tag === 'string' && order.tag ? String(order.tag).slice(0, 20) : undefined
  const kiteBody: Record<string, string> = {
    tradingsymbol: order.symbol,
    exchange: 'NSE',
    transaction_type: side,
    quantity: String(actualQty),
    product,
    order_type: orderTypeReq,
    validity: 'DAY',
  }
  if (orderTypeReq === 'MARKET') {
    kiteBody.market_protection = '-1'
  } else if (orderTypeReq === 'LIMIT' && limitPrice) {
    kiteBody.price = String(limitPrice)
  }
  if (orderTag) kiteBody.tag = orderTag
  const r = await kiteRequest('/orders/regular', creds.apiKey, creds.accessToken, 'POST', kiteBody)

  if (r.ok && r.data?.data?.order_id) {
    await markPlaced(account, symbolUpper, side, { price: pricePerShare, manual })
    // Persist Strategy 1 BUYs so the SELL monitor manages them across days.
    if (side === 'BUY' && orderTag === STRATEGY_1_BUY_TAG) {
      recordStrategy1Buy(account, symbolUpper, actualQty, pricePerShare)
        .catch(err => console.error('[zerodha route] strategy1 record failed:', err))
    }
    // Persist Strategy 2 BUYs into the multi-day position store. dt-s2 is used
    // when the user clicks Execute on a Catalyst recommendation from /engine.
    if (side === 'BUY' && orderTag === 'dt-s2') {
      const { recordStrategy2Buy } = await import('@/lib/strategy2Positions')
      recordStrategy2Buy(account, symbolUpper, actualQty, pricePerShare)
        .catch(err => console.error('[zerodha route] strategy2 record failed:', err))
    }
    sendEmail('trade_executed', {
      account,
      accountDisplayName,
      symbol: symbolUpper,
      symbolName,
      side,
      quantity: actualQty,
      price: pricePerShare || undefined,
      target1,
      target2,
      orderId: r.data.data.order_id,
      source,
      reason: sellQtyAdjusted
        ? `${reason || ''}${reason ? ' · ' : ''}Clamped ${qty} → ${actualQty} (live held quantity)`.trim()
        : reason,
      mode,
    }).catch(err => console.error('[email] trade-executed notification:', err))
  } else if (!r.ok) {
    const errMsg = r.data?.message || r.data?.error_type || `Kite HTTP ${r.status}`
    sendEmail('trade_failed', {
      account,
      accountDisplayName,
      symbol: symbolUpper,
      side,
      quantity: actualQty,
      price: pricePerShare || undefined,
      failedAt: 'kite',
      reason: errMsg,
      mode,
    }).catch(err => console.error('[email] kite-failed notification:', err))
  }

  return NextResponse.json({
    account,
    ...r.data,
    ...(sellQtyAdjusted ? { adjustedQty: actualQty, requestedQty: qty } : {}),
  }, { status: r.ok ? 200 : (r.status || 502) })
}
