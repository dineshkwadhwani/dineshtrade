import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { getMarketBriefing } from '@/lib/marketBriefing'

// Reads the session cookie via cookies() (next/headers) on every request —
// force-dynamic makes that explicit instead of relying on Next's implicit
// dynamic-usage detection, which reportedly failed the production build on
// EC2 for a sibling route (app/api/dalgo/admin/reports/export) with the same
// underlying pattern.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = cookies().get('dt_session')?.value
  if (!token || !(await verifySession(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await getMarketBriefing()
  if (!result.ok) {
    console.error('[api/market]', result.error, result.detail?.slice(0, 200))
    return NextResponse.json({
      success: false,
      error: result.error,
      detail: result.detail,
      provider: result.provider,
    }, { status: 502 })
  }

  return NextResponse.json({
    success: true,
    data: result.data,
    generatedAt: new Date().toISOString(),
    provider: result.provider,
    model: result.model,
    mock: result.source === 'mock',
  })
}
