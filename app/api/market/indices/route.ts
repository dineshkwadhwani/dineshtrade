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

// Core indices (mobile + desktop) and extended set (desktop only).
// Kite index symbols use spaces — encodeURIComponent handles them in the query.
const CORE_SYMBOLS = [
  'NSE:NIFTY 50',
  'BSE:SENSEX',
] as const

const EXTENDED_SYMBOLS = [
  'NSE:INDIA VIX',
  'NSE:NIFTY BANK',
  'NSE:NIFTY AUTO',
  'NSE:NIFTY FIN SERVICE',
  'NSE:NIFTY IT',
  'NSE:NIFTY 100',
  'NSE:NIFTY INFRA',
] as const

const ALL_SYMBOLS = [...CORE_SYMBOLS, ...EXTENDED_SYMBOLS]

export async function GET() {
  const t = cookies().get('dt_session')?.value
  if (!t || !(await verifySession(t))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creds = await firstConnectedCreds()
  const out: Record<string, IndexQuote> = {
    nifty50:     { label: 'NIFTY 50',     ltp: null, changePct: null, source: 'unavailable' },
    sensex:      { label: 'SENSEX',        ltp: null, changePct: null, source: 'unavailable' },
    vix:         { label: 'INDIA VIX',    ltp: null, changePct: null, source: 'unavailable' },
    niftyBank:   { label: 'NIFTY BANK',   ltp: null, changePct: null, source: 'unavailable' },
    niftyAuto:   { label: 'NIFTY AUTO',   ltp: null, changePct: null, source: 'unavailable' },
    niftyFin:    { label: 'NIFTY FIN SVC',ltp: null, changePct: null, source: 'unavailable' },
    niftyIT:     { label: 'NIFTY IT',     ltp: null, changePct: null, source: 'unavailable' },
    nifty100:    { label: 'NIFTY 100',    ltp: null, changePct: null, source: 'unavailable' },
    niftyInfra:  { label: 'NIFTY INFRA',  ltp: null, changePct: null, source: 'unavailable' },
    giftNifty:   { label: 'GIFT NIFTY',   ltp: null, changePct: null, source: 'unavailable' },
  }

  // Live indices via /quote
  if (creds) {
    try {
      const query = ALL_SYMBOLS.map(s => `i=${encodeURIComponent(s)}`).join('&')
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
      fill('nifty50',    'NSE:NIFTY 50')
      fill('sensex',     'BSE:SENSEX')
      fill('vix',        'NSE:INDIA VIX')
      fill('niftyBank',  'NSE:NIFTY BANK')
      fill('niftyAuto',  'NSE:NIFTY AUTO')
      fill('niftyFin',   'NSE:NIFTY FIN SERVICE')
      fill('niftyIT',    'NSE:NIFTY IT')
      fill('nifty100',   'NSE:NIFTY 100')
      fill('niftyInfra', 'NSE:NIFTY INFRA')
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
