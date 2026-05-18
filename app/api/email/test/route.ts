// POST /api/email/test → fires a one-off test email. Auth required.
// Use this once after setting SMTP env vars to confirm SMTP wiring works.
// Returns { ok, error?, skipped? }.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { sendTestEmail, isEmailConfigured } from '@/lib/email'

export async function POST() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS in .env.local',
    }, { status: 400 })
  }
  const result = await sendTestEmail()
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}

export async function GET() {
  // Surface config status (no secrets returned)
  return NextResponse.json({
    configured: isEmailConfigured(),
    notifyTo: process.env.NOTIFY_TO || process.env.SMTP_USER || null,
  })
}
