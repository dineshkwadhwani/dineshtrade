// GET /api/journal/dates — returns the sorted list of dates we have any journal
// records for (newest first). Used by the Retrospective tab's date picker.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { listJournalDates } from '@/lib/journal'

export async function GET() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dates = await listJournalDates()
  return NextResponse.json({ dates })
}
