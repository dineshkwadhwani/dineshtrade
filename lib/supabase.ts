// Supabase clients for DAlgo.
//
// Two exports:
//   - getSupabaseAdmin() — service-role client. Full DB access, bypasses RLS.
//     SERVER-ONLY (API routes, cron). Lazily instantiated on first call so this
//     module can still be safely imported by client-side code that only needs
//     supabaseAnon — the admin path never runs unless something actually calls
//     getSupabaseAdmin(), and it throws immediately if that ever happens in a
//     browser context.
//   - supabaseAnon — anon-key client. Respects RLS. Safe to import from either
//     server or client ('use client') code, e.g. Supabase Auth sign-in flows.
//
// Every customer-scoped read/write through the admin client MUST filter by
// customer_id — RLS is bypassed here, there is no other safety net.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// TODO: once `supabase gen types typescript` is run against the live schema,
// import the generated Database type and use createClient<Database>(...) for
// both clients below instead of the untyped SupabaseClient.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_KEY

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`[lib/supabase] Missing required env var: ${name}`)
  }
  return value
}

// ---- Anon client (anon key — respects RLS) ------------------------------
// Instantiated eagerly: both env vars are NEXT_PUBLIC_-prefixed, so this is
// safe to create in any bundle (browser or server).
export const supabaseAnon: SupabaseClient = createClient(
  requireEnv(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv(anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
)

// ---- Admin client (service role — bypasses RLS) --------------------------
// NEVER instantiate this eagerly at module scope: SUPABASE_SERVICE_KEY has no
// NEXT_PUBLIC_ variant on purpose, so in a browser bundle it evaluates to
// `undefined` — an eager `createClient(url, undefined)` at import time would
// throw and take the whole module (including supabaseAnon) down with it for
// any client component that only wanted the anon client. Lazy + guarded avoids
// that failure mode while still refusing to ever run in a browser context.
let cachedAdmin: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[lib/supabase] getSupabaseAdmin() was called in a browser context. ' +
        'The service-role key must never be used client-side — use supabaseAnon instead.'
    )
  }
  if (!cachedAdmin) {
    cachedAdmin = createClient(
      requireEnv(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL'),
      requireEnv(serviceKey, 'SUPABASE_SERVICE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
  }
  return cachedAdmin
}
