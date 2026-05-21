// Session-scoped state: mode, selected accounts, per-account daily Kite tokens.
// Two pluggable backends behind the same API:
//   - cookie (default) — signed JWT cookie via next/headers. Works only inside
//     route handlers / server components. Used in local dev.
//   - file — flat JSON on disk at STATE_FILE_PATH. Required for the node-cron
//     job which runs outside any request context. Used on EC2.
//
// Pick backend via env: set STATE_FILE_PATH=/abs/path/state.json to enable file.
// Otherwise the cookie backend is used.

import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { promises as fs } from 'fs'
import * as path from 'path'
import { getAccountList, isAccountConfigured } from './accounts'

const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || 'dineshtrade-secret-2026')
const COOKIE = 'dt_state'

const FILE_PATH = process.env.STATE_FILE_PATH || ''
const useFile = !!FILE_PATH

export type TradeMode = 'auto' | 'manual'

// Idempotency ledger — persisted to state.json so it survives PM2 restarts and
// is shared across every code path that checks it (cron tick, manual order
// route, both strategy monitors). Key shape: `${ACCOUNT}:${YYYY-MM-DD}:${SYMBOL}:${SIDE}`
// → true. All keys uppercased so ITC and itc map to the same entry. Old days
// are pruned on read (see normalize()).
export type IdempotencyLedger = Record<string, true>

// Per-account-symbol BUY history used by the pyramid gate. Records every
// successful auto BUY price so subsequent BUYs can enforce the "next BUY
// must be ≥10% below previous BUY" rule. Entries are cleared at the start
// of each preflight when Kite reports zero qty for that symbol — meaning the
// previous position has been fully exited and pyramiding starts fresh.
export interface BuyHistoryEntry {
  price: number
  ts: string                    // ISO timestamp of the BUY
}
export type BuyHistoryLedger = Record<string, BuyHistoryEntry[]>

// Per-day panic-sell skip list. Once a symbol fires the panic-sell gate today,
// it stays on the skip list until the IST date rolls over. Persisted so a PM2
// restart mid-day doesn't lose the morning's panic detections.
// Shape: { 'YYYY-MM-DD': ['ITC', 'RELIANCE'] }
export type PanicSkipLedger = Record<string, string[]>

export interface SessionState {
  mode: TradeMode
  selectedAccounts: string[]
  kiteTokens: Record<string, string>
  idempotencyLedger: IdempotencyLedger
  buyHistory: BuyHistoryLedger
  panicSkipList: PanicSkipLedger
}

const DEFAULT_STATE: SessionState = {
  mode: 'manual',
  selectedAccounts: [],
  kiteTokens: {},
  idempotencyLedger: {},
  buyHistory: {},
  panicSkipList: {},
}

function istDateKey(): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${ist.getFullYear()}-${String(ist.getMonth()+1).padStart(2,'0')}-${String(ist.getDate()).padStart(2,'0')}`
}

function midnightIST(): Date {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const midnight = new Date(ist)
  midnight.setDate(midnight.getDate() + 1)
  midnight.setHours(0, 0, 0, 0)
  return midnight
}

function normalize(raw: Partial<SessionState> | null | undefined): SessionState {
  if (!raw) return { ...DEFAULT_STATE, kiteTokens: {}, idempotencyLedger: {}, buyHistory: {}, panicSkipList: {} }
  // Prune any ledger entries whose date prefix isn't today — old days never need to be remembered
  const today = istDateKey()
  const cleanedLedger: IdempotencyLedger = {}
  const rawLedger = (raw.idempotencyLedger && typeof raw.idempotencyLedger === 'object') ? raw.idempotencyLedger : {}
  for (const key of Object.keys(rawLedger)) {
    // key format: ACCOUNT:DATE:SYMBOL:SIDE
    const parts = key.split(':')
    if (parts.length === 4 && parts[1] === today) cleanedLedger[key] = true
  }
  // Prune panic-skip dates other than today — sticky for the day, gone tomorrow.
  const cleanedPanic: PanicSkipLedger = {}
  const rawPanic = (raw.panicSkipList && typeof raw.panicSkipList === 'object') ? raw.panicSkipList as PanicSkipLedger : {}
  if (Array.isArray(rawPanic[today])) cleanedPanic[today] = rawPanic[today]

  // Prune kiteTokens for accounts not configured in the current ZERODHA_ENVIRONMENT.
  // Tokens get persisted on successful OAuth; if you later switch environments
  // (e.g. PROD → TEST) the env may no longer have that account's secrets, leaving
  // a stale token in state.json that downstream callers waste cycles on.
  // Only prune if the env actually exposes a non-empty account list — defensive
  // against transient env-load issues that would otherwise wipe everything.
  const rawTokens = (raw.kiteTokens && typeof raw.kiteTokens === 'object') ? raw.kiteTokens : {}
  let cleanedTokens: Record<string, string> = rawTokens
  try {
    const configured = getAccountList()
    if (configured.length > 0) {
      cleanedTokens = {}
      for (const [acc, tok] of Object.entries(rawTokens)) {
        if (isAccountConfigured(acc)) {
          cleanedTokens[acc] = tok
        } else {
          console.warn(`[state] pruning stale Kite token for "${acc}" — not configured in current ZERODHA_ENVIRONMENT`)
        }
      }
    }
  } catch { /* env not loaded yet; keep tokens as-is */ }

  return {
    mode: raw.mode === 'auto' ? 'auto' : 'manual',
    selectedAccounts: Array.isArray(raw.selectedAccounts) ? raw.selectedAccounts : [],
    kiteTokens: cleanedTokens,
    idempotencyLedger: cleanedLedger,
    buyHistory: (raw.buyHistory && typeof raw.buyHistory === 'object') ? raw.buyHistory as BuyHistoryLedger : {},
    panicSkipList: cleanedPanic,
  }
}

// ──────── FILE BACKEND ────────

// One-shot guard so the stale-token migration write happens at most once per
// process, even if many readFile() calls race in parallel.
let migrationWriteInFlight = false

async function readFile(): Promise<SessionState> {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SessionState>
    const cleaned = normalize(parsed)
    // If normalize() dropped one or more kiteTokens entries (stale tokens for
    // accounts that aren't configured in the current ZERODHA_ENVIRONMENT),
    // persist the cleaned state back to disk so subsequent reads stop firing
    // the prune log. Fire-and-forget — never block the caller on the write.
    const rawTokenCount = Object.keys((parsed?.kiteTokens && typeof parsed.kiteTokens === 'object') ? parsed.kiteTokens : {}).length
    if (rawTokenCount !== Object.keys(cleaned.kiteTokens).length && !migrationWriteInFlight) {
      migrationWriteInFlight = true
      writeFile(cleaned)
        .then(() => console.log('[state] cleaned-state migration persisted to disk'))
        .catch(err => {
          console.warn('[state] cleaned-state migration write failed:', String(err).slice(0, 200))
          migrationWriteInFlight = false   // allow retry on next read
        })
    }
    return cleaned
  } catch {
    return normalize(null)
  }
}

async function writeFile(state: SessionState): Promise<void> {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true })
  const tmp = FILE_PATH + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, FILE_PATH)
}

async function deleteFile(): Promise<void> {
  try { await fs.unlink(FILE_PATH) } catch {}
}

// ──────── COOKIE BACKEND ────────

async function readCookie(): Promise<SessionState> {
  const token = cookies().get(COOKIE)?.value
  if (!token) return normalize(null)
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return normalize(payload.state as Partial<SessionState>)
  } catch {
    return normalize(null)
  }
}

async function writeCookie(state: SessionState): Promise<void> {
  const expires = midnightIST()
  const expiresSec = Math.max(60, Math.floor((expires.getTime() - Date.now()) / 1000))
  const token = await new SignJWT({ state })
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
}

async function deleteCookie(): Promise<void> {
  cookies().delete(COOKIE)
}

// ──────── PUBLIC API ────────

export async function getState(): Promise<SessionState> {
  return useFile ? readFile() : readCookie()
}

export async function saveState(patch: Partial<SessionState>): Promise<SessionState> {
  const current = await getState()
  const next: SessionState = {
    mode: patch.mode ?? current.mode,
    selectedAccounts: patch.selectedAccounts ?? current.selectedAccounts,
    kiteTokens: { ...current.kiteTokens, ...(patch.kiteTokens || {}) },
    idempotencyLedger: { ...current.idempotencyLedger, ...(patch.idempotencyLedger || {}) },
    buyHistory: patch.buyHistory ?? current.buyHistory,
    panicSkipList: patch.panicSkipList ?? current.panicSkipList,
  }
  if (useFile) await writeFile(next)
  else await writeCookie(next)
  return next
}

// Atomic, additive ledger write. Uppercases everything defensively so callers
// passing 'itc' or 'ITC' end up with the same persisted key. Returns the new
// state so callers can observe the post-write ledger if they need to.
export async function recordIdempotency(account: string, symbol: string, side: 'BUY' | 'SELL'): Promise<SessionState> {
  const key = `${account.toUpperCase()}:${istDateKey()}:${symbol.toUpperCase()}:${side}`
  return saveState({ idempotencyLedger: { [key]: true } })
}

export function makeIdempotencyKey(account: string, symbol: string, side: 'BUY' | 'SELL'): string {
  return `${account.toUpperCase()}:${istDateKey()}:${symbol.toUpperCase()}:${side}`
}

function buyHistoryKey(account: string, symbol: string): string {
  return `${account.toUpperCase()}:${symbol.toUpperCase()}`
}

// Append a successful BUY price to the per-symbol history (pyramid gate).
// Called from markPlaced on BUY success in auto-mode paths.
export async function recordBuyHistory(account: string, symbol: string, price: number): Promise<void> {
  const current = await getState()
  const key = buyHistoryKey(account, symbol)
  const entries = current.buyHistory[key] || []
  const next = { ...current.buyHistory, [key]: [...entries, { price, ts: new Date().toISOString() }] }
  await saveState({ buyHistory: next })
}

// Reset buy history for a symbol — called when Kite reports zero qty (the
// position has been fully exited) so the next BUY starts a fresh pyramid.
export async function resetBuyHistoryForSymbol(account: string, symbol: string): Promise<void> {
  const current = await getState()
  const key = buyHistoryKey(account, symbol)
  if (!(key in current.buyHistory)) return
  const next = { ...current.buyHistory }
  delete next[key]
  await saveState({ buyHistory: next })
}

export function getBuyHistory(state: SessionState, account: string, symbol: string): BuyHistoryEntry[] {
  return state.buyHistory[buyHistoryKey(account, symbol)] || []
}

// ──────── PANIC-SELL SKIP LIST ────────
// Symbol-level, market-wide (not per-account) — a stock in panic is in panic for
// every account. Sticky for the calendar day; cleared at start of new IST day by
// normalize()'s prune step.

export async function addPanicSkip(symbol: string): Promise<void> {
  const sym = symbol.toUpperCase()
  const today = istDateKey()
  const current = await getState()
  const todays = current.panicSkipList[today] || []
  if (todays.includes(sym)) return                      // already on the list
  const next: PanicSkipLedger = { ...current.panicSkipList, [today]: [...todays, sym] }
  await saveState({ panicSkipList: next })
}

export function isPanicSkipped(state: SessionState, symbol: string): boolean {
  const today = istDateKey()
  const todays = state.panicSkipList[today] || []
  return todays.includes(symbol.toUpperCase())
}

export function listPanicSkips(state: SessionState): string[] {
  const today = istDateKey()
  return state.panicSkipList[today] || []
}

// Replace whole state. Used when removing a token (saveState merges, which would
// keep the deleted key). Caller must pass full SessionState.
async function replaceState(next: SessionState): Promise<SessionState> {
  if (useFile) await writeFile(next)
  else await writeCookie(next)
  return next
}

export async function clearAccountToken(accountName: string): Promise<SessionState> {
  const current = await getState()
  if (!(accountName in current.kiteTokens)) return current
  const { [accountName]: _, ...rest } = current.kiteTokens
  return replaceState({ ...current, kiteTokens: rest })
}

export async function clearState(): Promise<void> {
  if (useFile) await deleteFile()
  else await deleteCookie()
}

// Diagnostic info — surface in /api/state if helpful.
export function getBackendInfo(): { backend: 'file' | 'cookie'; path: string | null } {
  return { backend: useFile ? 'file' : 'cookie', path: useFile ? FILE_PATH : null }
}
