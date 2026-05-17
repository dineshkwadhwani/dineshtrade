import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'
import { cookies } from 'next/headers'

const TOKEN_COOKIE = 'dt_zerodha_token'

// POST — save token from Settings page
export async function POST(req: NextRequest) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { accessToken } = await req.json()
  if (!accessToken?.trim()) {
    return NextResponse.json({ error: 'Token is empty' }, { status: 400 })
  }
  // Expires at midnight IST — same as the main session
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const midnight = new Date(ist)
  midnight.setDate(midnight.getDate() + 1)
  midnight.setHours(0, 0, 0, 0)

  const res = NextResponse.json({ success: true, message: 'Zerodha connected' })
  res.cookies.set(TOKEN_COOKIE, accessToken.trim(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: midnight,
    path: '/'
  })
  return res
}

// GET — check connection status only (never expose the token itself)
export async function GET() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = cookies().get(TOKEN_COOKIE)?.value
  return NextResponse.json({ connected: !!(token?.length) })
}

// DELETE — disconnect / clear token
export async function DELETE() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const res = NextResponse.json({ success: true })
  res.cookies.delete(TOKEN_COOKIE)
  return res
}
