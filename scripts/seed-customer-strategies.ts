// One-time script: copies all published platform strategy templates into
// customer_strategies for specified customers (active=false by default).
// Safe to re-run — uses upsert on (customer_id, strategy_key).
//
// Run:
//   npx ts-node --project tsconfig.json scripts/seed-customer-strategies.ts
//   npx ts-node --project tsconfig.json scripts/seed-customer-strategies.ts --dry-run

import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'

const DRY_RUN = process.argv.includes('--dry-run')

async function seedStrategiesForCustomer(admin: any, customerId: string, email: string, templates: any[]) {
  console.log(`\n→ ${email} (${customerId})`)
  for (const t of templates) {
    const row = {
      customer_id: customerId,
      platform_strategy_id: t.id,
      strategy_key: t.id,
      name: t.name,
      type: t.type,
      active: false,
      color: t.color ?? '#3B82F6',
      scan_interval_min: t.scan_interval_min ?? 5,
      watchlist_keys: t.watchlist_keys ?? ['listA'],
      params: t.params,
      exits: t.exits,
      gift_nifty_gate: t.gift_nifty_gate ?? null,
      updated_at: new Date().toISOString(),
    }
    if (DRY_RUN) {
      console.log(`  [dry-run] would upsert: ${t.name} (key=${t.id}, active=false)`)
      continue
    }
    const { error } = await admin
      .from('customer_strategies')
      .upsert(row, { onConflict: 'customer_id,name' })
    if (error) {
      console.error(`  ✗ ${t.name}: ${error.message}`)
    } else {
      console.log(`  ✓ ${t.name} [${t.type}]`)
    }
  }
}

async function main() {
  console.log(DRY_RUN ? '=== seed-customer-strategies — DRY RUN ===\n' : '=== seed-customer-strategies ===\n')
  process.env.DOTENV_CONFIG_QUIET = 'true'
  loadEnv({ path: resolve(process.cwd(), '.env.local') })
  const { getSupabaseAdmin } = await import('../lib/supabase')
  const admin = getSupabaseAdmin()

  // Load published platform templates
  const { data: templates, error: tErr } = await admin
    .from('platform_strategies')
    .select('*')
    .eq('published', true)
    .order('name')
  if (tErr || !templates?.length) {
    console.error('No published platform strategies found:', tErr?.message)
    process.exit(1)
  }
  console.log(`Found ${templates.length} published platform template(s): ${templates.map((t: any) => t.name).join(', ')}`)

  // Target customers — add emails here or pass all active customers
  const targetEmails = ['wadhwani_dinesh@hotmail.com', 'kiran.d.wadhwani@gmail.com']
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .in('email', targetEmails)
    .eq('role', 'customer')

  if (!profiles?.length) {
    console.error('No matching customer profiles found')
    process.exit(1)
  }

  for (const profile of profiles) {
    await seedStrategiesForCustomer(admin, profile.id, profile.email, templates)
  }

  if (!DRY_RUN) {
    console.log('\n✅ Done. All strategies seeded as inactive — customers must activate them explicitly.')
  } else {
    console.log('\n(DRY RUN — no changes made)')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
