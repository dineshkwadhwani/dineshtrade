import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getAccountSecrets, isAccountConfigured } from '@/lib/accounts'

// GET /api/zerodha/login?account=DINESH
// Sets a short-lived cookie remembering which account is logging in,
// then redirects the browser to Zerodha's Kite Connect login page.
export async function GET(req: NextRequest) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  const account = req.nextUrl.searchParams.get('account')
  if (!account || !isAccountConfigured(account)) {
    return NextResponse.redirect(new URL('/settings?error=' + encodeURIComponent(`Unknown account: ${account}`), req.url))
  }
  const { apiKey } = getAccountSecrets(account)!

  const kiteUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey)}`
  const res = NextResponse.redirect(kiteUrl)
  res.cookies.set('dt_kite_pending', account, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 300, // 5 minutes — plenty for the OAuth roundtrip
    path: '/',
  })
  return res
}
