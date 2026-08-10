import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// PATCH /api/dalgo/customer/watchlist
// action: 'add' — adds { nse, name } to the list; 'remove' — removes by nse
export async function PATCH(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const action = body.action as 'add' | 'remove' | 'reset'
    const listKey = typeof body.listKey === 'string' ? body.listKey.trim() : ''
    const nse = typeof body.nse === 'string' ? body.nse.trim().toUpperCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : nse

    if (!listKey || !['add', 'remove', 'reset'].includes(action)) {
      return NextResponse.json({ error: 'action and listKey are required.' }, { status: 400 })
    }
    if ((action === 'add' || action === 'remove') && !nse) {
      return NextResponse.json({ error: 'nse is required for add/remove.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    // Admins can act on behalf of a customer via body.targetCustomerId
    const effectiveCustomerId = (['superadmin', 'account_manager'] as string[]).includes(profile.role) && body.targetCustomerId
      ? body.targetCustomerId as string
      : profile.id
    if (action === 'reset') {
      const { data: platform } = await admin.from('platform_watchlists').select('symbols').eq('list_key', listKey).maybeSingle()
      if (!platform) return NextResponse.json({ error: 'Platform watchlist not found.' }, { status: 404 })
      await admin.from('customer_watchlists').upsert({
        customer_id: effectiveCustomerId, list_key: listKey,
        name: listKey, symbols: platform.symbols, updated_at: new Date().toISOString(),
      }, { onConflict: 'customer_id,list_key' })
      return NextResponse.json({ ok: true, count: Array.isArray(platform.symbols) ? platform.symbols.length : 0 })
    }
    const { data: row, error: fetchErr } = await admin
      .from('customer_watchlists')
      .select('id, symbols')
      .eq('customer_id', effectiveCustomerId)
      .maybeSingle()

    if (fetchErr) return NextResponse.json({ error: 'Failed to load watchlist.' }, { status: 500 })

    let symbols: { nse: string; name: string }[] = Array.isArray(row?.symbols) ? row.symbols : []

    if (action === 'add') {
      if (symbols.some(s => s.nse === nse)) {
        return NextResponse.json({ error: `${nse} is already in ${listKey}.` }, { status: 409 })
      }
      symbols = [...symbols, { nse, name }]
    } else {
      symbols = symbols.filter(s => s.nse !== nse)
    }

    if (row) {
      await admin.from('customer_watchlists').update({ symbols, updated_at: new Date().toISOString() }).eq('id', row.id)
    } else if (action === 'add') {
      await admin.from('customer_watchlists').insert({ customer_id: effectiveCustomerId, list_key: listKey, name: listKey, symbols, updated_at: new Date().toISOString() })
    }

    return NextResponse.json({ ok: true, count: symbols.length })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[customer/watchlist] error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
