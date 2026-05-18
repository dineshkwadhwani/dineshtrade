import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getAccountSecrets, isAccountConfigured } from '@/lib/accounts'
import { saveState, clearAccountToken, getState } from '@/lib/state'

async function authed(): Promise<boolean> {
  const session = cookies().get('dt_session')?.value
  if (!session) return false
  return verifySession(session)
}

// Validate a Kite access token by hitting /user/profile. Returns null on success,
// or a short error message on failure.
async function validateKiteToken(apiKey: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.kite.trade/user/profile', {
      headers: { Authorization: `token ${apiKey}:${accessToken}`, 'X-Kite-Version': '3' },
    })
    if (res.ok) return null
    const body = await res.text()
    return `Kite ${res.status}: ${body.slice(0, 200)}`
  } catch (e) {
    return `Network error: ${String(e).slice(0, 200)}`
  }
}

// POST { account, accessToken } — validate via Kite, then save to session state.
export async function POST(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { account, accessToken } = await req.json().catch(() => ({}))
  if (typeof account !== 'string' || !account) {
    return NextResponse.json({ error: 'account is required' }, { status: 400 })
  }
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    return NextResponse.json({ error: 'accessToken is required' }, { status: 400 })
  }
  if (!isAccountConfigured(account)) {
    return NextResponse.json({ error: `Unknown account: ${account}` }, { status: 400 })
  }

  const { apiKey } = getAccountSecrets(account)!
  const validateErr = await validateKiteToken(apiKey, accessToken.trim())
  if (validateErr) {
    return NextResponse.json({ error: 'Token validation failed', detail: validateErr }, { status: 400 })
  }

  await saveState({ kiteTokens: { [account]: accessToken.trim() } })
  return NextResponse.json({ success: true, account })
}

// DELETE ?account=X — disconnect that one account.
export async function DELETE(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const account = req.nextUrl.searchParams.get('account')
  if (!account) return NextResponse.json({ error: 'account query param required' }, { status: 400 })
  await clearAccountToken(account)
  return NextResponse.json({ success: true, account })
}

// GET — returns the set of accounts with a saved token. Convenience for the Settings page.
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const s = await getState()
  return NextResponse.json({ connected: Object.keys(s.kiteTokens) })
}
