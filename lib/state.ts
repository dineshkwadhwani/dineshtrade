// Customer-scoped trading state — Supabase-backed (`customer_state`, one row
// per customer_id). Ported from the file/cookie-backed session store in
// Phase 4 of the multi-tenant refactor; see docs/DALGO_REFACTOR_SPEC_v2.md
// §16 Phase 4.
//
// Supabase replaces BOTH of the old backends (file, for the cron process;
// signed cookie, for request handlers with no cron context) with a single
// source of truth shared across every context for this customer — which is
// actually more correct for multi-tenant than the old split ever was.
//
// `mode` maps directly onto the `cron_mode` column. `selectedAccounts` and
// `kiteTokens` are legacy V1 multi-account fields (DINESH/KIRAN/SHEELA/SONIA
// in one process) with no dedicated column in the v2 schema — they're
// persisted verbatim in the `session_meta` jsonb column added by
// scripts/migrations/2026-08-09-phase4-schema-extensions.sql. Retiring them
// in favour of broker_accounts.access_token_enc is later-phase work.

import { getSupabaseAdmin, getCustomerId } from './supabase'
import { getAccountList, isAccountConfigured } from './accounts'

export type TradeMode = 'auto' | 'manual'

// Idempotency ledger — persisted to customer_state so it survives PM2
// restarts and is shared across every code path that checks it (cron tick,
// manual order route, both strategy monitors). Key shape:
// `${ACCOUNT}:${YYYY-MM-DD}:${SYMBOL}:${SIDE}` → true. All keys uppercased
// so ITC and itc map to the same entry. Old days are pruned on read (see
// normalize()).
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

// V2 account keys are the customer's Supabase profile id (a uuid) — distinguishes
// them from legacy V1 env-named accounts like "DINESH" for the token-pruning check.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value: string): boolean {
  return UUID_RE.test(value)
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

  // Prune kiteTokens for legacy V1 env-named accounts (e.g. "DINESH") that are
  // no longer configured in the current ZERODHA_ENVIRONMENT. Tokens get
  // persisted on successful OAuth; if you later switch environments (e.g.
  // PROD → TEST) the env may no longer have that account's secrets, leaving
  // a stale token in customer_state that downstream callers waste cycles on.
  //
  // V2 accounts are keyed by customer UUID and have their tokens validated
  // against `broker_accounts` (Supabase), not env vars — `ZERODHA_ACCOUNTn`
  // is deprecated for these and must never be used to decide their validity.
  // Pruning a UUID-keyed token here would silently and permanently discard a
  // valid, freshly-reconnected token every time state is read (it did for
  // real accounts before this fix), so UUID-shaped keys are always kept.
  const rawTokens = (raw.kiteTokens && typeof raw.kiteTokens === 'object') ? raw.kiteTokens : {}
  let cleanedTokens: Record<string, string> = rawTokens
  try {
    const configured = getAccountList()
    if (configured.length > 0) {
      cleanedTokens = {}
      for (const [acc, tok] of Object.entries(rawTokens)) {
        if (isUuid(acc) || isAccountConfigured(acc)) {
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

// ──────── SUPABASE BACKEND ────────

function rowToRawState(row: any): Partial<SessionState> {
  if (!row) return {}
  const meta = (row.session_meta && typeof row.session_meta === 'object') ? row.session_meta : {}
  return {
    mode: row.cron_mode === 'auto' ? 'auto' : 'manual',
    selectedAccounts: Array.isArray(meta.selectedAccounts) ? meta.selectedAccounts : [],
    kiteTokens: (meta.kiteTokens && typeof meta.kiteTokens === 'object') ? meta.kiteTokens : {},
    idempotencyLedger: (row.idempotency_ledger && typeof row.idempotency_ledger === 'object') ? row.idempotency_ledger : {},
    buyHistory: (row.buy_history && typeof row.buy_history === 'object') ? row.buy_history : {},
    panicSkipList: (row.panic_skip_list && typeof row.panic_skip_list === 'object') ? row.panic_skip_list : {},
  }
}

async function fetchRow(): Promise<any | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('customer_state')
    .select('*')
    .eq('customer_id', getCustomerId())
    .maybeSingle()
  if (error) throw new Error(`[state] read failed: ${error.message}`)
  return data
}

async function writeRow(state: SessionState): Promise<void> {
  const admin = getSupabaseAdmin()
  const row = {
    customer_id: getCustomerId(),
    cron_mode: state.mode,
    idempotency_ledger: state.idempotencyLedger,
    buy_history: state.buyHistory,
    panic_skip_list: state.panicSkipList,
    session_meta: { selectedAccounts: state.selectedAccounts, kiteTokens: state.kiteTokens },
    updated_at: new Date().toISOString(),
  }
  const { error } = await admin.from('customer_state').upsert(row, { onConflict: 'customer_id' })
  if (error) throw new Error(`[state] write failed: ${error.message}`)
}

// One-shot-per-process guard so the stale-token migration write happens at
// most once at a time, even if many getState() calls race in parallel.
let tokenPruneWriteInFlight = false

// ──────── PUBLIC API ────────

export async function getState(): Promise<SessionState> {
  const row = await fetchRow()
  const raw = rowToRawState(row)
  const cleaned = normalize(raw)
  // If normalize() dropped one or more kiteTokens entries (stale tokens for
  // accounts that aren't configured in the current ZERODHA_ENVIRONMENT),
  // persist the cleaned state back to Supabase so subsequent reads stop
  // firing the prune log. Fire-and-forget — never block the caller on the write.
  const rawTokenCount = Object.keys(raw.kiteTokens || {}).length
  if (rawTokenCount !== Object.keys(cleaned.kiteTokens).length && !tokenPruneWriteInFlight) {
    tokenPruneWriteInFlight = true
    writeRow(cleaned)
      .then(() => console.log('[state] cleaned-state migration persisted to Supabase'))
      .catch(err => {
        console.warn('[state] cleaned-state migration write failed:', String(err).slice(0, 200))
        tokenPruneWriteInFlight = false   // allow retry on next read
      })
  }
  return cleaned
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
  await writeRow(next)
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

// Replace buy history for a symbol with an explicit sequence. Used by
// reconciliation/sync paths to keep pyramid history aligned with the tagged
// open-position cycle.
export async function setBuyHistoryForSymbol(
  account: string,
  symbol: string,
  entries: Array<{ price: number; ts?: string }>,
): Promise<void> {
  const current = await getState()
  const key = buyHistoryKey(account, symbol)
  const cleaned = entries
    .map(entry => ({
      price: Number(entry.price),
      ts: entry.ts || new Date().toISOString(),
    }))
    .filter(entry => Number.isFinite(entry.price) && entry.price > 0)
  const next = { ...current.buyHistory }
  if (cleaned.length === 0) {
    delete next[key]
  } else {
    next[key] = cleaned
  }
  await saveState({ buyHistory: next })
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
  await writeRow(next)
  return next
}

// Clears idempotency ledger + buy history for a single account.
// Used by the reset flow so the cron engine treats the account as fresh.
export async function resetAccountCronState(account: string): Promise<void> {
  const current = await getState()
  const prefix = account.toUpperCase() + ':'
  const nextLedger: typeof current.idempotencyLedger = {}
  for (const [k, v] of Object.entries(current.idempotencyLedger)) {
    if (!k.startsWith(prefix)) nextLedger[k] = v
  }
  const nextHistory: typeof current.buyHistory = {}
  for (const [k, v] of Object.entries(current.buyHistory)) {
    if (!k.startsWith(prefix)) nextHistory[k] = v
  }
  await replaceState({ ...current, idempotencyLedger: nextLedger, buyHistory: nextHistory })
}

export async function clearAccountToken(accountName: string): Promise<SessionState> {
  const current = await getState()
  if (!(accountName in current.kiteTokens)) return current
  const { [accountName]: _, ...rest } = current.kiteTokens
  return replaceState({ ...current, kiteTokens: rest })
}

export async function clearState(): Promise<void> {
  await replaceState({ ...DEFAULT_STATE, kiteTokens: {}, idempotencyLedger: {}, buyHistory: {}, panicSkipList: {} })
}

// Diagnostic info — surface in /api/state if helpful.
export function getBackendInfo(): { backend: 'file' | 'cookie' | 'supabase'; path: string | null } {
  return { backend: 'supabase', path: null }
}
