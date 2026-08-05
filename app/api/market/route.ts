import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { getMarketBriefing } from '@/lib/marketBriefing'

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
