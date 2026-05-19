// Runtime watchlist store. The original `config/watchlist.json` is the seed
// (checked into git). Once the Manage Lists UI saves a change, we write to
// `~/dineshtrade/data/watchlist.json` and prefer that file going forward, so
// edits survive deploys without requiring a config commit + push.
//
// Reads are uncached on the server — each strategy scan / API request picks
// up the latest version, so changes go live without any restart.
//
// Schema note: lists are keyed by stable strings ("listA", "listB",
// "list3", "list4", …). Display names live in `meta[key].name` and can be
// renamed freely without touching strategy.json — strategies reference the
// stable keys, never the display name.

import { promises as fs } from 'fs'
import * as path from 'path'
import bundled from '@/config/watchlist.json'

export interface WatchlistEntry {
  nse: string                  // NSE tradingsymbol (uppercase, no spaces)
  name: string                 // display name (company name)
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

const STATE_FILE_PATH = process.env.STATE_FILE_PATH || ''
const RUNTIME_PATH = STATE_FILE_PATH ? path.join(path.dirname(STATE_FILE_PATH), 'watchlist.json') : ''

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

  return { generated: raw?.generated, rules: raw?.rules, meta, lists }
}

export async function getWatchlist(): Promise<Watchlist> {
  if (!RUNTIME_PATH) return normalize(bundled as any)
  try {
    const raw = await fs.readFile(RUNTIME_PATH, 'utf8')
    return normalize(JSON.parse(raw))
  } catch {
    return normalize(bundled as any)
  }
}

export async function saveWatchlist(next: Watchlist): Promise<void> {
  if (!RUNTIME_PATH) throw new Error('STATE_FILE_PATH not configured — cannot persist watchlist changes in this environment')
  const dir = path.dirname(RUNTIME_PATH)
  await fs.mkdir(dir, { recursive: true })
  const canonical = normalize(next)
  const tmp = RUNTIME_PATH + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(canonical, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, RUNTIME_PATH)
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
