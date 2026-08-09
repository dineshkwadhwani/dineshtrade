import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

// DELETE /api/dalgo/admin/watchlists/[key]/symbols/[nse] — Task 6.15.
// SuperAdmin only.
export async function DELETE(_req: NextRequest, { params }: { params: { key: string; nse: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const nse = decodeURIComponent(params.nse).toUpperCase()

    const admin = getSupabaseAdmin()
    const { data: watchlist, error: watchlistError } = await admin
      .from('platform_watchlists')
      .select('id, list_key, name, symbols')
      .eq('list_key', params.key)
      .maybeSingle()
    if (watchlistError || !watchlist) {
      return NextResponse.json({ error: 'Watchlist not found.' }, { status: 404 })
    }

    const symbols = Array.isArray(watchlist.symbols) ? watchlist.symbols : []
    const nextSymbols = symbols.filter((s: any) => s.nse !== nse)
    if (nextSymbols.length === symbols.length) {
      return NextResponse.json({ error: `${nse} is not in this watchlist.` }, { status: 404 })
    }

    const { error: updateError } = await admin
      .from('platform_watchlists')
      .update({ symbols: nextSymbols, updated_at: new Date().toISOString() })
      .eq('list_key', params.key)
    if (updateError) {
      return NextResponse.json({ error: 'Failed to remove symbol.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_watchlist.remove_symbol',
      targetType: 'platform_watchlists',
      targetId: watchlist.list_key,
      targetName: watchlist.name,
      before: { symbolCount: symbols.length },
      after: { removed: nse, symbolCount: nextSymbols.length },
    })

    return NextResponse.json({ ok: true, symbols: nextSymbols })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[watchlists/symbols/remove] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
