// GET /api/audit?date=YYYY-MM-DD — returns audit_log rows for the IST date

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const YMD = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const date = url.searchParams.get('date')
  if (!date || !YMD.test(date)) {
    return NextResponse.json({ error: 'Date must be YYYY-MM-DD' }, { status: 400 })
  }

  try {
    // IST day window: 00:00:00+05:30 to next day
    const start = new Date(date + 'T00:00:00+05:30').toISOString()
    const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString()
    const admin = getSupabaseAdmin()
    const { data } = await admin
      .from('audit_log')
      .select('*')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: true })
    return NextResponse.json({ events: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 })
  }
}
