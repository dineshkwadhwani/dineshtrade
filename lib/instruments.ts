// Maps NSE tradingsymbol → instrument_token. Required because Kite's /historical
// endpoint takes instrument_token, not symbol. Cached in-process for 24h after
// first load (instruments don't change much; new listings are rare).

import type { KiteCreds } from './kite'

const tokenMap = new Map<string, number>()
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
  const iType = header.indexOf('instrument_type')
  if (iToken < 0 || iSymbol < 0 || iType < 0) {
    throw new Error('Kite /instruments/NSE CSV header missing required columns')
  }
  tokenMap.clear()
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const row = parseCSVLine(line)
    if (row[iType] !== 'EQ') continue
    const symbol = row[iSymbol]?.toUpperCase()
    const token = parseInt(row[iToken], 10)
    if (symbol && !isNaN(token)) tokenMap.set(symbol, token)
  }
  lastLoad = Date.now()
  console.log(`[instruments] loaded ${tokenMap.size} NSE equity tokens`)
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
