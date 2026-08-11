// GET /api/dalgo/customer/daily-briefing
// Returns today's market briefing (global indices, GIFT Nifty, India outlook,
// broker tips). Behaviour:
//   1. DB hit first — return cached AI row for today if it exists.
//   2. Before 08:30 IST (and no force): call AI anyway; if AI succeeds cache + return,
//      if AI fails return mock data (always visible, never cached).
//   3. force=true: bypass DB + in-memory cache, re-fetch from AI, overwrite DB on success.
//
// AI results are stored in platform_daily_briefing so subsequent loads are instant.
// Mock/fallback results are NEVER stored — next load retries AI.
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
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'

  // Return cached AI row immediately (skip on force-refresh)
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

  // Fetch from AI (clear in-memory cache on force)
  if (force) clearMarketBriefingCache()
  let result
  try {
    result = await getMarketBriefing()
  } catch {
    // AI threw — return mock so world indices are always visible
    return NextResponse.json({ data: MOCK_MARKET_DATA, source: 'mock', date: today })
  }

  if (result.ok && result.source === 'ai' && result.data) {
    // Cache real AI data so subsequent loads are instant
    await admin.from('platform_daily_briefing').upsert(
      { date_ist: today, data: result.data, source: 'ai' },
      { onConflict: 'date_ist' },
    )
    return NextResponse.json({ data: result.data, source: 'ai', date: today })
  }

  // AI unavailable — return mock so world indices are always visible (not cached)
  return NextResponse.json({ data: result.data ?? MOCK_MARKET_DATA, source: 'mock', date: today })
}
