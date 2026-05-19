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
      trades: typeof e.trades === 'number' ? e.trades : undefined,
      lastTraded: typeof e.lastTraded === 'string' ? e.lastTraded : undefined,
    })
  }
  return out
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

  // Deduplicate symbols across lists — first list (in declared order) wins.
  // Order: listA, listB, then any additional list* keys in insertion order.
  const ordered = ['listA', 'listB', ...Object.keys(rawLists).filter(k => isListKey(k) && k !== 'listA' && k !== 'listB')]
  const seenSymbols = new Set<string>()
  const lists: Record<string, WatchlistEntry[]> = {}
  for (const k of ordered) {
    const cleaned = cleanEntries(rawLists[k]).filter(e => !seenSymbols.has(e.nse))
    cleaned.forEach(e => seenSymbols.add(e.nse))
    lists[k] = cleaned
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
  try {
    await saveWatchlist(next)
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 })
  }
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
