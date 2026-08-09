// Runtime watchlist store — Supabase-backed (`customer_watchlists`, one row
// per (customer_id, list_key)). Ported in Phase 4 of the multi-tenant
// refactor from the file-based `~/dineshtrade/data/watchlist.json`.
//
// Reads are uncached on the server — each strategy scan / API request picks
// up the latest version, so changes go live without any restart.
//
// Schema note: lists are keyed by stable strings ("listA", "listB",
// "list3", "list4", …). Display names live in `meta[key].name` and can be
// renamed freely without touching strategy config — strategies reference the
// stable keys, never the display name.
//
// `generated`/`rules` (the V1 file's cosmetic seed-timestamp + freeform
// rules blob) have no column in `customer_watchlists` and aren't read by any
// business logic — only displayed as an optional footer string in the
// Manage Lists UI. Dropped on this backend; both fields stay optional on the
// Watchlist type so existing callers that pass or destructure them still compile.

import { getSupabaseAdmin, getCustomerId } from './supabase'

export interface WatchlistEntry {
  nse: string                  // NSE tradingsymbol (uppercase, no spaces)
  name: string                 // display name (company name)
  sector?: string              // normalised sector key from lib/nse.ts (undefined until backfilled)
  trades?: number              // optional: historical trade count from seed data
  lastTraded?: string          // optional: yyyy-mm-dd of last historical trade
}

export interface ListMeta {
  name: string                 // user-editable display label
}

export interface Watchlist {
  generated?: string
  rules?: Record<string, unknown>
  meta: Record<string, ListMeta>
  lists: Record<string, WatchlistEntry[]>
}

const LIST_KEY_RE = /^list[A-Za-z0-9]+$/

export function isListKey(k: string): boolean { return LIST_KEY_RE.test(k) }

function defaultMetaName(key: string): string {
  // Pretty fallback when meta is missing (e.g. legacy data with no meta block).
  if (key === 'listA') return 'List A'
  if (key === 'listB') return 'List B'
  // "list3" → "List 3", "listFoo" → "List Foo"
  const tail = key.slice(4)
  return `List ${tail}`
}

function isValidEntry(e: any): e is WatchlistEntry {
  return e && typeof e.nse === 'string' && e.nse.length > 0 && typeof e.name === 'string'
}

// Reads either the legacy shape (top-level listA / listB / list3…) or the new
// shape ({ lists: { listA: [...] }, meta: { listA: { name } } }) and emits a
// canonical Watchlist. Always emits `meta` for every list — synthesising a
// default name when the saved file doesn't carry one.
function normalize(raw: any): Watchlist {
  const lists: Record<string, WatchlistEntry[]> = {}
  const meta: Record<string, ListMeta> = {}

  // Source 1: new shape — raw.lists
  if (raw?.lists && typeof raw.lists === 'object') {
    for (const [k, v] of Object.entries(raw.lists)) {
      if (!isListKey(k) || !Array.isArray(v)) continue
      lists[k] = (v as any[]).filter(isValidEntry)
    }
  }

  // Source 2: legacy shape — top-level listA / listB / list3 keys
  for (const [k, v] of Object.entries(raw || {})) {
    if (!isListKey(k) || !Array.isArray(v)) continue
    if (lists[k] === undefined) lists[k] = (v as any[]).filter(isValidEntry)
  }

  // Ensure at least listA + listB always exist — preserves Manage Lists UX
  // for fresh installs and matches the seed shape.
  if (!lists.listA) lists.listA = []
  if (!lists.listB) lists.listB = []

  // Meta: explicit user names win; otherwise synthesise.
  const savedMeta = (raw?.meta && typeof raw.meta === 'object') ? raw.meta : {}
  for (const k of Object.keys(lists)) {
    const saved = savedMeta[k]
    const name = (saved && typeof saved.name === 'string' && saved.name.trim().length > 0)
      ? saved.name.trim()
      : defaultMetaName(k)
    meta[k] = { name }
  }

  return { meta, lists }
}

export async function getWatchlist(): Promise<Watchlist> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('customer_watchlists')
    .select('list_key, name, symbols')
    .eq('customer_id', getCustomerId())
  if (error) throw new Error(`[watchlistStore] read failed: ${error.message}`)

  if (!data || data.length === 0) return normalize(null)

  const raw: any = { meta: {}, lists: {} }
  for (const row of data) {
    raw.lists[row.list_key] = row.symbols
    raw.meta[row.list_key] = { name: row.name }
  }
  return normalize(raw)
}

export async function saveWatchlist(next: Watchlist): Promise<void> {
  const admin = getSupabaseAdmin()
  const customerId = getCustomerId()
  const canonical = normalize(next)

  const rows = Object.entries(canonical.lists).map(([key, symbols]) => ({
    customer_id: customerId,
    list_key: key,
    name: canonical.meta[key]?.name ?? defaultMetaName(key),
    symbols,
    updated_at: new Date().toISOString(),
  }))
  const { error: upsertError } = await admin
    .from('customer_watchlists')
    .upsert(rows, { onConflict: 'customer_id,list_key' })
  if (upsertError) throw new Error(`[watchlistStore] upsert failed: ${upsertError.message}`)

  // Remove lists that existed before but aren't in the canonical set anymore
  // (e.g. a list was deleted) — mirrors the old file backend fully overwriting
  // watchlist.json with exactly the canonical shape.
  const { data: existing, error: selectError } = await admin
    .from('customer_watchlists')
    .select('list_key')
    .eq('customer_id', customerId)
  if (selectError) throw new Error(`[watchlistStore] post-save read failed: ${selectError.message}`)
  const keep = new Set(Object.keys(canonical.lists))
  const toDelete = (existing || []).map(r => r.list_key).filter(k => !keep.has(k))
  if (toDelete.length > 0) {
    const { error: deleteError } = await admin
      .from('customer_watchlists')
      .delete()
      .eq('customer_id', customerId)
      .in('list_key', toDelete)
    if (deleteError) throw new Error(`[watchlistStore] delete stale lists failed: ${deleteError.message}`)
  }
}

// Returns the next free list key — e.g. if listA, listB, list3 exist, returns "list4".
// Reserved for the API layer.
export function nextListKey(existing: Record<string, unknown>): string {
  const used = new Set(Object.keys(existing).filter(isListKey))
  if (!used.has('listA')) return 'listA'
  if (!used.has('listB')) return 'listB'
  for (let n = 3; n < 1000; n++) {
    const k = `list${n}`
    if (!used.has(k)) return k
  }
  throw new Error('list key exhaustion')
}
