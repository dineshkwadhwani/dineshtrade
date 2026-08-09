// One-time (idempotent, re-runnable) setup: creates the Supabase Storage
// bucket used for Aadhar KYC uploads (Phase 3 — Registration and Onboarding).
//
// Run:
//   npx ts-node --project tsconfig.json scripts/setup-storage.ts
//
// Same dotenv + dynamic-import pattern as scripts/migrate-to-supabase.ts —
// see that file's header comment for why lib/supabase.ts is imported
// dynamically (inside main(), after dotenv has run) rather than statically.
//
// IMPORTANT — what this script can and cannot do:
//   1. Creates the private 'kyc-documents' bucket with a MIME allowlist and
//      a 5MB size cap. This part uses the Supabase JS SDK's storage API
//      directly (admin.storage.createBucket()) and is fully automated.
//   2. Storage access control ("only service role can read/write") is NOT
//      something the JS SDK can create — `storage.objects` policies are
//      Postgres row-level-security rules, settable only via raw SQL (the
//      Supabase SQL editor, or a migration), not through supabase-js. A
//      *private* bucket with zero storage.objects policies already means
//      anon/authenticated callers get nothing (RLS denies by default) and
//      only the service-role key (which bypasses RLS entirely, same as
//      getSupabaseAdmin() does for the profiles table) can touch it — so
//      the security goal is already met without any policy at all. Even so,
//      this script PRINTS an explicit deny-by-default policy block (and the
//      same block has been appended to docs/DALGO_SUPABASE_SCHEMA_v2.sql
//      alongside the other RLS policies) so the intent is auditable in the
//      schema rather than merely implicit. Run that SQL manually in the
//      Supabase SQL editor — this script cannot execute arbitrary SQL itself.

import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'

const BUCKET_ID = 'kyc-documents'
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const FILE_SIZE_LIMIT = 5242880 // 5MB

const STORAGE_POLICY_SQL = `
-- KYC documents bucket: explicit deny-by-default, service-role-only access.
-- Redundant with "private bucket + zero policies" (RLS already denies
-- anon/authenticated by default), but kept explicit and auditable alongside
-- the other RLS policies in this file. Run manually in the Supabase SQL
-- editor — supabase-js has no API to create storage.objects policies.
create policy "kyc_documents_service_role_select" on storage.objects
  for select using (bucket_id = '${BUCKET_ID}' and auth.role() = 'service_role');
create policy "kyc_documents_service_role_insert" on storage.objects
  for insert with check (bucket_id = '${BUCKET_ID}' and auth.role() = 'service_role');
create policy "kyc_documents_service_role_update" on storage.objects
  for update using (bucket_id = '${BUCKET_ID}' and auth.role() = 'service_role');
create policy "kyc_documents_service_role_delete" on storage.objects
  for delete using (bucket_id = '${BUCKET_ID}' and auth.role() = 'service_role');
`.trim()

function log(msg: string): void {
  console.log(msg)
}

async function main(): Promise<void> {
  log('=== DAlgo KYC storage bucket setup ===\n')

  loadEnv({ path: resolve(process.cwd(), '.env.local') })
  const { getSupabaseAdmin } = await import('../lib/supabase')
  const admin = getSupabaseAdmin()

  // -------------------------------------------------------------------------
  // STEP 1 — create the private bucket (idempotent: if it already exists,
  // verify its config instead of failing the whole run).
  // -------------------------------------------------------------------------
  const { error: createError } = await admin.storage.createBucket(BUCKET_ID, {
    public: false,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
    fileSizeLimit: FILE_SIZE_LIMIT,
  })

  if (createError) {
    const alreadyExists = /already exists/i.test(createError.message)
    if (!alreadyExists) {
      console.error('❌ STEP 1 (createBucket) failed:', createError.message)
      process.exit(1)
    }
    log(`⚠ Bucket '${BUCKET_ID}' already exists — verifying its config instead of re-creating`)
    const { data: existing, error: getError } = await admin.storage.getBucket(BUCKET_ID)
    if (getError || !existing) {
      console.error('❌ STEP 1 (getBucket) failed while verifying existing bucket:', getError?.message)
      process.exit(1)
    }
    if (existing.public) {
      console.error(`❌ Bucket '${BUCKET_ID}' exists but is PUBLIC — expected private. Fix manually in the Supabase dashboard.`)
      process.exit(1)
    }
    log(`✅ Bucket '${BUCKET_ID}' verified (private, id=${existing.id})`)
  } else {
    log(`✅ Bucket '${BUCKET_ID}' created (private, MIME allowlist: ${ALLOWED_MIME_TYPES.join(', ')}, max ${FILE_SIZE_LIMIT} bytes)`)
  }

  // -------------------------------------------------------------------------
  // STEP 2 — storage.objects RLS policy: cannot be created via supabase-js.
  // Print it for manual application (also persisted in
  // docs/DALGO_SUPABASE_SCHEMA_v2.sql — see this file's header comment).
  // -------------------------------------------------------------------------
  log('\n⚠ MANUAL STEP REQUIRED — run this in the Supabase SQL editor:\n')
  log(STORAGE_POLICY_SQL)
  log('\n(This block is also saved in docs/DALGO_SUPABASE_SCHEMA_v2.sql for reference.)')

  log('\n=== Done ===')
}

main().catch(err => {
  console.error('❌ Unexpected error:', err)
  process.exit(1)
})
