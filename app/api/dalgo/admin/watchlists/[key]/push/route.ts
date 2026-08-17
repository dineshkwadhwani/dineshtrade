import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// POST /api/dalgo/admin/watchlists/[key]/push
// SA or AM. Copies platform watchlist symbols into customer_watchlists for
// one customer or all. Body: { targetCustomerId?: string }
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  try {
    const actor = await requireRole(['superadmin', 'account_manager'])
    const body = await req.json().catch(() => ({}))
    const targetCustomerId = typeof body.targetCustomerId === 'string' ? body.targetCustomerId : null

    const admin = getSupabaseAdmin()

    const { data: watchlist, error: wlErr } = await admin
      .from('platform_watchlists')
      .select('list_key, name, symbols')
      .eq('list_key', params.key)
      .maybeSingle()
    if (wlErr || !watchlist) {
      return NextResponse.json({ error: 'Watchlist not found.' }, { status: 404 })
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
    // Upsert customer_watchlists for each target — creates row if absent
    const upsertRows = customerIds.map(customerId => ({
      customer_id: customerId,
      list_key: watchlist.list_key,
      name: watchlist.name,
      symbols: watchlist.symbols,
      updated_at: now,
    }))

    const { error: upsertErr } = await admin
      .from('customer_watchlists')
      .upsert(upsertRows, { onConflict: 'customer_id,list_key' })
    if (upsertErr) {
      return NextResponse.json({ error: 'Push failed: ' + upsertErr.message }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_watchlist.push',
      targetType: 'platform_watchlists',
      targetId: watchlist.list_key,
      targetName: watchlist.name,
      before: {},
      after: { targetCustomerId: targetCustomerId ?? 'all', affectedCustomers: customerIds.length, symbolCount: (watchlist.symbols as any[]).length },
    })

    return NextResponse.json({ ok: true, affectedCustomers: customerIds.length })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[watchlists/push] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
