#!/usr/bin/env node
/* Fetch audit_log rows for a given IST date and print plain-text summary.
   Usage:
     NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_KEY=<service-key> node scripts/fetch-audit-day.js 2026-08-25
*/
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const dateArg = process.argv[2]
  if (!dateArg) {
    console.error('Usage: node scripts/fetch-audit-day.js YYYY-MM-DD')
    process.exit(2)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment')
    process.exit(2)
  }

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  // Build IST-day range (local business logic uses +05:30 offset)
  const start = new Date(dateArg + 'T00:00:00+05:30').toISOString()
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString()

  try {
    const { data, error } = await admin
      .from('audit_log')
      .select('*')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: true })

    if (error) throw error

    if (!data || data.length === 0) {
      console.log(`No audit events found for ${dateArg}`)
      return
    }

    for (const row of data) {
      const ts = row.created_at || row.ts || row.inserted_at || '(no-ts)'
      const actor = `${row.actor_name || row.actor_id || '(unknown)'} (${row.actor_role || 'unknown'})`
      const action = row.action || '(unknown)'
      const target = row.target_name || row.target_id || row.target_type || '(unknown)'
      const before = row.before_value ? JSON.stringify(row.before_value) : ''
      const after = row.after_value ? JSON.stringify(row.after_value) : ''
      const notes = row.notes || ''
      console.log(`${ts}  • ${actor}  • ${action}  • ${target}`)
      if (before || after) console.log(`    → ${before} => ${after}`)
      if (notes) console.log(`    notes: ${notes}`)
    }
  } catch (err) {
    console.error('Failed to fetch audit_log:', String(err).slice(0, 400))
    process.exit(1)
  }
}

main()
