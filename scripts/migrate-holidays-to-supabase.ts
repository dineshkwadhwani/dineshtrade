#!/usr/bin/env ts-node

// Migrates config/holidays.json -> platform_holidays table.
//
// Run:
//   npx ts-node --project tsconfig.json scripts/migrate-holidays-to-supabase.ts
//   npx ts-node --project tsconfig.json scripts/migrate-holidays-to-supabase.ts --dry-run

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'

const DRY_RUN = process.argv.includes('--dry-run')

interface HolidaysConfig {
  holidays: string[]
}

function loadJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), relPath), 'utf8')) as T
}

function uniqueSortedDates(values: string[]): string[] {
  return Array.from(new Set(values.filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v)))).sort()
}

function defaultHolidayName(ymd: string): string {
  return `NSE Holiday ${ymd}`
}

async function main(): Promise<void> {
  process.env.DOTENV_CONFIG_QUIET = 'true'
  loadEnv({ path: resolve(process.cwd(), '.env.local') })

  const cfg = loadJson<HolidaysConfig>('config/holidays.json')
  const dates = uniqueSortedDates(Array.isArray(cfg.holidays) ? cfg.holidays : [])

  if (dates.length === 0) {
    console.log('No valid holiday dates found in config/holidays.json')
    return
  }

  const { getSupabaseAdmin } = await import('../lib/supabase')
  const admin = getSupabaseAdmin()

  // Ensure table exists before trying to write rows.
  const probe = await admin.from('platform_holidays').select('id').limit(1)
  if (probe.error) {
    console.error('platform_holidays table not available:', probe.error.message)
    console.error('Run scripts/migrations/2026-08-17-platform-holidays.sql in Supabase SQL Editor first.')
    process.exit(1)
  }

  const rows = dates.map(date => ({
    market: 'NSE',
    holiday_date: date,
    name: defaultHolidayName(date),
    notes: 'Migrated from config/holidays.json',
    active: true,
    updated_at: new Date().toISOString(),
  }))

  if (DRY_RUN) {
    console.log(`[dry-run] Would upsert ${rows.length} holidays into platform_holidays`)
    console.log(rows.slice(0, 5))
    return
  }

  const { error } = await admin
    .from('platform_holidays')
    .upsert(rows, { onConflict: 'market,holiday_date' })

  if (error) {
    console.error('Holiday migration failed:', error.message)
    process.exit(1)
  }

  console.log(`Holiday migration complete: ${rows.length} rows upserted.`)
}

main().catch(err => {
  console.error('Fatal error in migrate-holidays-to-supabase:', err)
  process.exit(1)
})
