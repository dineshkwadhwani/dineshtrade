// POST /api/dalgo/customer/engine/order
// Places a manual BUY order for the logged-in customer using their broker
// credentials from Supabase. Runs preflight with manual=true (skips quota/
// idempotency/no-loss gates; still checks token, market, funds, no-short).

import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { loadBrokerAccountCreds, placeKiteOrder } from '@/lib/kite'
import { getBroker } from '@/lib/broker'
import { runPreflight, markPlaced } from '@/lib/preflight'
import { withCustomer } from '@/lib/supabase'
import { saveState } from '@/lib/state'
import { rehydrateForCustomer } from '@/lib/strategyConfigStore'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (profile.role === 'customer' && profile.status !== 'active') return NextResponse.json({ error: 'Account not active.' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const { symbol, quantity, price, strategyId, target1, target2, reason, source, tag } = body
    const side: 'BUY' | 'SELL' = body.side === 'SELL' ? 'SELL' : 'BUY'

    // SA/AM can place orders on behalf of a customer
    const isPrivileged = profile.role === 'superadmin' || profile.role === 'account_manager'
    const targetCustomerId: string = isPrivileged && typeof body.targetCustomerId === 'string'
      ? body.targetCustomerId
      : profile.id

    if (!symbol || !quantity || !price) {
      return NextResponse.json({ error: 'symbol, quantity and price are required.' }, { status: 400 })
    }

    const symbolUpper = String(symbol).toUpperCase()
    const qty = Number(quantity)
    const pricePerShare = Number(price)

    // Customer's Kite credentials (for order placement)
    const creds = await loadBrokerAccountCreds(targetCustomerId)
    if (!creds) {
      return NextResponse.json({ error: 'Kite not connected. Please reconnect in Settings.' }, { status: 400 })
    }

    const env = process.env.ZERODHA_ENVIRONMENT === 'PROD' ? 'PROD' : 'TEST'
    const primaryAccountName = process.env[`${env}_ZERODHA_ACCOUNT1`] || 'DINESH'

    const broker = getBroker({
      brokerName: 'zerodha',
      brokerCredentials: { apiKey: creds.apiKey, accessToken: creds.accessToken },
    })

    let preflightResult: Awaited<ReturnType<typeof runPreflight>>

    // Run preflight within customer context so getState().kiteTokens is populated
    await withCustomer(targetCustomerId, async () => {
      await saveState({ kiteTokens: { [primaryAccountName]: creds.accessToken } })
      await rehydrateForCustomer()
      preflightResult = await runPreflight({
        account: primaryAccountName,
        symbol: symbolUpper,
        side,
        quantity: qty,
        pricePerShare,
        strategyId: strategyId ?? undefined,
        manual: true,
      }, broker)
    })

    const pre = preflightResult!
    if (!pre.ok) {
      sendEmail('trade_failed', {
        account: primaryAccountName,
        accountDisplayName: profile.full_name,
        symbol: symbolUpper,
        side,
        quantity: qty,
        price: pricePerShare,
        failedAt: 'preflight',
        gate: pre.gate,
        reason: pre.reason ?? 'Unknown',
        mode: 'manual',
      }).catch(() => {})
      return NextResponse.json({ error: 'Preflight failed', gate: pre.gate, reason: pre.reason }, { status: 422 })
    }

    // Place order via Kite
    const orderResult = await placeKiteOrder(creds, {
      symbol: symbolUpper,
      side,
      quantity: pre.adjustedQty ?? qty,
      tag: tag ?? (strategyId ? `dt-${strategyId}` : 'dt-manual'),
      product: 'CNC',
      orderType: 'MARKET',
    })

    if (!orderResult.ok) {
      const errMsg = orderResult.data?.message || `Kite HTTP ${orderResult.status}`
      return NextResponse.json({ error: errMsg }, { status: 502 })
    }

    const orderId = orderResult.data?.data?.order_id
    // Mark idempotency in customer's state so auto-mode won't double-buy today
    if (orderId && side === 'BUY') {
      await withCustomer(targetCustomerId, async () => {
        await saveState({ kiteTokens: { [primaryAccountName]: creds.accessToken } })
        await markPlaced(primaryAccountName, symbolUpper, 'BUY', { price: pricePerShare, manual: true })
      }).catch(() => {})
    }

    // Notify on success
    sendEmail('trade_executed', {
      account: primaryAccountName,
      accountDisplayName: profile.full_name,
      symbol: symbolUpper,
      symbolName: symbolUpper,
      side,
      quantity: pre.adjustedQty ?? qty,
      price: pricePerShare,
      orderId: orderId ?? '',
      target1: target1 ?? undefined,
      target2: target2 ?? undefined,
      source: source ?? 'Manual Execute',
      reason: reason ?? undefined,
    }).catch(() => {})

    return NextResponse.json({ ok: true, orderId })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[engine/order] error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
