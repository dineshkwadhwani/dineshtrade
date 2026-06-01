// POST /api/journal/fix-attribution
//
// Retroactively fixes dt-manual SELL journal entries that are missing a
// strategyId. For each such entry, finds the most recent auto-BUY for the
// same account+symbol that occurred BEFORE the SELL timestamp, and patches
// the SELL entry's strategyId to match the buying strategy.
//
// Non-destructive: only adds missing strategyId — never changes side, qty,
// price, or any other field. Safe to re-run multiple times.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import fs from 'fs/promises'
import path from 'path'

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
  let totalFixed = 0
  const fixedBySymbol: Record<string, number> = {}

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
        if (
          r.type === 'order' &&
          r.side === 'SELL' &&
          r.tag === 'dt-manual' &&
          !r.strategyId &&
          r.account && r.symbol && r.ts
        ) {
          const strategyId = findBuyingStrategy(r.account, r.symbol, r.ts)
          if (strategyId) {
            r.strategyId = strategyId
            r.source = 'manual'  // ensure source is set correctly
            newLines.push(JSON.stringify(r))
            changed = true
            totalFixed++
            const sym = String(r.symbol).toUpperCase()
            fixedBySymbol[sym] = (fixedBySymbol[sym] || 0) + 1
            continue
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

  return NextResponse.json({
    ok: true,
    fixed: totalFixed,
    fixedBySymbol,
    message: totalFixed > 0
      ? `Fixed ${totalFixed} journal entr${totalFixed === 1 ? 'y' : 'ies'} across ${Object.keys(fixedBySymbol).length} symbol(s)`
      : 'All manual sell entries already have correct attribution',
  })
}
