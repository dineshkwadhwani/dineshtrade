import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// PATCH /api/dalgo/admin/holidays/[id]
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => null) as {
      holidayDate?: string
      name?: string
      market?: string
      notes?: string | null
      active?: boolean
    } | null

    if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

    const admin = getSupabaseAdmin()
    const { data: existing, error: existingError } = await admin
      .from('platform_holidays')
      .select('*')
      .eq('id', params.id)
      .maybeSingle()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Holiday not found.' }, { status: 404 })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.id }

    if (body.holidayDate !== undefined) {
      const v = String(body.holidayDate)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return NextResponse.json({ error: 'holidayDate must be YYYY-MM-DD.' }, { status: 400 })
      }
      patch.holiday_date = v
    }
    if (body.name !== undefined) {
      const v = String(body.name).trim()
      if (!v) return NextResponse.json({ error: 'name cannot be empty.' }, { status: 400 })
      patch.name = v
    }
    if (body.market !== undefined) {
      const v = String(body.market).toUpperCase().trim()
      if (!v) return NextResponse.json({ error: 'market cannot be empty.' }, { status: 400 })
      patch.market = v
    }
    if (body.notes !== undefined) {
      patch.notes = body.notes == null ? null : String(body.notes).trim()
    }
    if (body.active !== undefined) {
      patch.active = !!body.active
    }

    const { data: updated, error: updateError } = await admin
      .from('platform_holidays')
      .update(patch)
      .eq('id', params.id)
      .select('*')
      .single()

    if (updateError) {
      const duplicate = updateError.message.toLowerCase().includes('duplicate') || updateError.message.toLowerCase().includes('unique')
      return NextResponse.json({ error: duplicate ? 'Holiday already exists for this date/market.' : updateError.message }, { status: duplicate ? 409 : 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_holidays.update',
      targetType: 'platform_holidays',
      targetId: params.id,
      targetName: `${updated.market}:${updated.holiday_date}`,
      before: existing,
      after: updated,
    })

    return NextResponse.json({ ok: true, holiday: updated })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[holidays/update] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// DELETE /api/dalgo/admin/holidays/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const admin = getSupabaseAdmin()

    const { data: existing, error: existingError } = await admin
      .from('platform_holidays')
      .select('*')
      .eq('id', params.id)
      .maybeSingle()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Holiday not found.' }, { status: 404 })
    }

    const { error } = await admin
      .from('platform_holidays')
      .delete()
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_holidays.delete',
      targetType: 'platform_holidays',
      targetId: params.id,
      targetName: `${existing.market}:${existing.holiday_date}`,
      before: existing,
      after: null,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[holidays/delete] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
