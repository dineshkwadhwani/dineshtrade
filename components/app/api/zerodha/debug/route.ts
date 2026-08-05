// GET /api/zerodha/debug?account=DINESH
// Returns redacted previews of api_key + access_token, then makes 3 lightweight
// Kite test calls to pinpoint exactly which credential / permission is broken:
//   1. /user/profile         — free; validates that api_key + access_token MATCH
//   2. /portfolio/holdings   — free; validates token has portfolio scope
//   3. /quote?i=NSE:RELIANCE — paid; validates the Kite Connect plan + scope
//
// Read the response: whichever call first fails tells you exactly where to look.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getAccountSecrets, getEnvironment } from '@/lib/accounts'
import { getState } from '@/lib/state'

const KITE_BASE = 'https://api.kite.trade'

async function kiteCall(path: string, apiKey: string, accessToken: string) {
  try {
    const r = await fetch(`${KITE_BASE}${path}`, {
      headers: {
        'X-Kite-Version': '3',
        'Authorization': `token ${apiKey}:${accessToken}`,
      },
    })
    const body = await r.json().catch(() => ({}))
    return {
      status: r.status,
      ok: r.ok,
      kite_status: body?.status || null,
      kite_message: body?.message || null,
      kite_error_type: body?.error_type || null,
      data_keys: body?.data ? (Array.isArray(body.data) ? `array(${body.data.length})` : Object.keys(body.data).slice(0, 4)) : null,
    }
  } catch (e) {
    return { error: String(e).slice(0, 200) }
  }
}

export async function GET(req: Request) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const account = new URL(req.url).searchParams.get('account')
  if (!account) return NextResponse.json({ error: 'account query param required' }, { status: 400 })

  const env = getEnvironment()
  const secrets = getAccountSecrets(account)
  const state = await getState()
  const accessToken = state.kiteTokens[account]

  const apiKeyPreview = secrets ? `${secrets.apiKey.slice(0, 6)}…${secrets.apiKey.slice(-3)} (len ${secrets.apiKey.length})` : null
  const tokenPreview  = accessToken ? `${accessToken.slice(0, 6)}…${accessToken.slice(-3)} (len ${accessToken.length})` : null

  let tests: Record<string, unknown> = { skipped: 'missing creds' }
  if (secrets && accessToken) {
    tests = {
      // 1. profile is the FREE auth test. If this fails, it's purely a credential
      //    mismatch (api_key/access_token pair don't belong together).
      profile:  await kiteCall('/user/profile', secrets.apiKey, accessToken),
      // 2. holdings is free + needs portfolio scope. If profile works but this
      //    fails, your app needs portfolio permission added on the Kite developer console.
      holdings: await kiteCall('/portfolio/holdings', secrets.apiKey, accessToken),
      // 3. quote is paid. If 1+2 work but this fails (404/403), Kite Connect
      //    subscription is missing the Historical & Live Quotes addon.
      quote:    await kiteCall('/quote?i=NSE%3ARELIANCE', secrets.apiKey, accessToken),
    }
  }

  return NextResponse.json({
    environment: env,
    account,
    apiKeyPreview,
    accessTokenPreview: tokenPreview,
    accessTokenPresent: !!accessToken,
    tests,
  })
}
