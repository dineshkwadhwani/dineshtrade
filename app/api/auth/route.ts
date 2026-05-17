import { NextRequest, NextResponse } from 'next/server'
import { getExpectedPassword, createSession } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { password } = await req.json()
  const expected = getExpectedPassword()

  if (password !== expected) {
    return NextResponse.json({ error: 'Invalid access code' }, { status: 401 })
  }

  const token = await createSession()

  // Session expires at midnight IST
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const midnight = new Date(ist)
  midnight.setDate(midnight.getDate() + 1)
  midnight.setHours(0, 0, 0, 0)

  const res = NextResponse.json({ success: true })
  res.cookies.set('dt_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: midnight,
    path: '/'
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ success: true })
  res.cookies.delete('dt_session')
  return res
}
