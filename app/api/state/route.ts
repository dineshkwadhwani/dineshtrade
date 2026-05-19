import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getState, saveState, clearState, SessionState } from '@/lib/state'
import { isAccountConfigured } from '@/lib/accounts'

async function requireAuth(): Promise<boolean> {
  const token = cookies().get('dt_session')?.value
  if (!token) return false
  return verifySession(token)
}

// Client-safe projection — never return Kite tokens, only which accounts have one set.
// Filters out orphaned tokens for accounts that are no longer configured in env
// (e.g. an account was commented out of .env.local but its stale token still sits
// in state.json). Without this filter, the UI thinks that account is "connected"
// and routes API calls to it, which then 403 with "Incorrect api_key or access_token".
function projectForClient(s: SessionState) {
  return {
    mode: s.mode,
    selectedAccounts: s.selectedAccounts.filter(isAccountConfigured),
    accountsWithToken: Object.keys(s.kiteTokens).filter(isAccountConfigured),
  }
}

export async function GET() {
  if (!(await requireAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const s = await getState()
  return NextResponse.json(projectForClient(s))
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const patch: Partial<SessionState> = {}
  if (body.mode === 'auto' || body.mode === 'manual') patch.mode = body.mode
  if (Array.isArray(body.selectedAccounts)) patch.selectedAccounts = body.selectedAccounts.filter((a: any) => typeof a === 'string')
  if (body.kiteTokens && typeof body.kiteTokens === 'object') {
    const tokens: Record<string, string> = {}
    for (const [k, v] of Object.entries(body.kiteTokens)) {
      if (typeof v === 'string' && v.trim()) tokens[k] = v.trim()
    }
    patch.kiteTokens = tokens
  }
  const next = await saveState(patch)
  return NextResponse.json(projectForClient(next))
}

export async function DELETE() {
  if (!(await requireAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await clearState()
  return NextResponse.json({ ok: true })
}
