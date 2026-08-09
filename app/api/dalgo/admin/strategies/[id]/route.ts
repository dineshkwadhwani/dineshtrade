import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { sendStrategyUpdated } from '@/lib/email'

// Reads the session cookie via requireRole()/getSession() (lib/dalgoAuth.ts,
// next/headers cookies()) on every request — force-dynamic makes that
// explicit instead of relying on Next's implicit dynamic-usage detection,
// which only fires (and only gets a chance to fall back gracefully) for
// static-path GET routes probed during the build's static-generation pass;
// this route is either a non-GET method or otherwise not guaranteed to hit
// that same path, so making it explicit removes the ambiguity outright.
export const dynamic = 'force-dynamic'

// PUT /api/dalgo/admin/strategies/[id] — Task 6.9, spec §7.5.
// SuperAdmin only. Edits a platform strategy template's params/exits/
// gift_nifty_gate, then pushes the same values onto every customer's own
// copy that is currently `active=true` for this template (customer_strategies
// where platform_strategy_id = id), and emails each affected customer.
// Inactive copies are left untouched — spec §7.6 gives those a manual "Reset
// to platform template" button instead of a forced push.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => ({}))
    if (body.params === undefined || body.exits === undefined) {
      return NextResponse.json({ error: 'params and exits are required.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const { data: strategy, error: strategyError } = await admin
      .from('platform_strategies')
      .select('id, name, params, exits, gift_nifty_gate')
      .eq('id', params.id)
      .maybeSingle()
    if (strategyError || !strategy) {
      return NextResponse.json({ error: 'Strategy not found.' }, { status: 404 })
    }

    const giftNiftyGate = body.giftNiftyGate !== undefined ? body.giftNiftyGate : strategy.gift_nifty_gate
    const now = new Date().toISOString()

    const { error: updateError } = await admin
      .from('platform_strategies')
      .update({ params: body.params, exits: body.exits, gift_nifty_gate: giftNiftyGate, updated_at: now })
      .eq('id', params.id)
    if (updateError) {
      return NextResponse.json({ error: 'Failed to update strategy.' }, { status: 500 })
    }

    // Push to every customer's active copy of this template.
    const { data: activeCopies } = await admin
      .from('customer_strategies')
      .select('id, customer_id')
      .eq('platform_strategy_id', params.id)
      .eq('active', true)

    let affectedCount = 0
    if (activeCopies && activeCopies.length > 0) {
      const { error: pushError } = await admin
        .from('customer_strategies')
        .update({ params: body.params, exits: body.exits, gift_nifty_gate: giftNiftyGate, updated_at: now })
        .eq('platform_strategy_id', params.id)
        .eq('active', true)
      if (!pushError) {
        affectedCount = activeCopies.length
        const { data: customers } = await admin
          .from('profiles')
          .select('email, full_name')
          .in('id', activeCopies.map(c => c.customer_id))
        for (const customer of customers ?? []) {
          sendStrategyUpdated(customer.email, strategy.name).catch(err =>
            console.error('[strategies/update] sendStrategyUpdated failed:', err)
          )
        }
      } else {
        console.error('[strategies/update] failed to push to customer copies:', pushError.message)
      }
    }

    await writeAuditLog({
      actor,
      action: 'platform_strategy.update',
      targetType: 'platform_strategies',
      targetId: strategy.id,
      targetName: strategy.name,
      before: { params: strategy.params, exits: strategy.exits, gift_nifty_gate: strategy.gift_nifty_gate },
      after: { params: body.params, exits: body.exits, gift_nifty_gate: giftNiftyGate, affectedCustomers: affectedCount },
    })

    return NextResponse.json({ ok: true, affectedCustomers: affectedCount })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[strategies/update] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
