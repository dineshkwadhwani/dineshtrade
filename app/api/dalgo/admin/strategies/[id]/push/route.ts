import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { sendStrategyUpdated } from '@/lib/email'

export const dynamic = 'force-dynamic'

// POST /api/dalgo/admin/strategies/[id]/push
// SA or AM. Pushes platform strategy params/exits/gate to one customer or all.
// Body: { targetCustomerId?: string }  — omit for all customers.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole(['superadmin', 'account_manager'])
    const body = await req.json().catch(() => ({}))
    const targetCustomerId = typeof body.targetCustomerId === 'string' ? body.targetCustomerId : null

    const admin = getSupabaseAdmin()

    const { data: strategy, error: stratErr } = await admin
      .from('platform_strategies')
      .select('id, name, params, exits, gift_nifty_gate')
      .eq('id', params.id)
      .maybeSingle()
    if (stratErr || !strategy) {
      return NextResponse.json({ error: 'Strategy not found.' }, { status: 404 })
    }

    // Resolve target customers
    let customerIds: string[]
    if (targetCustomerId) {
      customerIds = [targetCustomerId]
    } else {
      const { data: all } = await admin
        .from('profiles')
        .select('id')
        .eq('role', 'customer')
        .eq('status', 'active')
      customerIds = (all ?? []).map((r: any) => r.id as string)
    }
    if (customerIds.length === 0) {
      return NextResponse.json({ ok: true, affectedCustomers: 0 })
    }

    const now = new Date().toISOString()
    const pushPayload = {
      params: strategy.params,
      exits: strategy.exits,
      gift_nifty_gate: strategy.gift_nifty_gate,
      updated_at: now,
    }

    // Update existing customer_strategies rows that reference this template
    const { data: existing } = await admin
      .from('customer_strategies')
      .select('id, customer_id')
      .eq('platform_strategy_id', params.id)
      .in('customer_id', customerIds)

    let affectedCount = 0
    if (existing && existing.length > 0) {
      await admin
        .from('customer_strategies')
        .update(pushPayload)
        .in('id', existing.map((r: any) => r.id))
      affectedCount = existing.length

      // Notify affected customers
      const affectedCustomerIds = existing.map((r: any) => r.customer_id as string)
      const { data: profiles } = await admin
        .from('profiles')
        .select('email, full_name')
        .in('id', affectedCustomerIds)
      for (const p of profiles ?? []) {
        sendStrategyUpdated(p.email, strategy.name).catch(() => {})
      }
    }

    await writeAuditLog({
      actor,
      action: 'platform_strategy.push',
      targetType: 'platform_strategies',
      targetId: strategy.id,
      targetName: strategy.name,
      before: {},
      after: { targetCustomerId: targetCustomerId ?? 'all', affectedCustomers: affectedCount },
    })

    return NextResponse.json({ ok: true, affectedCustomers: affectedCount })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[strategies/push] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
