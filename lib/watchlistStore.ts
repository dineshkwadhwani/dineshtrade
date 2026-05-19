// Runtime watchlist store. The original `config/watchlist.json` is the seed
// (checked into git). Once the Manage Lists UI saves a change, we write to
// `~/dineshtrade/data/watchlist.json` and prefer that file going forward, so
// edits survive deploys without requiring a config commit + push.
//
// Reads are uncached on the server — each strategy scan / API request picks
// up the latest version, so changes go live without any restart.

import { promises as fs } from 'fs'
import * as path from 'path'
import bundled from '@/config/watchlist.json'

export interface WatchlistEntry {
  nse: string                  // NSE tradingsymbol (uppercase, no spaces)
  name: string                 // display name (company name)
  trades?: number              // optional: historical trade count from seed data
  lastTraded?: string          // optional: yyyy-mm-dd of last historical trade
}

export interface Watchlist {
  generated?: string
  rules?: Record<string, unknown>
  listA: WatchlistEntry[]
  listB: WatchlistEntry[]
}

const STATE_FILE_PATH = process.env.STATE_FILE_PATH || ''
const RUNTIME_PATH = STATE_FILE_PATH ? path.join(path.dirname(STATE_FILE_PATH), 'watchlist.json') : ''

function normalize(raw: any): Watchlist {
  const listA = Array.isArray(raw?.listA) ? raw.listA.filter(isValidEntry) : []
  const listB = Array.isArray(raw?.listB) ? raw.listB.filter(isValidEntry) : []
  return { generated: raw?.generated, rules: raw?.rules, listA, listB }
}

function isValidEntry(e: any): e is WatchlistEntry {
  return e && typeof e.nse === 'string' && e.nse.length > 0
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
  const tmp = RUNTIME_PATH + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(normalize(next), null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, RUNTIME_PATH)
}

