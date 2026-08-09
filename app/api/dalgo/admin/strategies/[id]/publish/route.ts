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

// PUT /api/dalgo/admin/strategies/[id]/publish — Task 6.9. SuperAdmin only.
// `[id]` is platform_strategies.id (a stable text id like "accumulator", not
// a uuid). Unpublishing does NOT touch existing customer_strategies copies —
// those were already copied by value on customer activation (spec §7.3) and
// keep running independently; publish/unpublish only controls whether NEW
// customers see this template offered during Step 2 strategy setup.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => ({}))
    if (typeof body.published !== 'boolean') {
      return NextResponse.json({ error: 'published (boolean) is required.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const { data: strategy, error: strategyError } = await admin
      .from('platform_strategies')
      .select('id, name, published')
      .eq('id', params.id)
      .maybeSingle()
    if (strategyError || !strategy) {
      return NextResponse.json({ error: 'Strategy not found.' }, { status: 404 })
    }

    const { error: updateError } = await admin
      .from('platform_strategies')
      .update({ published: body.published, updated_at: new Date().toISOString() })
      .eq('id', params.id)
    if (updateError) {
      return NextResponse.json({ error: 'Failed to update strategy.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_strategy.publish_toggle',
      targetType: 'platform_strategies',
      targetId: strategy.id,
      targetName: strategy.name,
      before: { published: strategy.published },
      after: { published: body.published },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[strategies/publish] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
