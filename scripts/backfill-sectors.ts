#!/usr/bin/env tsx
// One-time backfill: adds `sector` to every WatchlistEntry that doesn't have
// one yet. Safe to re-run — skips entries that already have a sector.
//
// Usage (on EC2 where NSE API is reachable):
//   STATE_FILE_PATH=~/dineshtrade/data/state.json npx tsx scripts/backfill-sectors.ts
//
// NSE blocks requests from outside India — run this on the EC2 instance.

import { promises as fs } from 'fs'
import * as path from 'path'
import { NseIndia } from 'stock-nse-india'
import { mapIndustryToSector } from '../lib/nse'

const STATE_FILE_PATH = process.env.STATE_FILE_PATH
if (!STATE_FILE_PATH) {
  console.error('ERROR: STATE_FILE_PATH env var not set. Example:')
  console.error('  STATE_FILE_PATH=~/dineshtrade/data/state.json npx tsx scripts/backfill-sectors.ts')
  process.exit(1)
}

const WATCHLIST_PATH = path.join(path.dirname(STATE_FILE_PATH), 'watchlist.json')

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await fs.readFile(WATCHLIST_PATH, 'utf8')
  } catch (err) {
    console.error('Could not read watchlist.json:', String(err))
    console.error('Path tried:', WATCHLIST_PATH)
    process.exit(1)
  }

  const watchlist = JSON.parse(raw) as any
  // Support both runtime shape ({ lists: { listA: [...] } }) and seed/legacy
  // shape (top-level listA / listB keys directly on the root object).
  const lists: Record<string, any[]> = {}
  if (watchlist.lists && typeof watchlist.lists === 'object') {
    for (const [k, v] of Object.entries(watchlist.lists)) {
      if (Array.isArray(v)) lists[k] = v as any[]
    }
  }
  for (const [k, v] of Object.entries(watchlist)) {
    if (/^list[A-Za-z0-9]+$/.test(k) && Array.isArray(v) && !lists[k]) lists[k] = v as any[]
  }

  // Collect all symbols that need a sector
  const toProcess: Array<{ listKey: string; index: number; nse: string }> = []
  for (const [key, entries] of Object.entries(lists)) {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (e && typeof e.nse === 'string' && !e.sector) {
        toProcess.push({ listKey: key, index: i, nse: e.nse })
      }
    }
  }

  if (toProcess.length === 0) {
    console.log('All symbols already have sector data. Nothing to do.')
    return
  }

  console.log(`Backfilling sectors for ${toProcess.length} symbol(s) — 1s delay between calls…\n`)

  const nse = new NseIndia()

  // NSE requires a cookie warm-up request before any API calls — without it
  // the API returns 403 regardless of geography.
  try {
    await (nse as any).getCookies()
    console.log('NSE session initialised.\n')
  } catch (err) {
    console.warn('Warning: cookie init failed, continuing anyway:', String(err).slice(0, 80))
  }

  let ok = 0; let failed = 0

  for (const { listKey, index, nse: symbol } of toProcess) {
    try {
      const data = await (nse as any).getEquityDetails(symbol.toUpperCase()) as any
      const industry: string = data?.info?.industry || data?.metadata?.industry || ''
      if (!industry) {
        console.log(`  ${symbol.padEnd(14)} — no industry field in NSE response (skipping)`)
        failed++
      } else {
        const sector = mapIndustryToSector(industry)
        lists[listKey][index].sector = sector
        console.log(`  ${symbol.padEnd(14)} → "${industry}"  →  ${sector}`)
        ok++
      }
    } catch (err) {
      console.log(`  ${symbol.padEnd(14)} — fetch failed: ${String(err).slice(0, 80)}`)
      failed++
    }
    await sleep(1000)
  }

  // Write back atomically — preserve original shape (seed uses top-level keys,
  // runtime uses { lists: { ... } }).
  if (watchlist.lists && typeof watchlist.lists === 'object') {
    watchlist.lists = lists
  } else {
    for (const [k, v] of Object.entries(lists)) {
      watchlist[k] = v
    }
  }
  const tmp = WATCHLIST_PATH + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(watchlist, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, WATCHLIST_PATH)

  console.log(`\nDone. ${ok} updated, ${failed} failed/skipped.`)
  console.log(`Saved to: ${WATCHLIST_PATH}`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
