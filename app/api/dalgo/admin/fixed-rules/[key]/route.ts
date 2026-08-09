import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { invalidateFixedRulesCache } from '@/lib/fixedRules'

// Reads the session cookie via requireRole()/getSession() (lib/dalgoAuth.ts,
// next/headers cookies()) on every request — force-dynamic makes that
// explicit instead of relying on Next's implicit dynamic-usage detection,
// which only fires (and only gets a chance to fall back gracefully) for
// static-path GET routes probed during the build's static-generation pass;
// this route is either a non-GET method or otherwise not guaranteed to hit
// that same path, so making it explicit removes the ambiguity outright.
export const dynamic = 'force-dynamic'

// PUT /api/dalgo/admin/fixed-rules/[key] — Task 6.7, spec §7.8.
// SuperAdmin only. `[key]` is `rule_key`, not the row's uuid `id` — that's
// what the admin UI actually has to hand (rule_key is the stable, human
// identifier every seed row and this route key off).
export async function PUT(req: NextRequest, { params }: { params: { key: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => ({}))
    if (body.value === undefined) {
      return NextResponse.json({ error: 'value is required.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const { data: rule, error: ruleError } = await admin
      .from('platform_fixed_rules')
      .select('id, rule_key, rule_name, value, value_type')
      .eq('rule_key', params.key)
      .maybeSingle()
    if (ruleError || !rule) {
      return NextResponse.json({ error: 'Fixed rule not found.' }, { status: 404 })
    }

    // Coerce the incoming value to the rule's declared value_type before
    // storing — the column is jsonb, so a raw string body.value would be
    // stored as a JSON string literal instead of a JSON boolean/number.
    let coerced: unknown = body.value
    if (rule.value_type === 'boolean') coerced = body.value === true || body.value === 'true'
    else if (rule.value_type === 'number') coerced = Number(body.value)
    else coerced = String(body.value)

    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await admin
      .from('platform_fixed_rules')
      .update({ value: coerced, updated_at: now, updated_by: actor.id })
      .eq('rule_key', params.key)
      .select('*')
      .maybeSingle()
    if (updateError || !updated) {
      return NextResponse.json({ error: 'Failed to update fixed rule.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'fixed_rule.update',
      targetType: 'platform_fixed_rules',
      targetId: rule.id,
      targetName: rule.rule_name,
      before: { value: rule.value },
      after: { value: coerced },
    })

    // "Takes effect immediately" per spec §7.8 — invalidate the in-memory
    // 5-minute cache every customer cron process reads through
    // (lib/fixedRules.ts) so the next getFixedRules() call re-reads Supabase
    // instead of serving a stale value for up to 5 more minutes.
    invalidateFixedRulesCache()

    return NextResponse.json({ ok: true, rule: updated })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[fixed-rules/update] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
