// Session-scoped state: mode, selected accounts, per-account daily Kite tokens.
// Phase 1: stored in a signed cookie (httpOnly).
// Phase 2 (EC2): swap the storage layer to a flat JSON file behind the same API.

import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || 'dineshtrade-secret-2026')
const COOKIE = 'dt_state'

export type TradeMode = 'auto' | 'manual'

export interface SessionState {
  mode: TradeMode
  selectedAccounts: string[]              // account names that are checked on the Engine page
  kiteTokens: Record<string, string>      // account name → today's pasted Kite access token
}

const DEFAULT_STATE: SessionState = {
  mode: 'manual',
  selectedAccounts: [],
  kiteTokens: {},
}

// Cookie expires at midnight IST — same as the auth session.
function midnightIST(): Date {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const midnight = new Date(ist)
  midnight.setDate(midnight.getDate() + 1)
  midnight.setHours(0, 0, 0, 0)
  return midnight
}

export async function getState(): Promise<SessionState> {
  const token = cookies().get(COOKIE)?.value
  if (!token) return { ...DEFAULT_STATE }
  try {
    const { payload } = await jwtVerify(token, SECRET)
    const s = payload.state as Partial<SessionState> | undefined
    return {
      mode: s?.mode === 'auto' ? 'auto' : 'manual',
      selectedAccounts: Array.isArray(s?.selectedAccounts) ? s!.selectedAccounts : [],
      kiteTokens: (s?.kiteTokens && typeof s.kiteTokens === 'object') ? s.kiteTokens : {},
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export async function saveState(patch: Partial<SessionState>): Promise<SessionState> {
  const current = await getState()
  const next: SessionState = {
    mode: patch.mode ?? current.mode,
    selectedAccounts: patch.selectedAccounts ?? current.selectedAccounts,
    kiteTokens: { ...current.kiteTokens, ...(patch.kiteTokens || {}) },
  }
  const expires = midnightIST()
  const expiresSec = Math.max(60, Math.floor((expires.getTime() - Date.now()) / 1000))
  const token = await new SignJWT({ state: next })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresSec}s`)
    .sign(SECRET)
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires,
    path: '/',
  })
  return next
}

// Drop a single account's token (e.g., when user disconnects that account in Settings).
export async function clearAccountToken(accountName: string): Promise<SessionState> {
  const current = await getState()
  const { [accountName]: _, ...rest } = current.kiteTokens
  return saveState({ kiteTokens: rest })
}

export async function clearState(): Promise<void> {
  cookies().delete(COOKIE)
}
