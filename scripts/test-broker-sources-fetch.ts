#!/usr/bin/env ts-node

import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'

import { getSupabaseAdmin } from '../lib/supabase'
import { getActiveBrokerSources } from '../lib/brokerSources'

async function main(): Promise<void> {
  process.env.DOTENV_CONFIG_QUIET = 'true'
  loadEnv({ path: resolve(process.cwd(), '.env.local') })

  const admin = getSupabaseAdmin()
  const db = await admin
    .from('platform_broker_sources')
    .select('name,url')
    .eq('active', true)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (db.error) {
    console.error('DB query failed:', db.error.message)
    process.exit(1)
  }

  const fetched = await getActiveBrokerSources()
  const expected = (db.data ?? []).map(r => ({ name: r.name, url: r.url }))

  if (expected.length === 0) {
    console.log('No active DB rows. Helper may fall back to defaults by design.')
    console.log('Helper returned:', fetched)
    process.exit(0)
  }

  const sameLength = fetched.length === expected.length
  const sameRows = sameLength && fetched.every((row, idx) => row.name === expected[idx].name && row.url === expected[idx].url)

  if (!sameRows) {
    console.error('FAIL: helper output does not match DB active source rows.')
    console.error('Expected:', expected)
    console.error('Fetched :', fetched)
    process.exit(1)
  }

  console.log(`PASS: helper fetched ${fetched.length} active sources from DB in expected order.`)
}

main().catch(err => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
