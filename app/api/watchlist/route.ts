// GET  /api/watchlist        — current effective watchlist { meta, lists }
// POST /api/watchlist        — save the whole watchlist (idempotent overwrite)
//
// Save writes to data/watchlist.json — runtime override file. Strategy engine
// reads from this file every scan, so changes take effect immediately on the
// next tick / refresh without restarting the process.
//
// Body shape (new):
//   {
//     meta: { listA: { name: "Top Volume" }, ... },
//     lists: { listA: [...], listB: [...], list3: [...] }
//   }
// Body shape (legacy, still accepted):
//   { listA: [...], listB: [...] }

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getWatchlist, saveWatchlist, isListKey, type Watchlist, type WatchlistEntry, type ListMeta } from '@/lib/watchlistStore'
import { getStrategies } from '@/lib/strategyConfig'
import { fetchSymbolSector } from '@/lib/nse'

export const dynamic = 'force-dynamic'

async function authed(): Promise<boolean> {
  const t = cookies().get('dt_session')?.value
  return !!t && (await verifySession(t))
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const wl = await getWatchlist()
  return NextResponse.json(wl, { headers: { 'Cache-Control': 'no-store' } })
}

function cleanEntries(arr: any): WatchlistEntry[] {
  if (!Array.isArray(arr)) return []
  const out: WatchlistEntry[] = []
  const seen = new Set<string>()
  for (const e of arr) {
    if (!e || typeof e.nse !== 'string') continue
    const nse = e.nse.toUpperCase().trim()
    if (!nse || seen.has(nse)) continue
    seen.add(nse)
    out.push({
      nse,
      name: typeof e.name === 'string' && e.name ? e.name : nse,
      sector: typeof e.sector === 'string' && e.sector ? e.sector : undefined,
      trades: typeof e.trades === 'number' ? e.trades : undefined,
      lastTraded: typeof e.lastTraded === 'string' ? e.lastTraded : undefined,
    })
  }
  return out
}

// Fetches sectors for symbols that are new to the watchlist (not in prev) and
// currently lack a sector. Runs after saveWatchlist — reads, patches, writes back.
// NSE blocks requests outside India so fetchSymbolSector returns null safely there.
async function enrichNewSectors(prev: Watchlist, next: Watchlist): Promise<void> {
  const prevSymbols = new Set<string>()
  for (const entries of Object.values(prev.lists)) {
    for (const e of entries) prevSymbols.add(e.nse.toUpperCase())
  }
  const toFetch: Array<{ listKey: string; nse: string }> = []
  const seen = new Set<string>()
  for (const [k, entries] of Object.entries(next.lists)) {
    for (const e of entries) {
      const sym = e.nse.toUpperCase()
      if (!e.sector && !prevSymbols.has(sym) && !seen.has(sym)) {
        toFetch.push({ listKey: k, nse: sym })
        seen.add(sym)
      }
    }
  }
  if (toFetch.length === 0) return

  const current = await getWatchlist()
  let updated = false
  for (const { listKey, nse } of toFetch) {
    const sector = await fetchSymbolSector(nse)
    if (!sector) continue
    const arr = current.lists[listKey]
    if (!arr) continue
    const idx = arr.findIndex(e => e.nse.toUpperCase() === nse)
    if (idx >= 0 && !arr[idx].sector) {
      arr[idx].sector = sector
      updated = true
      console.log(`[watchlist] sector enriched: ${nse} → ${sector}`)
    }
  }
  if (updated) await saveWatchlist(current)
}

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 })
  }

  // Accept both shapes — legacy { listA, listB } and new { lists, meta }.
  const rawLists: Record<string, any> = (body.lists && typeof body.lists === 'object') ? body.lists : {}
  for (const k of Object.keys(body)) {
    if (isListKey(k)) rawLists[k] = (rawLists[k] !== undefined ? rawLists[k] : body[k])
  }

  // Always need at least listA + listB present (Manage Lists UX guarantees them).
  if (!Array.isArray(rawLists.listA) || !Array.isArray(rawLists.listB)) {
    return NextResponse.json({ error: 'Body must include lists.listA and lists.listB arrays' }, { status: 400 })
  }

  // A symbol may live in multiple lists (e.g. listed in both "Top Volume" and
  // "Dip Candidates" because different strategies use different lenses on the
  // same name). We dedupe ONLY within each list, not across lists. Strategies
  // de-dupe the universe at scan time when they iterate multiple lists.
  const ordered = ['listA', 'listB', ...Object.keys(rawLists).filter(k => isListKey(k) && k !== 'listA' && k !== 'listB')]
  const lists: Record<string, WatchlistEntry[]> = {}
  for (const k of ordered) {
    lists[k] = cleanEntries(rawLists[k])
  }

  // Meta — accept user names if provided; normalize() will fill defaults.
  const meta: Record<string, ListMeta> = {}
  const rawMeta = (body.meta && typeof body.meta === 'object') ? body.meta : {}
  for (const k of Object.keys(lists)) {
    const m = rawMeta[k]
    if (m && typeof m === 'object' && typeof m.name === 'string' && m.name.trim().length > 0) {
      meta[k] = { name: m.name.trim().slice(0, 40) }
    }
  }

  const next: Watchlist = {
    generated: new Date().toISOString().slice(0, 10),
    rules: body.rules,
    meta,
    lists,
  }
  const prevWl = await getWatchlist()
  try {
    await saveWatchlist(next)
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 })
  }
  // Fire-and-forget: fetch NSE sector for newly added symbols that have none.
  // Compares new lists against prevWl to avoid re-fetching existing entries.
  enrichNewSectors(prevWl, next).catch(err => console.error('[watchlist] sector enrichment failed:', err))
  const saved = await getWatchlist()
  return NextResponse.json({ ok: true, counts: Object.fromEntries(Object.entries(saved.lists).map(([k, v]) => [k, v.length])) })
}

// DELETE /api/watchlist?key=list3
// Deletes a custom list. Blocks if any strategy references that key.
// listA and listB cannot be deleted — they're the always-present pair.
export async function DELETE(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const key = url.searchParams.get('key') || ''
  if (!isListKey(key)) return NextResponse.json({ error: 'Invalid list key' }, { status: 400 })
  if (key === 'listA' || key === 'listB') {
    return NextResponse.json({ error: 'List A and List B cannot be deleted (they are required).' }, { status: 400 })
  }

  // Block if any strategy uses this list.
  try {
    const strategies = getStrategies()
    const using = strategies.filter(s => Array.isArray(s.watchlist) && s.watchlist.includes(key))
    if (using.length > 0) {
      const names = using.map(s => s.name).join(', ')
      return NextResponse.json({ error: `List is used by strategy: ${names}. Unhook it from that strategy first.` }, { status: 409 })
    }
  } catch {
    return NextResponse.json({ error: 'Could not verify strategy references — delete refused.' }, { status: 500 })
  }

  const wl = await getWatchlist()
  if (!wl.lists[key]) return NextResponse.json({ error: 'List does not exist' }, { status: 404 })
  const { [key]: _removed, ...remainingLists } = wl.lists
  const { [key]: _removedMeta, ...remainingMeta } = wl.meta
  await saveWatchlist({ ...wl, lists: remainingLists, meta: remainingMeta })
  return NextResponse.json({ ok: true, deleted: key })
}
