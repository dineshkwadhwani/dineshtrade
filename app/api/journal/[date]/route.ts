// GET /api/journal/[date] — returns the full DailyReport (built via
// buildDailyReport) for the given YYYY-MM-DD IST date. The Retrospective tab
// hydrates from this same payload that the EOD cron emails out.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { buildDailyReport } from '@/lib/retrospective'

const YMD = /^\d{4}-\d{2}-\d{2}$/

export async function GET(_req: Request, { params }: { params: { date: string } }) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!YMD.test(params.date)) {
    return NextResponse.json({ error: 'Date must be YYYY-MM-DD' }, { status: 400 })
  }
  try {
    const report = await buildDailyReport(params.date)
    return NextResponse.json({ report })
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 })
  }
}
