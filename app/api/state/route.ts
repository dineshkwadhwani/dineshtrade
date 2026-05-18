import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getState, saveState, clearState, SessionState } from '@/lib/state'

async function requireAuth(): Promise<boolean> {
  const token = cookies().get('dt_session')?.value
  if (!token) return false
  return verifySession(token)
}

// Client-safe projection — never return Kite tokens, only which accounts have one set.
function projectForClient(s: SessionState) {
  return {
    mode: s.mode,
    selectedAccounts: s.selectedAccounts,
    accountsWithToken: Object.keys(s.kiteTokens),
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
