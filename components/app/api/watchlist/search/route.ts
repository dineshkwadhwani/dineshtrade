// GET /api/watchlist/search?q=bajaj
// Type-ahead lookup against Kite's live NSE EQ instruments dump. Returns up
// to 20 matches ranked by relevance — used by the Manage Lists UI so the user
// can type a company name and pick the exact NSE tradingsymbol.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getState } from '@/lib/state'
import { resolveAccountCreds } from '@/lib/kite'
import { searchInstruments } from '@/lib/instruments'

export const dynamic = 'force-dynamic'

async function firstConnectedCreds() {
  const state = await getState()
  for (const account of Object.keys(state.kiteTokens)) {
    const r = await resolveAccountCreds(account)
    if (r.ok) return { apiKey: r.apiKey, accessToken: r.accessToken }
  }
  return null
}

export async function GET(req: Request) {
  const t = cookies().get('dt_session')?.value
  if (!t || !(await verifySession(t))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = (new URL(req.url).searchParams.get('q') || '').trim()
  if (!q || q.length < 2) return NextResponse.json({ results: [] })

  const creds = await firstConnectedCreds()
  if (!creds) return NextResponse.json({ error: 'Connect at least one Kite account to enable search' }, { status: 400 })

  try {
    const results = await searchInstruments(creds, q, 20)
    return NextResponse.json({ results })
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 })
  }
}
