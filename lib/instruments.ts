// Maps NSE tradingsymbol → instrument_token + company name. Required because
// Kite's /historical endpoint takes instrument_token, not symbol. The name is
// also used by the Manage Lists search (type a company name → find the NSE
// tradingsymbol). Cached in-process for 24h after first load.

import type { KiteCreds } from './kite'

export interface InstrumentRecord {
  token: number
  symbol: string         // tradingsymbol (uppercase, no spaces)
  name: string           // company name (e.g. "Reliance Industries Ltd.")
}

const recordMap = new Map<string, InstrumentRecord>()
const tokenMap = new Map<string, number>()     // legacy — kept for backwards compat
let lastLoad = 0
const CACHE_MS = 24 * 60 * 60 * 1000

function parseCSVLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQ = !inQ
    else if (c === ',' && !inQ) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

async function loadInstruments(creds: KiteCreds): Promise<void> {
  const res = await fetch('https://api.kite.trade/instruments/NSE', {
    headers: {
      'X-Kite-Version': '3',
      Authorization: `token ${creds.apiKey}:${creds.accessToken}`,
    },
  })
  if (!res.ok) throw new Error(`Kite /instruments/NSE failed: HTTP ${res.status}`)
  const csv = await res.text()
  const lines = csv.split('\n')
  if (lines.length < 2) throw new Error('Kite /instruments/NSE returned empty CSV')
  const header = parseCSVLine(lines[0])
  const iToken = header.indexOf('instrument_token')
  const iSymbol = header.indexOf('tradingsymbol')
  const iName = header.indexOf('name')
  const iType = header.indexOf('instrument_type')
  if (iToken < 0 || iSymbol < 0 || iType < 0) {
    throw new Error('Kite /instruments/NSE CSV header missing required columns')
  }
  tokenMap.clear()
  recordMap.clear()
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const row = parseCSVLine(line)
    if (row[iType] !== 'EQ') continue
    const symbol = row[iSymbol]?.toUpperCase()
    const token = parseInt(row[iToken], 10)
    const name = (iName >= 0 ? row[iName] : '') || symbol
    if (symbol && !isNaN(token)) {
      tokenMap.set(symbol, token)
      recordMap.set(symbol, { token, symbol, name })
    }
  }
  lastLoad = Date.now()
  console.log(`[instruments] loaded ${recordMap.size} NSE equity tokens`)
}

async function ensureLoaded(creds: KiteCreds): Promise<void> {
  if (tokenMap.size === 0 || Date.now() - lastLoad > CACHE_MS) {
    await loadInstruments(creds)
  }
}

export async function getInstrumentToken(creds: KiteCreds, symbol: string): Promise<number | null> {
  await ensureLoaded(creds)
  return tokenMap.get(symbol.toUpperCase()) ?? null
}

export async function getInstrumentTokens(creds: KiteCreds, symbols: string[]): Promise<Record<string, number>> {
  await ensureLoaded(creds)
  const out: Record<string, number> = {}
  for (const s of symbols) {
    const t = tokenMap.get(s.toUpperCase())
    if (t !== undefined) out[s.toUpperCase()] = t
  }
  return out
}

// Fuzzy search for the Manage Lists UI. Ranks symbol prefix > name prefix >
// substring matches. Returns at most `limit` matches. Case-insensitive.
export async function searchInstruments(creds: KiteCreds, query: string, limit = 20): Promise<InstrumentRecord[]> {
  await ensureLoaded(creds)
  const q = query.trim().toUpperCase()
  if (!q) return []
  const records = Array.from(recordMap.values())
  type Scored = { r: InstrumentRecord; score: number }
  const scored: Scored[] = []
  for (const r of records) {
    const sym = r.symbol.toUpperCase()
    const nm = r.name.toUpperCase()
    let score = 0
    if (sym === q) score = 100
    else if (sym.startsWith(q)) score = 80
    else if (nm.startsWith(q)) score = 60
    else if (sym.includes(q)) score = 40
    else if (nm.includes(q)) score = 20
    if (score > 0) scored.push({ r, score })
  }
  scored.sort((a, b) => b.score - a.score || a.r.symbol.localeCompare(b.r.symbol))
  return scored.slice(0, limit).map(s => s.r)
}
