import { promises as fs } from 'fs'
import * as path from 'path'
import bundled from '@/config/pivotalLists.json'

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

const STATE_FILE_PATH = process.env.STATE_FILE_PATH || ''
const RUNTIME_PATH = STATE_FILE_PATH ? path.join(path.dirname(STATE_FILE_PATH), 'pivotalLists.json') : ''
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

  return { generated: raw?.generated, meta, lists }
}

export async function getPivotalLists(): Promise<PivotalLists> {
  if (!RUNTIME_PATH) return normalize(bundled as any)
  try {
    const raw = await fs.readFile(RUNTIME_PATH, 'utf8')
    return normalize(JSON.parse(raw))
  } catch {
    return normalize(bundled as any)
  }
}

export async function savePivotalLists(next: PivotalLists): Promise<void> {
  if (!RUNTIME_PATH) throw new Error('STATE_FILE_PATH not configured — cannot persist pivotalLists changes in this environment')
  const dir = path.dirname(RUNTIME_PATH)
  await fs.mkdir(dir, { recursive: true })
  const canonical = normalize(next)
  const tmp = RUNTIME_PATH + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(canonical, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, RUNTIME_PATH)
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
