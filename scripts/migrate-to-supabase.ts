// One-time (idempotent, re-runnable) migration: seeds Supabase with
// platform data from the existing V1 JSON files and creates the three
// test accounts. Run order matters — main() runs the 13 steps in order.
//
// Run:
//   npx ts-node --project tsconfig.json scripts/migrate-to-supabase.ts
//   npx ts-node --project tsconfig.json scripts/migrate-to-supabase.ts --dry-run   (preview, no writes)
//
// tsconfig.json carries a `"ts-node"` override block (module: commonjs) so
// this works under ts-node despite the app's own tsconfig targeting
// `module: esnext` / `moduleResolution: bundler` for Next.js's bundler.
//
// Loads .env.local via `dotenv` (added as a devDependency for this script).
// getSupabaseAdmin() is imported from lib/supabase.ts DYNAMICALLY (inside
// main(), after dotenv has run) rather than as a static top-level import:
// lib/supabase.ts builds its `supabaseAnon` client EAGERLY at module-load
// time, reading NEXT_PUBLIC_SUPABASE_URL/ANON_KEY the moment the module
// evaluates. Static imports are always fully evaluated before any of this
// file's own top-level code runs, dotenv call included — so a static import
// would read those env vars before dotenv has loaded them. A dynamic
// `await import(...)` executes exactly where it's written, so calling
// dotenv's config() first and only then dynamically importing lib/supabase
// guarantees the env is loaded in time.

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'

const DRY_RUN = process.argv.includes('--dry-run')

function log(msg: string): void {
  console.log(msg)
}

// ---------------------------------------------------------------------------
// Load the real V1 JSON files — the actual current data/, not spec examples.
// ---------------------------------------------------------------------------

function loadJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), relPath), 'utf8')) as T
}

interface StrategyRow {
  id: string
  name: string
  type: 'dip' | 'momentum' | 'pivotal'
  active: boolean
  color: string
  scanIntervalMin: number
  watchlist: string[]
  params: Record<string, unknown>
  exits: { t1Pct: number; t2Pct: number }
  giftNiftyGate: { enabled: boolean; minPct: number | null; maxPct: number | null }
}

interface CapitalBlock {
  perTrade: number
  maxBuysPerDay: number
  maxSellsPerDay: number
  maxPositions: number
  maxBuysPerSymbol: number
  minDropBetweenBuysPct: number
  maxDeployPct: number
  deliveryDpCharge: number
  circuitBreakerPct: number
  intradayCircuitTripPct: number
  intradayCircuitResumePct: number
  panicDropPct: number
  panicWindowMin: number
}

interface StrategyFile {
  capital: CapitalBlock
  strategies: StrategyRow[]
}

interface WatchlistEntry {
  nse: string
  name: string
  trades?: number
  lastTraded?: string
  sector?: string
}

interface WatchlistFile {
  meta: Record<string, { name: string }>
  lists: Record<string, WatchlistEntry[]>
}

interface PivotalListsFile {
  meta: Record<string, { name: string }>
  lists: Record<string, unknown[]>
}

interface DailyCloseRecord {
  date: string
  close: number
  volume: number
  open?: number
  high?: number
  low?: number
}

interface DailyClosesFile {
  closes: Record<string, DailyCloseRecord[]>
}

// A stray artifact was found in the real watchlist.json during Task 5's
// file-shape check: a `lists` key, empty, meta name "List s" — not a real
// list. Rather than hardcode that one key name (fragile — would miss any
// other similarly-malformed list), filter by shape instead: a real list is
// a non-empty array of objects that each have a string `nse` field.
function isRealWatchlist(value: unknown): value is WatchlistEntry[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(e => typeof e === 'object' && e !== null && typeof (e as { nse?: unknown }).nse === 'string')
  )
}

// Spec §9.4 "V1 bugs fixed in migration seed" — applied on top of the real
// live JSON values, never taken from the JSON for these specific fields.
const STRATEGY_OVERRIDES: Record<string, Record<string, unknown>> = {
  market_boom: { squareOffEOD: true, deliveryHandoffDays: 0 },
  catalyst: { scanStartHHMM: '09:30' },
  new_pivotal: { minVolumeSurgeRatio: 1.5 },
}

const SEED_PASSWORD = 'DAlgo@2026!' // same temp password for all three seed accounts; changed at first login

interface SeedAccountResult {
  id: string
  email: string
}

async function main(): Promise<void> {
  log(DRY_RUN ? '=== DAlgo migration — DRY RUN (no writes) ===\n' : '=== DAlgo migration ===\n')

  loadEnv({ path: resolve(process.cwd(), '.env.local') })
  const { getSupabaseAdmin } = await import('../lib/supabase')
  const admin = getSupabaseAdmin()

  const strategyFile = loadJson<StrategyFile>('data/strategy.json')
  const watchlistFile = loadJson<WatchlistFile>('data/watchlist.json')
  const pivotalListsFile = loadJson<PivotalListsFile>('data/pivotalLists.json')
  const dailyClosesFile = loadJson<DailyClosesFile>('data/daily-closes.json')

  // Computed once, used by both Step 5 (what gets written) and Step 13 (what
  // gets counted in the summary) — keeps the two from silently disagreeing.
  const validWatchlistEntries = Object.entries(watchlistFile.lists).filter(([, symbols]) =>
    isRealWatchlist(symbols)
  )

  // -------------------------------------------------------------------------
  // STEP 1 — verifySupabaseConnection()
  // -------------------------------------------------------------------------
  try {
    const { error } = await admin.from('platform_config').select('key', { count: 'exact', head: true })
    if (error) throw error
    log('✅ Supabase connection verified')
  } catch (err) {
    console.error('❌ STEP 1 (verifySupabaseConnection) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 2 — seedPlatformFixedRules() — schema SQL already seeded these via
  // INSERT ... ON CONFLICT DO NOTHING. This step verifies, not re-inserts.
  // -------------------------------------------------------------------------
  try {
    const { count, error } = await admin
      .from('platform_fixed_rules')
      .select('rule_key', { count: 'exact', head: true })
    if (error) throw error
    if (count !== 6) {
      log(`⚠ WARNING: expected 6 platform_fixed_rules rows, found ${count} — was the schema SQL run completely?`)
    }
    log(`✅ Platform fixed rules: ${count} rows verified`)
  } catch (err) {
    console.error('❌ STEP 2 (seedPlatformFixedRules) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 3 — seedPlatformCapitalDefaults() — schema SQL seeded one row with
  // the spec's placeholder numbers. Update it with the real live values from
  // data/strategy.json's `capital` block, so anything downstream that reads
  // platform_capital_defaults (including Step 12's customer_capital_config
  // copy) inherits Dinesh's real parameters (₹20,000/trade, 35 positions,
  // etc.), not the placeholders. No natural unique key on this table besides
  // its generated id, so: find the existing row and UPDATE it; INSERT only
  // if the table is genuinely empty.
  // -------------------------------------------------------------------------
  let platformCapitalDefaults: Record<string, unknown> | null = null
  try {
    const c = strategyFile.capital
    const row = {
      per_trade: c.perTrade,
      max_buys_per_day: c.maxBuysPerDay,
      max_sells_per_day: c.maxSellsPerDay,
      max_positions: c.maxPositions,
      max_buys_per_symbol: c.maxBuysPerSymbol,
      min_drop_between_buys_pct: c.minDropBetweenBuysPct,
      max_deploy_pct: c.maxDeployPct,
      delivery_dp_charge: c.deliveryDpCharge,
      circuit_breaker_pct: c.circuitBreakerPct,
      intraday_circuit_trip_pct: c.intradayCircuitTripPct,
      intraday_circuit_resume_pct: c.intradayCircuitResumePct,
      panic_drop_pct: c.panicDropPct,
      panic_window_min: c.panicWindowMin,
    }

    if (DRY_RUN) {
      log(
        `✅ [dry-run] Platform capital defaults would be updated with live values: perTrade=₹${c.perTrade} maxPositions=${c.maxPositions} maxDeployPct=${c.maxDeployPct}%`
      )
      platformCapitalDefaults = row
    } else {
      const { data: existing, error: selectError } = await admin
        .from('platform_capital_defaults')
        .select('id')
        .limit(1)
        .maybeSingle()
      if (selectError) throw selectError

      if (existing) {
        const { error: updateError } = await admin
          .from('platform_capital_defaults')
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (updateError) throw updateError
        log(`✅ Platform capital defaults updated with live values (perTrade=₹${c.perTrade}, maxPositions=${c.maxPositions})`)
      } else {
        const { error: insertError } = await admin.from('platform_capital_defaults').insert(row)
        if (insertError) throw insertError
        log('✅ Platform capital defaults inserted with live values (table was empty)')
      }
      platformCapitalDefaults = row
    }
  } catch (err) {
    console.error('❌ STEP 3 (seedPlatformCapitalDefaults) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 4 — seedPlatformStrategies()
  // -------------------------------------------------------------------------
  try {
    const rows = strategyFile.strategies.map(s => {
      const params = { ...s.params }
      const overrides = STRATEGY_OVERRIDES[s.id]
      if (overrides) {
        for (const [key, newValue] of Object.entries(overrides)) {
          const oldValue = (params as Record<string, unknown>)[key]
          if (oldValue !== newValue) {
            log(`  override ${s.id}.params.${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)} (spec §9.4 V1 bug fix)`)
          }
          ;(params as Record<string, unknown>)[key] = newValue
        }
      }
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        active: s.active,
        published: true,
        color: s.color,
        scan_interval_min: s.scanIntervalMin,
        watchlist_keys: s.watchlist,
        params,
        exits: s.exits,
        gift_nifty_gate: s.giftNiftyGate,
      }
    })

    if (DRY_RUN) {
      log(`✅ [dry-run] Platform strategies would be seeded: ${rows.length} rows (${rows.map(r => r.id).join(', ')})`)
    } else {
      const { error } = await admin.from('platform_strategies').upsert(rows, { onConflict: 'id' })
      if (error) throw error
      log(`✅ Platform strategies seeded: ${rows.length} rows`)
    }
  } catch (err) {
    console.error('❌ STEP 4 (seedPlatformStrategies) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 5 — seedPlatformWatchlists()
  // -------------------------------------------------------------------------
  let totalWatchlistSymbols = 0
  try {
    const rows = validWatchlistEntries.map(([key, symbols]) => ({
      list_key: key,
      name: watchlistFile.meta[key]?.name ?? key,
      symbols,
    }))
    totalWatchlistSymbols = rows.reduce((sum, r) => sum + (r.symbols as unknown[]).length, 0)

    if (DRY_RUN) {
      log(`✅ [dry-run] Platform watchlists would be seeded: ${rows.length} lists, ${totalWatchlistSymbols} total symbols`)
    } else {
      const { error } = await admin.from('platform_watchlists').upsert(rows, { onConflict: 'list_key' })
      if (error) throw error
      log(`✅ Platform watchlists seeded: ${rows.length} lists, ${totalWatchlistSymbols} total symbols`)
    }
  } catch (err) {
    console.error('❌ STEP 5 (seedPlatformWatchlists) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 6 — seedPlatformPivotalLists()
  // -------------------------------------------------------------------------
  let totalPivotalEntries = 0
  try {
    const rows = Object.entries(pivotalListsFile.lists).map(([key, entries]) => ({
      list_id: key,
      name: pivotalListsFile.meta[key]?.name ?? key,
      entries,
    }))
    totalPivotalEntries = rows.reduce((sum, r) => sum + (r.entries as unknown[]).length, 0)

    if (DRY_RUN) {
      log(`✅ [dry-run] Platform pivotal lists would be seeded: ${totalPivotalEntries} entries across ${rows.length} list(s)`)
    } else {
      const { error } = await admin.from('platform_pivotal_lists').upsert(rows, { onConflict: 'list_id' })
      if (error) throw error
      log(`✅ Platform pivotal lists seeded: ${totalPivotalEntries} entries`)
    }
  } catch (err) {
    console.error('❌ STEP 6 (seedPlatformPivotalLists) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 7 — seedDailyCloses() — largest step, batched in chunks of 500.
  // open/high/low default to null for the older pre-OHLC records.
  // -------------------------------------------------------------------------
  try {
    const rows: Array<{
      symbol: string
      trade_date: string
      open_price: number | null
      high_price: number | null
      low_price: number | null
      close_price: number
      volume: number
    }> = []
    for (const [symbol, records] of Object.entries(dailyClosesFile.closes)) {
      for (const r of records) {
        rows.push({
          symbol,
          trade_date: r.date,
          open_price: r.open ?? null,
          high_price: r.high ?? null,
          low_price: r.low ?? null,
          close_price: r.close,
          volume: r.volume,
        })
      }
    }
    const symbolCount = Object.keys(dailyClosesFile.closes).length

    if (DRY_RUN) {
      log(`✅ [dry-run] Daily closes would be seeded: ${symbolCount} symbols, ${rows.length} total rows (batches of 500)`)
    } else {
      const BATCH_SIZE = 500
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE)
        const { error } = await admin.from('daily_closes').upsert(batch, { onConflict: 'symbol,trade_date' })
        if (error) throw error
      }
      log(`✅ Daily closes seeded: ${symbolCount} symbols, ${rows.length} total rows`)
    }
  } catch (err) {
    console.error('❌ STEP 7 (seedDailyCloses) failed:', err)
    process.exit(1)
  }

  if (DRY_RUN) {
    log('\nDry run complete — steps 8-13 (accounts + customer setup) are skipped in dry-run mode.')
    return
  }

  // -------------------------------------------------------------------------
  // Shared helper for steps 8-10: create-or-find a Supabase Auth user, then
  // upsert its profiles row. Tries createUser() first; on an "already
  // exists" conflict, looks the existing user up via listUsers() instead of
  // skipping straight to a profiles-table lookup — matches the spec's
  // literal flow (conflict is detected at the auth layer, not the app layer).
  // -------------------------------------------------------------------------
  async function createOrFindAuthUser(email: string): Promise<string> {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
    })
    if (!createError && created.user) {
      return created.user.id
    }

    // Treat any create failure here as a possible "already exists" and look
    // the user up by email before giving up.
    const { data: listed, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 })
    if (listError) {
      throw new Error(`createUser failed (${createError?.message}) and listUsers also failed: ${listError.message}`)
    }
    const existing = listed.users.find(u => u.email === email)
    if (!existing) {
      throw new Error(`createUser failed (${createError?.message}) and no existing auth user found for ${email}`)
    }
    return existing.id
  }

  async function seedAccount(
    email: string,
    role: 'superadmin' | 'account_manager' | 'customer',
    fullName: string,
    assignedAccountManagerId?: string
  ): Promise<SeedAccountResult> {
    const id = await createOrFindAuthUser(email)
    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id,
        role,
        full_name: fullName,
        email,
        status: 'active',
        assigned_account_manager_id: assignedAccountManagerId ?? null,
      },
      { onConflict: 'id' }
    )
    if (profileError) throw profileError
    return { id, email }
  }

  // -------------------------------------------------------------------------
  // STEP 8 — createSuperAdminAccount()
  // -------------------------------------------------------------------------
  let superAdmin: SeedAccountResult
  try {
    superAdmin = await seedAccount('dinesh.k.wadhwani@gmail.com', 'superadmin', 'Dinesh Wadhwani')
    log('✅ SuperAdmin created: dinesh.k.wadhwani@gmail.com')
  } catch (err) {
    console.error('❌ STEP 8 (createSuperAdminAccount) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 9 — createAccountManagerAccount()
  // -------------------------------------------------------------------------
  let accountManager: SeedAccountResult
  try {
    accountManager = await seedAccount('dinesh_wadhwani@yahoo.com', 'account_manager', 'Dinesh Wadhwani (AM)')
    log('✅ Account Manager created: dinesh_wadhwani@yahoo.com')
  } catch (err) {
    console.error('❌ STEP 9 (createAccountManagerAccount) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 10 — createTestCustomerAccount()
  // -------------------------------------------------------------------------
  let testCustomer: SeedAccountResult
  try {
    testCustomer = await seedAccount(
      'wadhwani_dinesh@hotmail.com',
      'customer',
      'Wadhwani Dinesh',
      accountManager!.id
    )
    log('✅ Test Customer created: wadhwani_dinesh@hotmail.com')
  } catch (err) {
    console.error('❌ STEP 10 (createTestCustomerAccount) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 11 — copyPlatformTemplatesToCustomer()
  // -------------------------------------------------------------------------
  let copiedStrategyCount = 0
  let copiedWatchlistCount = 0
  try {
    const { data: templates, error: templatesError } = await admin
      .from('platform_strategies')
      .select('id, name, type, color, scan_interval_min, watchlist_keys, params, exits, gift_nifty_gate')
      .eq('published', true)
    if (templatesError) throw templatesError

    const strategyRows = (templates ?? []).map(t => ({
      customer_id: testCustomer!.id,
      platform_strategy_id: t.id,
      name: t.name,
      type: t.type,
      active: false,
      color: t.color,
      scan_interval_min: t.scan_interval_min,
      watchlist_keys: t.watchlist_keys,
      params: t.params,
      exits: t.exits,
      gift_nifty_gate: t.gift_nifty_gate,
    }))
    const { error: strategyUpsertError } = await admin
      .from('customer_strategies')
      .upsert(strategyRows, { onConflict: 'customer_id,name' })
    if (strategyUpsertError) throw strategyUpsertError
    copiedStrategyCount = strategyRows.length

    const { data: watchlists, error: watchlistsError } = await admin
      .from('platform_watchlists')
      .select('list_key, name, symbols')
    if (watchlistsError) throw watchlistsError

    const watchlistRows = (watchlists ?? []).map(w => ({
      customer_id: testCustomer!.id,
      list_key: w.list_key,
      name: w.name,
      symbols: w.symbols,
    }))
    const { error: watchlistUpsertError } = await admin
      .from('customer_watchlists')
      .upsert(watchlistRows, { onConflict: 'customer_id,list_key' })
    if (watchlistUpsertError) throw watchlistUpsertError
    copiedWatchlistCount = watchlistRows.length

    log(`✅ Platform templates copied to test customer: ${copiedStrategyCount} strategies, ${copiedWatchlistCount} watchlists`)
  } catch (err) {
    console.error('❌ STEP 11 (copyPlatformTemplatesToCustomer) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 12 — createCustomerCapitalConfig() + customer_state
  // -------------------------------------------------------------------------
  try {
    if (!platformCapitalDefaults) throw new Error('platformCapitalDefaults was not loaded in Step 3')
    const capitalRow = {
      customer_id: testCustomer!.id,
      per_trade: platformCapitalDefaults.per_trade,
      max_buys_per_day: platformCapitalDefaults.max_buys_per_day,
      max_sells_per_day: platformCapitalDefaults.max_sells_per_day,
      max_positions: platformCapitalDefaults.max_positions,
      max_buys_per_symbol: platformCapitalDefaults.max_buys_per_symbol,
      min_drop_between_buys_pct: platformCapitalDefaults.min_drop_between_buys_pct,
      max_deploy_pct: platformCapitalDefaults.max_deploy_pct,
      delivery_dp_charge: platformCapitalDefaults.delivery_dp_charge,
      circuit_breaker_pct: platformCapitalDefaults.circuit_breaker_pct,
      intraday_circuit_trip_pct: platformCapitalDefaults.intraday_circuit_trip_pct,
      intraday_circuit_resume_pct: platformCapitalDefaults.intraday_circuit_resume_pct,
      panic_drop_pct: platformCapitalDefaults.panic_drop_pct,
      panic_window_min: platformCapitalDefaults.panic_window_min,
    }
    const { error: capitalError } = await admin
      .from('customer_capital_config')
      .upsert(capitalRow, { onConflict: 'customer_id' })
    if (capitalError) throw capitalError

    const { error: stateError } = await admin
      .from('customer_state')
      .upsert({ customer_id: testCustomer!.id, cron_mode: 'manual' }, { onConflict: 'customer_id' })
    if (stateError) throw stateError

    log('✅ Customer capital config and state initialised')
  } catch (err) {
    console.error('❌ STEP 12 (createCustomerCapitalConfig) failed:', err)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // STEP 13 — printSummary()
  // -------------------------------------------------------------------------
  const watchlistCount = validWatchlistEntries.length
  const dailyCloseRowCount = Object.values(dailyClosesFile.closes).reduce((sum, arr) => sum + arr.length, 0)

  log('\n┌─────────────────────────────────────────┐')
  log('│  DAlgo Migration Complete                │')
  log('├─────────────────────────────────────────┤')
  log(`│  Platform strategies    ${String(strategyFile.strategies.length).padEnd(17)}│`)
  log(`│  Platform watchlists    ${String(watchlistCount).padEnd(17)}│`)
  log(`│  Daily closes           ${String(dailyCloseRowCount + ' rows').padEnd(17)}│`)
  log(`│  SuperAdmin             ${superAdmin!.email.slice(0, 17).padEnd(17)}│`)
  log(`│  Account Manager        ${accountManager!.email.slice(0, 17).padEnd(17)}│`)
  log(`│  Test Customer          ${testCustomer!.email.slice(0, 17).padEnd(17)}│`)
  log(`│  Customer strategies    ${String(copiedStrategyCount).padEnd(17)}│`)
  log(`│  Customer watchlists    ${String(copiedWatchlistCount).padEnd(17)}│`)
  log('└─────────────────────────────────────────┘')
  log('')
  log('Login at http://localhost:3000/login')
  log(`SuperAdmin:       ${superAdmin!.email} / ${SEED_PASSWORD}`)
  log(`Account Manager:  ${accountManager!.email} / ${SEED_PASSWORD}`)
  log(`Test Customer:    ${testCustomer!.email} / ${SEED_PASSWORD}`)
  log('\nMigration complete.')
}

main().catch(err => {
  console.error('Fatal (uncaught, outside any numbered step):', err)
  process.exit(1)
})
