#!/usr/bin/env ts-node

// Migrates config/strategy.json -> platform_broker_sources table.
//
// Run:
//   npx ts-node --project tsconfig.json scripts/migrate-broker-sources-to-supabase.ts
//   npx ts-node --project tsconfig.json scripts/migrate-broker-sources-to-supabase.ts --dry-run

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'

const DRY_RUN = process.argv.includes('--dry-run')

interface StrategyConfig {
  sources?: {
    brokerRecommendations?: Array<{ name?: string; url?: string }>
  }
}

function loadJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), relPath), 'utf8')) as T
}

function dedupeSources(rows: Array<{ name: string; url: string }>): Array<{ name: string; url: string }> {
  const seen = new Set<string>()
  const out: Array<{ name: string; url: string }> = []
  for (const r of rows) {
    const key = `${r.name.toLowerCase().trim()}|${r.url.toLowerCase().trim()}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(r)
    }
  }
  return out
}

async function main(): Promise<void> {
  process.env.DOTENV_CONFIG_QUIET = 'true'
  loadEnv({ path: resolve(process.cwd(), '.env.local') })

  const cfg = loadJson<StrategyConfig>('config/strategy.json')
  const sourceList = Array.isArray(cfg.sources?.brokerRecommendations)
    ? cfg.sources!.brokerRecommendations!
    : []

  const cleaned = dedupeSources(
    sourceList
      .map((s, idx) => ({
        name: String(s?.name || '').trim(),
        url: String(s?.url || '').trim(),
        idx,
      }))
      .filter(s => !!s.name && /^https?:\/\//i.test(s.url))
      .map(s => ({ name: s.name, url: s.url }))
  )

  if (cleaned.length === 0) {
    console.log('No valid broker sources found in config/strategy.json')
    return
  }

  const { getSupabaseAdmin } = await import('../lib/supabase')
  const admin = getSupabaseAdmin()

  // Ensure table exists before trying to write rows.
  const probe = await admin.from('platform_broker_sources').select('id').limit(1)
  if (probe.error) {
    console.error('platform_broker_sources table not available:', probe.error.message)
    console.error('Run scripts/migrations/2026-08-17-platform-broker-sources.sql in Supabase SQL Editor first.')
    process.exit(1)
  }

  const now = new Date().toISOString()
  const rows = cleaned.map((s, i) => ({
    name: s.name,
    url: s.url,
    notes: 'Migrated from config/strategy.json sources.brokerRecommendations',
    active: true,
    display_order: i + 1,
    updated_at: now,
  }))

  if (DRY_RUN) {
    console.log(`[dry-run] Would upsert ${rows.length} broker sources into platform_broker_sources`)
    console.log(rows)
    return
  }

  const { error } = await admin
    .from('platform_broker_sources')
    .upsert(rows, { onConflict: 'name' })

  if (error) {
    console.error('Broker source migration failed:', error.message)
    process.exit(1)
  }

  console.log(`Broker source migration complete: ${rows.length} rows upserted.`)
}

main().catch(err => {
  console.error('Fatal error in migrate-broker-sources-to-supabase:', err)
  process.exit(1)
})
