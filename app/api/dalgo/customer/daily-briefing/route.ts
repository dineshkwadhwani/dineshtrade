// GET /api/dalgo/customer/daily-briefing
// Returns today's market briefing (global indices, GIFT Nifty, India outlook,
// broker tips) from the platform_daily_briefing table.
//
// If no row exists for today (IST date) and current IST time is >= 08:30,
// fetches fresh data from AI via getMarketBriefing(), stores it on success
// (real AI data only — mock/fallback data is NOT persisted so the section
// stays hidden on days the AI is unavailable), then returns it.
//
// Returns { data: null } when data is unavailable for any reason.
// Requires dalgo_access_token (prevents unauthenticated AI spend).

import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getMarketBriefing, clearMarketBriefingCache } from '@/lib/marketBriefing'

export const dynamic = 'force-dynamic'

function istDateKey(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function istHourMinute(): { h: number; m: number } {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return { h: d.getHours(), m: d.getMinutes() }
}

export async function GET(req: Request) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const today = istDateKey()
  const url = new URL(req.url)
  const peek  = url.searchParams.get('peek')  === 'true'
  const force = url.searchParams.get('force') === 'true'

  // Skip DB lookup on force-refresh; otherwise return cached row if it exists
  if (!force) {
    const { data: existing } = await admin
      .from('platform_daily_briefing')
      .select('data, source')
      .eq('date_ist', today)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ data: existing.data, source: existing.source, date: today })
    }
  }

  // peek=true — privileged callers just want to know if data exists; skip AI trigger
  if (peek) {
    return NextResponse.json({ data: null, reason: 'not_fetched_yet' })
  }

  // Not yet stored — check 08:30 IST gate
  const { h, m } = istHourMinute()
  if (h < 8 || (h === 8 && m < 30)) {
    return NextResponse.json({ data: null, reason: 'before_830' })
  }

  // Fetch from AI (clear in-memory cache on force so the AI is actually called)
  if (force) clearMarketBriefingCache()
  let result
  try {
    result = await getMarketBriefing()
  } catch {
    return NextResponse.json({ data: null, reason: 'ai_error' })
  }

  // Only persist genuine AI results — mock/fallback is not stored
  if (!result.ok || result.source !== 'ai' || !result.data) {
    return NextResponse.json({ data: null, reason: 'ai_unavailable' })
  }

  await admin.from('platform_daily_briefing').upsert(
    { date_ist: today, data: result.data, source: 'ai' },
    { onConflict: 'date_ist' },
  )

  return NextResponse.json({ data: result.data, source: 'ai', date: today })
}
