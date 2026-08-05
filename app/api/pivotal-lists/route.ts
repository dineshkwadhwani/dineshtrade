import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getStrategies } from '@/lib/strategyConfig'
import {
  getPivotalLists,
  savePivotalLists,
  isPivotalListKey,
  type PivotalLists,
  type PivotalScriptEntry,
  type PivotalListMeta,
} from '@/lib/pivotalListStore'

export const dynamic = 'force-dynamic'

async function authed(): Promise<boolean> {
  const token = cookies().get('dt_session')?.value
  return !!token && (await verifySession(token))
}

function cleanEntryArray(value: any): PivotalScriptEntry[] {
  if (!Array.isArray(value)) return []
  const out: PivotalScriptEntry[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw.nse !== 'string' || typeof raw.name !== 'string') continue
    const nse = raw.nse.toUpperCase().trim()
    const name = raw.name.trim() || nse
    const enabled = raw.enabled !== false
    const breakoutTriggerPrice = Number(raw.breakoutTriggerPrice)
    const t1Pct = Number(raw.t1Pct)
    const t2Pct = Number(raw.t2Pct)
    const stopLossNumber = raw.stopLossPrice === null || raw.stopLossPrice === undefined || raw.stopLossPrice === ''
      ? null
      : Number(raw.stopLossPrice)
    const executionMode = raw.executionMode === 'dayEnd' ? 'dayEnd' : raw.executionMode === 'normal' ? 'normal' : null
    if (!nse || seen.has(nse)) continue
    if (!Number.isFinite(breakoutTriggerPrice) || breakoutTriggerPrice <= 0) continue
    if (!Number.isFinite(t1Pct) || t1Pct <= 0) continue
    if (!Number.isFinite(t2Pct) || t2Pct <= 0 || t1Pct > t2Pct) continue
    if (!executionMode) continue
    if (stopLossNumber !== null && (!Number.isFinite(stopLossNumber) || stopLossNumber <= 0 || stopLossNumber >= breakoutTriggerPrice)) continue
    seen.add(nse)
    out.push({
      nse,
      name,
      enabled,
      breakoutTriggerPrice,
      t1Pct,
      t2Pct,
      executionMode,
      stopLossPrice: stopLossNumber,
      notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 200) : undefined,
    })
  }
  return out
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const lists = await getPivotalLists()
  return NextResponse.json(lists, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 })
  }

  const rawLists: Record<string, any> = (body.lists && typeof body.lists === 'object') ? body.lists : {}
  if (!Array.isArray(rawLists.pivotalA)) {
    return NextResponse.json({ error: 'Body must include lists.pivotalA array' }, { status: 400 })
  }

  const ordered = ['pivotalA', ...Object.keys(rawLists).filter(k => isPivotalListKey(k) && k !== 'pivotalA')]
  const lists: Record<string, PivotalScriptEntry[]> = {}
  for (const key of ordered) lists[key] = cleanEntryArray(rawLists[key])

  const rawMeta = (body.meta && typeof body.meta === 'object') ? body.meta : {}
  const meta: Record<string, PivotalListMeta> = {}
  for (const key of Object.keys(lists)) {
    const nextMeta = (rawMeta as Record<string, any>)[key]
    if (nextMeta && typeof nextMeta.name === 'string' && nextMeta.name.trim()) {
      meta[key] = { name: nextMeta.name.trim().slice(0, 40) }
    }
  }

  const next: PivotalLists = {
    generated: new Date().toISOString().slice(0, 10),
    meta,
    lists,
  }

  try {
    await savePivotalLists(next)
  } catch (error) {
    return NextResponse.json({ error: String(error).slice(0, 200) }, { status: 500 })
  }

  const saved = await getPivotalLists()
  return NextResponse.json({ ok: true, counts: Object.fromEntries(Object.entries(saved.lists).map(([key, entries]) => [key, entries.length])) })
}

export async function DELETE(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const key = url.searchParams.get('key') || ''
  if (!isPivotalListKey(key)) return NextResponse.json({ error: 'Invalid pivotal list key' }, { status: 400 })
  if (key === 'pivotalA') {
    return NextResponse.json({ error: 'Pivotal List A cannot be deleted (it is required).' }, { status: 400 })
  }

  const using = getStrategies().filter(strategy => strategy.type === 'pivotal' && (strategy.params as any)?.pivotalListId === key)
  if (using.length > 0) {
    return NextResponse.json({ error: `List is used by strategy: ${using.map(s => s.name).join(', ')}. Reassign it first.` }, { status: 409 })
  }

  const current = await getPivotalLists()
  if (!current.lists[key]) return NextResponse.json({ error: 'List does not exist' }, { status: 404 })
  const { [key]: _removed, ...remainingLists } = current.lists
  const { [key]: _removedMeta, ...remainingMeta } = current.meta
  await savePivotalLists({ ...current, lists: remainingLists, meta: remainingMeta })
  return NextResponse.json({ ok: true, deleted: key })
}
