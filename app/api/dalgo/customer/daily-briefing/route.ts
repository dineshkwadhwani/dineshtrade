// GET /api/dalgo/customer/daily-briefing
// Fetches the daily market briefing EXACTLY ONCE per calendar day (IST).
// On the first call of the day the AI is invoked; the result (real or mock
// fallback) is stored in platform_daily_briefing and served from there for
// every subsequent call — no AI spend for the rest of the day regardless of
// how many times the page loads or the server restarts.
//
// force=true (SA/AM Refresh button): clears both the DB row and the in-memory
// cache, then re-invokes AI. Use this to pull fresh real data mid-day.
//
// Requires dalgo_access_token.

import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getMarketBriefing, clearMarketBriefingCache } from '@/lib/marketBriefing'
import { MOCK_MARKET_DATA } from '@/lib/marketMock'

export const dynamic = 'force-dynamic'

function istDateKey(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function GET(req: Request) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const today = istDateKey()
  const force = new URL(req.url).searchParams.get('force') === 'true'
  const privileged = new URL(req.url).searchParams.get('privileged') === 'true'

  // Serve from DB — covers every load after the first (zero AI spend)
  if (!force) {
    const { data: existing } = await admin
      .from('platform_daily_briefing')
      .select('data, source, error')
      .eq('date_ist', today)
      .maybeSingle()

    if (existing) {
      const response: any = { data: existing.data, source: existing.source, date: today }
      if (privileged && existing.error) response.error = existing.error
      return NextResponse.json(response)
    }
  }

  // First call of the day (or force-refresh) — invoke AI
  if (force) clearMarketBriefingCache()
  let result
  let errorMessage: string | null = null
  try {
    result = await getMarketBriefing()
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e)
    result = { ok: true as const, data: MOCK_MARKET_DATA, source: 'mock' as const, provider: undefined, model: undefined, webSearchUsed: false }
  }

  const data   = (result.ok && result.data) ? result.data : MOCK_MARKET_DATA
  const source = (result.ok && result.source === 'ai') ? 'ai' : 'mock'

  // Persist result (AI or mock) — subsequent loads skip AI entirely
  await admin.from('platform_daily_briefing').upsert(
    { date_ist: today, data, source, error: errorMessage },
    { onConflict: 'date_ist' },
  )

  // Clean up old records — keep only today's briefing
  await admin
    .from('platform_daily_briefing')
    .delete()
    .neq('date_ist', today)

  const response: any = { data, source, date: today }
  if (privileged && errorMessage) response.error = errorMessage
  return NextResponse.json(response)
}
