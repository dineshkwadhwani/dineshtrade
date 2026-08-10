// One-time cleanup: deletes every non-superadmin auth user from Supabase,
// leaving only the SuperAdmin account. Run before going live with real users.
//
// Run:
//   npx ts-node --project tsconfig.json scripts/reset-for-production.ts
//   npx ts-node --project tsconfig.json scripts/reset-for-production.ts --dry-run
//
// After confirming the output is correct, delete this file — it's a one-shot tool.

import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'

const DRY_RUN = process.argv.includes('--dry-run')

async function main(): Promise<void> {
  console.log(DRY_RUN ? '=== reset-for-production — DRY RUN ===\n' : '=== reset-for-production ===\n')

  process.env.DOTENV_CONFIG_QUIET = 'true'
  loadEnv({ path: resolve(process.cwd(), '.env.local') })
  const { getSupabaseAdmin } = await import('../lib/supabase')
  const admin = getSupabaseAdmin()

  // Read all profiles — non-superadmin rows are the candidates for deletion
  const { data: profiles, error: profilesErr } = await admin
    .from('profiles')
    .select('id, email, role')

  if (profilesErr) {
    console.error('Failed to fetch profiles:', profilesErr.message)
    process.exit(1)
  }

  const toDelete = profiles.filter((p: { id: string; email: string; role: string }) => p.role !== 'superadmin')
  const toKeep   = profiles.filter((p: { id: string; email: string; role: string }) => p.role === 'superadmin')

  console.log(`Found ${profiles.length} profile(s) total.`)
  console.log(`Keeping ${toKeep.length} superadmin(s):`)
  toKeep.forEach((p: { id: string; email: string; role: string }) => console.log(`  ✓ ${p.email} (${p.role}) — ${p.id}`))

  if (toDelete.length === 0) {
    console.log('\nNothing to delete — only superadmin account(s) exist.')
    process.exit(0)
  }

  console.log(`\nDeleting ${toDelete.length} non-superadmin profile(s):`)

  for (const profile of toDelete as { id: string; email: string; role: string }[]) {
    console.log(`  → ${profile.email} (${profile.role}) — ${profile.id}`)
    if (!DRY_RUN) {
      // Deleting the auth user cascades to the profiles row via FK
      const { error } = await admin.auth.admin.deleteUser(profile.id)
      if (error) {
        console.error(`    ✗ Failed: ${error.message}`)
      } else {
        console.log(`    ✓ Deleted`)
      }
    }
  }

  if (DRY_RUN) {
    console.log('\n(DRY RUN — no changes made)')
    process.exit(0)
  }

  // Verify final state
  const { data: remaining, error: verifyErr } = await admin
    .from('profiles')
    .select('id, email, role')

  if (verifyErr) {
    console.error('\nVerification query failed:', verifyErr.message)
    process.exit(1)
  }

  console.log(`\nVerification: ${remaining.length} profile(s) remaining:`)
  remaining.forEach((p: { id: string; email: string; role: string }) =>
    console.log(`  ${p.role === 'superadmin' ? '✓' : '⚠'} ${p.email} (${p.role})`)
  )

  if (remaining.length === 1 && remaining[0].role === 'superadmin') {
    console.log('\n✅ Clean — only the SuperAdmin account remains.')
  } else {
    console.log('\n⚠️  Unexpected state — review the profiles table manually.')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
