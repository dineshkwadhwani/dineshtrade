import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { sendAccountActivated } from '@/lib/email'

// Reads the session cookie via requireRole()/getSession() (lib/dalgoAuth.ts,
// next/headers cookies()) on every request — force-dynamic makes that
// explicit instead of relying on Next's implicit dynamic-usage detection,
// which only fires (and only gets a chance to fall back gracefully) for
// static-path GET routes probed during the build's static-generation pass;
// this route is either a non-GET method or otherwise not guaranteed to hit
// that same path, so making it explicit removes the ambiguity outright.
export const dynamic = 'force-dynamic'

// POST /api/dalgo/admin/customers/[id]/activate — Task 6.5 (Step 2, spec
// §4.5). SuperAdmin can activate any customer; an Account Manager only one
// assigned to them.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole(['superadmin', 'account_manager'])
    const admin = getSupabaseAdmin()

    const { data: customer, error: customerError } = await admin
      .from('profiles')
      .select('id, full_name, email, role, status, assigned_account_manager_id')
      .eq('id', params.id)
      .eq('role', 'customer')
      .maybeSingle()
    if (customerError || !customer) {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })
    }
    if (actor.role === 'account_manager' && customer.assigned_account_manager_id !== actor.id) {
      return NextResponse.json({ error: 'This customer is not assigned to you.' }, { status: 403 })
    }
    if (customer.status !== 'identity_verified' && customer.status !== 'broker_setup_complete') {
      return NextResponse.json(
        { error: `Customer must have completed broker setup to activate (current status: ${customer.status}).` },
        { status: 400 }
      )
    }

    const { data: registration } = await admin
      .from('registrations')
      .select('id')
      .eq('profile_id', params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: instance } = await admin
      .from('customer_instances')
      .select('subdomain, instance_url')
      .eq('customer_id', params.id)
      .maybeSingle()

    const now = new Date().toISOString()
    const { error: profileUpdateError } = await admin
      .from('profiles')
      .update({ status: 'active', updated_at: now })
      .eq('id', params.id)
    let registrationUpdateError: { message: string } | null = null
    if (registration) {
      const { error } = await admin
        .from('registrations')
        .update({ step2_activated_at: now, step2_activated_by: actor.id, updated_at: now })
        .eq('id', registration.id)
      registrationUpdateError = error
    }
    if (profileUpdateError || registrationUpdateError) {
      return NextResponse.json({ error: 'Failed to activate customer.' }, { status: 500 })
    }

    // Seed any published platform strategy templates the customer doesn't have yet
    const { data: templates } = await admin
      .from('platform_strategies')
      .select('*')
      .eq('published', true)
    const { data: existingStrats } = await admin
      .from('customer_strategies')
      .select('strategy_key')
      .eq('customer_id', params.id)
    const existingKeys = new Set((existingStrats ?? []).map(s => s.strategy_key))
    const missing = (templates ?? []).filter(t => !existingKeys.has(t.id))
    for (const t of missing) {
      const { error: upsertErr } = await admin.from('customer_strategies').upsert({
        customer_id: params.id,
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
        updated_at: now,
      }, { onConflict: 'customer_id,name' })
      if (upsertErr) console.error(`[activate] seed strategy ${t.name} failed:`, upsertErr.message)
    }
    if (missing.length > 0)
      console.log(`[activate] seeded ${missing.length} missing strategy template(s) for ${customer.full_name}`)

    // Seed any platform watchlists the customer doesn't have yet
    const { data: platformLists } = await admin.from('platform_watchlists').select('list_key, name, symbols')
    const { data: existingWatchlists } = await admin
      .from('customer_watchlists').select('list_key').eq('customer_id', params.id)
    const existingListKeys = new Set((existingWatchlists ?? []).map(w => w.list_key))
    const missingLists = (platformLists ?? []).filter(l => !existingListKeys.has(l.list_key))
    for (const list of missingLists) {
      const { error: wErr } = await admin.from('customer_watchlists').upsert({
        customer_id: params.id, list_key: list.list_key, name: list.name,
        symbols: list.symbols, updated_at: now,
      }, { onConflict: 'customer_id,list_key' })
      if (wErr) console.error(`[activate] seed watchlist ${list.list_key} failed:`, wErr.message)
    }
    if (missingLists.length > 0)
      console.log(`[activate] seeded ${missingLists.length} missing watchlist(s) for ${customer.full_name}`)

    // Seed capital config — use platform defaults if set, otherwise fall back to DB column defaults
    const { data: existingCapital } = await admin
      .from('customer_capital_config')
      .select('id')
      .eq('customer_id', params.id)
      .maybeSingle()
    if (!existingCapital) {
      const { data: capitalDefaultRow } = await admin
        .from('platform_config')
        .select('value')
        .eq('key', 'PLATFORM_CAPITAL_DEFAULTS')
        .maybeSingle()
      let capitalOverrides: Record<string, unknown> = {}
      if (capitalDefaultRow?.value) {
        try { capitalOverrides = JSON.parse(capitalDefaultRow.value) } catch {}
      }
      const { error: capErr } = await admin
        .from('customer_capital_config')
        .insert({ customer_id: params.id, ...capitalOverrides })
      if (capErr) console.error(`[activate] seed capital config failed:`, capErr.message)
      else console.log(`[activate] seeded capital config for ${customer.full_name}`)
    }

    await writeAuditLog({
      actor,
      action: 'customer.activate',
      targetType: 'customer',
      targetId: params.id,
      targetName: customer.full_name,
      before: { status: customer.status },
      after: { status: 'active' },
    })

    const instanceUrl = instance?.instance_url ?? (instance?.subdomain ? `https://${instance.subdomain}.dalgo.online` : 'https://www.dalgo.online')
    sendAccountActivated(customer.email, customer.full_name, instanceUrl).catch(err =>
      console.error('[customers/activate] sendAccountActivated failed:', err)
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[customers/activate] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
