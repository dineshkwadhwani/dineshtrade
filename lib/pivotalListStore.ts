// Pivotal list store — Supabase-backed (`customer_pivotal_lists`, one row
// per (customer_id, list_id)). Ported in Phase 4 of the multi-tenant
// refactor from the file-based `config/pivotalLists.json` (+ runtime
// override at `~/dineshtrade/data/pivotalLists.json`).
//
// `generated` (the V1 file's cosmetic seed-timestamp) has no column in
// `customer_pivotal_lists` and isn't read by any business logic — only
// displayed as an optional footer string in the Pivotal Lists UI (same
// reasoning as lib/watchlistStore.ts's `generated` field). Dropped on this
// backend; stays optional on the PivotalLists type so existing callers still compile.

import { getSupabaseAdmin, getCustomerId } from './supabase'

export type PivotalExecutionMode = 'normal' | 'dayEnd'

export interface PivotalScriptEntry {
  nse: string
  name: string
  enabled: boolean
  breakoutTriggerPrice: number
  t1Pct: number
  t2Pct: number
  executionMode: PivotalExecutionMode
  stopLossPrice?: number | null
  notes?: string
}

export interface PivotalListMeta {
  name: string
}

export interface PivotalLists {
  generated?: string
  meta: Record<string, PivotalListMeta>
  lists: Record<string, PivotalScriptEntry[]>
}

const LIST_KEY_RE = /^pivotal[A-Za-z0-9]+$/

export function isPivotalListKey(k: string): boolean { return LIST_KEY_RE.test(k) }

function defaultMetaName(key: string): string {
  if (key === 'pivotalA') return 'Pivotal List A'
  if (key === 'pivotalB') return 'Pivotal List B'
  return key.replace(/^pivotal/, 'Pivotal List ')
}

function isExecutionMode(value: unknown): value is PivotalExecutionMode {
  return value === 'normal' || value === 'dayEnd'
}

function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isValidEntry(entry: any): entry is PivotalScriptEntry {
  if (!entry || typeof entry.nse !== 'string' || typeof entry.name !== 'string') return false
  if (!isExecutionMode(entry.executionMode)) return false
  const trigger = cleanNumber(entry.breakoutTriggerPrice)
  const t1 = cleanNumber(entry.t1Pct)
  const t2 = cleanNumber(entry.t2Pct)
  if (!(trigger && trigger > 0 && t1 && t1 > 0 && t2 && t2 > 0 && t1 <= t2)) return false
  const stop = cleanNumber(entry.stopLossPrice)
  if (stop !== null && !(stop > 0 && stop < trigger)) return false
  return true
}

function normalize(raw: any): PivotalLists {
  const lists: Record<string, PivotalScriptEntry[]> = {}
  const meta: Record<string, PivotalListMeta> = {}

  if (raw?.lists && typeof raw.lists === 'object') {
    for (const [key, value] of Object.entries(raw.lists)) {
      if (!isPivotalListKey(key) || !Array.isArray(value)) continue
      const seen = new Set<string>()
      lists[key] = value.filter(isValidEntry).filter(entry => {
        const symbol = entry.nse.toUpperCase().trim()
        if (!symbol || seen.has(symbol)) return false
        seen.add(symbol)
        entry.nse = symbol
        entry.name = entry.name.trim() || symbol
        entry.notes = typeof entry.notes === 'string' ? entry.notes.trim().slice(0, 200) : undefined
        entry.stopLossPrice = cleanNumber(entry.stopLossPrice)
        return true
      })
    }
  }

  if (!lists.pivotalA) lists.pivotalA = []

  const savedMeta = (raw?.meta && typeof raw.meta === 'object') ? raw.meta : {}
  for (const key of Object.keys(lists)) {
    const m = (savedMeta as Record<string, any>)[key]
    const name = m && typeof m.name === 'string' && m.name.trim()
      ? m.name.trim().slice(0, 40)
      : defaultMetaName(key)
    meta[key] = { name }
  }

  return { meta, lists }
}

export async function getPivotalLists(): Promise<PivotalLists> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('customer_pivotal_lists')
    .select('list_id, name, entries')
    .eq('customer_id', getCustomerId())
  if (error) throw new Error(`[pivotalListStore] read failed: ${error.message}`)

  if (!data || data.length === 0) return normalize(null)

  const raw: any = { meta: {}, lists: {} }
  for (const row of data) {
    raw.lists[row.list_id] = row.entries
    raw.meta[row.list_id] = { name: row.name }
  }
  return normalize(raw)
}

export async function savePivotalLists(next: PivotalLists): Promise<void> {
  const admin = getSupabaseAdmin()
  const customerId = getCustomerId()
  const canonical = normalize(next)

  const rows = Object.entries(canonical.lists).map(([key, entries]) => ({
    customer_id: customerId,
    list_id: key,
    name: canonical.meta[key]?.name ?? defaultMetaName(key),
    entries,
    updated_at: new Date().toISOString(),
  }))
  const { error: upsertError } = await admin
    .from('customer_pivotal_lists')
    .upsert(rows, { onConflict: 'customer_id,list_id' })
  if (upsertError) throw new Error(`[pivotalListStore] upsert failed: ${upsertError.message}`)

  // Remove lists that existed before but aren't in the canonical set anymore.
  const { data: existing, error: selectError } = await admin
    .from('customer_pivotal_lists')
    .select('list_id')
    .eq('customer_id', customerId)
  if (selectError) throw new Error(`[pivotalListStore] post-save read failed: ${selectError.message}`)
  const keep = new Set(Object.keys(canonical.lists))
  const toDelete = (existing || []).map(r => r.list_id).filter(k => !keep.has(k))
  if (toDelete.length > 0) {
    const { error: deleteError } = await admin
      .from('customer_pivotal_lists')
      .delete()
      .eq('customer_id', customerId)
      .in('list_id', toDelete)
    if (deleteError) throw new Error(`[pivotalListStore] delete stale lists failed: ${deleteError.message}`)
  }
}

export function nextPivotalListKey(existing: Record<string, unknown>): string {
  const used = new Set(Object.keys(existing).filter(isPivotalListKey))
  if (!used.has('pivotalA')) return 'pivotalA'
  if (!used.has('pivotalB')) return 'pivotalB'
  for (let n = 3; n < 1000; n++) {
    const key = `pivotal${n}`
    if (!used.has(key)) return key
  }
  throw new Error('pivotal list key exhaustion')
}
