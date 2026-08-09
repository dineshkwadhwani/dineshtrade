// POST /api/journal/fix-attribution
//
// Two-pass cleanup of dt-manual SELL journal entries:
//
// Pass 1 — Attribution fix (non-destructive):
//   Finds dt-manual SELL entries missing a strategyId. For each, looks up the
//   most recent auto-BUY before the SELL timestamp and patches strategyId.
//
// Pass 2 — Synthetic price cleanup (destructive but safe):
//   Removes dt-manual SELL entries that have NO orderId AND whose price exactly
//   matches the corresponding position's firstBuyPrice (the dead giveaway of a
//   Case 2 fallback that wrote the wrong price). After deletion, the cron's next
//   reconcile tick creates a correct entry using actual LTP or fill price.
//   Leaves any SELL entries that have an orderId (real fill) untouched.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import fs from 'fs/promises'
import path from 'path'

// Reads the session cookie via cookies() (next/headers) on every request —
// force-dynamic makes that explicit instead of relying on Next's implicit
// dynamic-usage detection, which reportedly failed the production build on
// EC2 for a sibling route (app/api/dalgo/admin/reports/export) with the same
// underlying pattern.
export const dynamic = 'force-dynamic'

export async function POST() {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const stateFilePath = process.env.STATE_FILE_PATH || ''
  if (!stateFilePath) {
    return NextResponse.json({ ok: true, fixed: 0, message: 'In-memory mode — no journal files to fix' })
  }

  const journalDir = path.dirname(stateFilePath)

  // List all monthly journal files
  let files: string[]
  try {
    const all = await fs.readdir(journalDir)
    files = all.filter(f => /^journal-\d{4}-\d{2}\.jsonl$/.test(f)).sort()
  } catch {
    return NextResponse.json({ ok: true, fixed: 0, message: 'No journal files found' })
  }

  if (files.length === 0) {
    return NextResponse.json({ ok: true, fixed: 0, message: 'No journal files found' })
  }

  // Pass 1: collect ALL auto-BUY records across all files so we can look up
  // the buying strategy for any manual SELL regardless of which month it's in.
  // Map key: "ACCOUNT:SYMBOL" → sorted array of { strategyId, ts }
  const autoBuys = new Map<string, Array<{ strategyId: string; ts: string }>>()

  for (const file of files) {
    const raw = await fs.readFile(path.join(journalDir, file), 'utf8').catch(() => '')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        const r = JSON.parse(t)
        if (r.type !== 'order' || r.side !== 'BUY' || r.source !== 'auto' || !r.strategyId) continue
        const key = `${String(r.account).toUpperCase()}:${String(r.symbol).toUpperCase()}`
        const arr = autoBuys.get(key) || []
        arr.push({ strategyId: r.strategyId, ts: r.ts })
        autoBuys.set(key, arr)
      } catch { /* malformed line */ }
    }
  }
  // Sort each symbol's buys ascending by ts for binary-search-style lookup
  for (const arr of Array.from(autoBuys.values())) arr.sort((a, b) => a.ts < b.ts ? -1 : 1)

  function findBuyingStrategy(account: string, symbol: string, beforeTs: string): string | undefined {
    const key = `${account.toUpperCase()}:${symbol.toUpperCase()}`
    const arr = autoBuys.get(key)
    if (!arr) return undefined
    // Latest auto-BUY that occurred strictly before this SELL
    let result: string | undefined
    for (const entry of arr) {
      if (entry.ts < beforeTs) result = entry.strategyId
      else break
    }
    return result
  }

  // Pass 2: scan each file for dt-manual SELLs with no strategyId and patch them
  // Pass 2 setup: load positions.json firstBuyPrice per "ACCOUNT:SYMBOL" key.
  // Any dt-manual SELL with no orderId whose price exactly matches firstBuyPrice
  // is a Case 2 synthetic fallback entry — remove it so the next reconcile tick
  // can create a correct entry using the actual LTP or fill price.
  let firstBuyPriceByKey: Record<string, number> = {}
  try {
    const posFile = stateFilePath.replace(/state\.json$/, 'positions.json')
    const posRaw = await fs.readFile(posFile, 'utf8').catch(() => '{}')
    const posData = JSON.parse(posRaw)
    if (posData && typeof posData === 'object') {
      for (const [k, v] of Object.entries(posData)) {
        const price = (v as any)?.firstBuyPrice
        if (typeof price === 'number' && price > 0) firstBuyPriceByKey[k.toUpperCase()] = price
      }
    }
  } catch { /* best-effort */ }

  let totalFixed = 0
  const fixedBySymbol: Record<string, number> = {}
  let totalPurged = 0
  const purgedBySymbol: Record<string, number> = {}

  for (const file of files) {
    const filePath = path.join(journalDir, file)
    const raw = await fs.readFile(filePath, 'utf8').catch(() => '')
    if (!raw.trim()) continue

    let changed = false
    const newLines: string[] = []

    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) { newLines.push(line); continue }
      try {
        const r = JSON.parse(t)
        if (r.type === 'order' && r.side === 'SELL' && r.tag === 'dt-manual' && r.account && r.symbol) {

          // Pass 2: purge wrong synthetic entries (no orderId, price = firstBuyPrice)
          if (!r.orderId && typeof r.price === 'number') {
            const key = `${String(r.account).toUpperCase()}:${String(r.symbol).toUpperCase()}`
            const expectedFallback = firstBuyPriceByKey[key]
            if (expectedFallback && Math.abs(r.price - expectedFallback) < 0.01) {
              // This is a Case 2 synthetic entry — drop it
              changed = true
              totalPurged++
              const sym = String(r.symbol).toUpperCase()
              purgedBySymbol[sym] = (purgedBySymbol[sym] || 0) + 1
              continue
            }
          }

          // Pass 1: fix missing strategyId
          if (!r.strategyId && r.ts) {
            const strategyId = findBuyingStrategy(r.account, r.symbol, r.ts)
            if (strategyId) {
              r.strategyId = strategyId
              r.source = 'manual'
              newLines.push(JSON.stringify(r))
              changed = true
              totalFixed++
              const sym = String(r.symbol).toUpperCase()
              fixedBySymbol[sym] = (fixedBySymbol[sym] || 0) + 1
              continue
            }
          }
        }
      } catch { /* malformed — keep original line */ }
      newLines.push(line)
    }

    if (changed) {
      const content = newLines.join('\n')
      await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 })
    }
  }

  const parts: string[] = []
  if (totalFixed > 0) parts.push(`Fixed attribution for ${totalFixed} entr${totalFixed === 1 ? 'y' : 'ies'} (${Object.keys(fixedBySymbol).join(', ')})`)
  if (totalPurged > 0) parts.push(`Removed ${totalPurged} synthetic SELL entr${totalPurged === 1 ? 'y' : 'ies'} with wrong price (${Object.keys(purgedBySymbol).join(', ')}) — next reconcile will re-create them correctly`)
  if (parts.length === 0) parts.push('Nothing to fix — all entries look correct')

  return NextResponse.json({
    ok: true,
    fixed: totalFixed,
    fixedBySymbol,
    purged: totalPurged,
    purgedBySymbol,
    message: parts.join('. '),
  })
}
