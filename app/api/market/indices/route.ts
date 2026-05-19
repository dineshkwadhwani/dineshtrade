// GET /api/market/indices — live snapshot for the top-of-page ticker strip.
// NIFTY 50, SENSEX, INDIA VIX come from Kite's /quote (live, paid plan). GIFT
// NIFTY is sourced from the cached morning briefing because it's a pre-market
// indicator (Indian markets are open during the session, so GIFT Nifty is
// largely informational once the open happens).

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getState } from '@/lib/state'
import { resolveAccountCreds, kiteRequest } from '@/lib/kite'
import { getMarketBriefing } from '@/lib/marketBriefing'

export const dynamic = 'force-dynamic'

interface IndexQuote {
  label: string
  ltp: number | null
  changePct: number | null
  source: 'kite' | 'briefing' | 'unavailable'
}

async function firstConnectedCreds() {
  const state = await getState()
  for (const account of Object.keys(state.kiteTokens)) {
    const r = await resolveAccountCreds(account)
    if (r.ok) return { apiKey: r.apiKey, accessToken: r.accessToken }
  }
  return null
}

// Symbols Kite uses for index spot quotes. The space in "NIFTY 50" / "INDIA VIX"
// must be URL-encoded (kiteRequest -> fetch handles this since we build the URL
// query manually with encodeURIComponent in the i= params).
const INDEX_SYMBOLS = ['NSE:NIFTY 50', 'BSE:SENSEX', 'NSE:INDIA VIX'] as const

export async function GET() {
  const t = cookies().get('dt_session')?.value
  if (!t || !(await verifySession(t))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creds = await firstConnectedCreds()
  const out: Record<string, IndexQuote> = {
    nifty50: { label: 'NIFTY 50', ltp: null, changePct: null, source: 'unavailable' },
    sensex:  { label: 'SENSEX',   ltp: null, changePct: null, source: 'unavailable' },
    vix:     { label: 'INDIA VIX', ltp: null, changePct: null, source: 'unavailable' },
    giftNifty: { label: 'GIFT NIFTY', ltp: null, changePct: null, source: 'unavailable' },
  }

  // Live indices via /quote
  if (creds) {
    try {
      const query = INDEX_SYMBOLS.map(s => `i=${encodeURIComponent(s)}`).join('&')
      const r = await kiteRequest<{ data?: Record<string, any> }>(`/quote?${query}`, creds)
      const data = r.data?.data || {}
      const fill = (key: keyof typeof out, kiteKey: string) => {
        const q = data[kiteKey]
        if (!q?.last_price) return
        const ltp = Number(q.last_price)
        const prevClose = Number(q.ohlc?.close)
        const changePct = prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0
        out[key] = { label: out[key].label, ltp, changePct, source: 'kite' }
      }
      fill('nifty50', 'NSE:NIFTY 50')
      fill('sensex',  'BSE:SENSEX')
      fill('vix',     'NSE:INDIA VIX')
    } catch (err) {
      console.warn('[indices] kite /quote failed:', String(err).slice(0, 200))
    }
  }

  // GIFT NIFTY — from the cached briefing (the morning AI briefing carries it).
  // Best-effort; if briefing isn't cached yet today, leaves as unavailable.
  try {
    const briefing = await getMarketBriefing()
    if (briefing.ok) {
      const giftPct = (briefing as any).giftChangePct
      if (typeof giftPct === 'number') {
        out.giftNifty = { label: 'GIFT NIFTY', ltp: null, changePct: giftPct, source: 'briefing' }
      }
    }
  } catch { /* best-effort */ }

  return NextResponse.json({ indices: out, fetchedAt: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
