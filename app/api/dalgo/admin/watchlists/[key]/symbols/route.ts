import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

// Reads the session cookie via requireRole()/getSession() (lib/dalgoAuth.ts,
// next/headers cookies()) on every request — force-dynamic makes that
// explicit instead of relying on Next's implicit dynamic-usage detection,
// which only fires (and only gets a chance to fall back gracefully) for
// static-path GET routes probed during the build's static-generation pass;
// this route is either a non-GET method or otherwise not guaranteed to hit
// that same path, so making it explicit removes the ambiguity outright.
export const dynamic = 'force-dynamic'

// POST /api/dalgo/admin/watchlists/[key]/symbols — Task 6.15. SuperAdmin only.
// `[key]` is platform_watchlists.list_key (e.g. "listA"). `symbols` jsonb
// entries follow lib/watchlistStore.ts's WatchlistEntry shape: {nse, name,
// sector?, trades?, lastTraded?} — nse (not "symbol") is the NSE trading
// symbol field name actually used everywhere else in this codebase.
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => ({}))
    const nse = typeof body.nse === 'string' ? body.nse.trim().toUpperCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const sector = typeof body.sector === 'string' ? body.sector.trim() : undefined
    if (!nse || !name) {
      return NextResponse.json({ error: 'nse and name are required.' }, { status: 400 })
    }

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
    if (symbols.some((s: any) => s.nse === nse)) {
      return NextResponse.json({ error: `${nse} is already in this watchlist.` }, { status: 409 })
    }
    const nextSymbols = [...symbols, { nse, name, ...(sector ? { sector } : {}) }]

    const { error: updateError } = await admin
      .from('platform_watchlists')
      .update({ symbols: nextSymbols, updated_at: new Date().toISOString() })
      .eq('list_key', params.key)
    if (updateError) {
      return NextResponse.json({ error: 'Failed to add symbol.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_watchlist.add_symbol',
      targetType: 'platform_watchlists',
      targetId: watchlist.list_key,
      targetName: watchlist.name,
      before: { symbolCount: symbols.length },
      after: { added: nse, symbolCount: nextSymbols.length },
    })

    return NextResponse.json({ ok: true, symbols: nextSymbols })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[watchlists/symbols/add] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
