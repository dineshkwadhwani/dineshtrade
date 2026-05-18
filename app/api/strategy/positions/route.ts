// GET /api/strategy/positions — returns the current Strategy 1 position registry
// (contents of data/strategy1.json). Used by the Holdings page to label each
// row as S1 (Strategy 1 managed) vs OOS (Out Of System, not auto-managed).

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { listStrategy1Positions } from '@/lib/strategy1'

export async function GET() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const positions = await listStrategy1Positions()
  return NextResponse.json({ positions })
}
