import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

// PUT /api/dalgo/admin/config/[key] — Task 6.8. SuperAdmin only.
// `platform_config.value` is a plain text column regardless of value_type
// (boolean/number/string are all stored as their string representation and
// coerced by readers — see lib/instanceStatus.ts's `data?.value === 'true'`
// pattern) — no jsonb coercion needed here, unlike fixed-rules' jsonb column.
export async function PUT(req: NextRequest, { params }: { params: { key: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => ({}))
    if (body.value === undefined || body.value === null) {
      return NextResponse.json({ error: 'value is required.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const { data: config, error: configError } = await admin
      .from('platform_config')
      .select('key, value, description')
      .eq('key', params.key)
      .maybeSingle()
    if (configError || !config) {
      return NextResponse.json({ error: 'Config key not found.' }, { status: 404 })
    }

    const newValue = String(body.value)
    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await admin
      .from('platform_config')
      .update({ value: newValue, updated_at: now, updated_by: actor.id })
      .eq('key', params.key)
      .select('*')
      .maybeSingle()
    if (updateError || !updated) {
      return NextResponse.json({ error: 'Failed to update config.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_config.update',
      targetType: 'platform_config',
      targetId: params.key,
      targetName: params.key,
      before: { value: config.value },
      after: { value: newValue },
    })

    return NextResponse.json({ ok: true, config: updated })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[config/update] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
