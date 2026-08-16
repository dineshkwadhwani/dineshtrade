import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// PATCH /api/dalgo/admin/broker-sources/[id]
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => null) as {
      name?: string
      url?: string
      notes?: string | null
      active?: boolean
      displayOrder?: number
    } | null

    if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

    const admin = getSupabaseAdmin()
    const { data: existing, error: existingError } = await admin
      .from('platform_broker_sources')
      .select('*')
      .eq('id', params.id)
      .maybeSingle()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Source not found.' }, { status: 404 })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.id }

    if (body.name !== undefined) {
      const v = String(body.name).trim()
      if (!v) return NextResponse.json({ error: 'name cannot be empty.' }, { status: 400 })
      patch.name = v
    }
    if (body.url !== undefined) {
      const v = String(body.url).trim()
      if (!/^https?:\/\//i.test(v)) {
        return NextResponse.json({ error: 'url must start with http:// or https://.' }, { status: 400 })
      }
      patch.url = v
    }
    if (body.notes !== undefined) {
      patch.notes = body.notes == null ? null : String(body.notes).trim()
    }
    if (body.active !== undefined) {
      patch.active = !!body.active
    }
    if (body.displayOrder !== undefined) {
      if (!Number.isFinite(body.displayOrder)) {
        return NextResponse.json({ error: 'displayOrder must be a number.' }, { status: 400 })
      }
      patch.display_order = Number(body.displayOrder)
    }

    const { data: updated, error: updateError } = await admin
      .from('platform_broker_sources')
      .update(patch)
      .eq('id', params.id)
      .select('*')
      .single()

    if (updateError) {
      const duplicate = updateError.message.toLowerCase().includes('duplicate') || updateError.message.toLowerCase().includes('unique')
      return NextResponse.json({ error: duplicate ? 'Source name or URL already exists.' : updateError.message }, { status: duplicate ? 409 : 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_broker_sources.update',
      targetType: 'platform_broker_sources',
      targetId: params.id,
      targetName: updated.name,
      before: existing,
      after: updated,
    })

    return NextResponse.json({ ok: true, source: updated })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[broker-sources/update] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// DELETE /api/dalgo/admin/broker-sources/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole('superadmin')
    const admin = getSupabaseAdmin()

    const { data: existing, error: existingError } = await admin
      .from('platform_broker_sources')
      .select('*')
      .eq('id', params.id)
      .maybeSingle()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Source not found.' }, { status: 404 })
    }

    const { error } = await admin
      .from('platform_broker_sources')
      .delete()
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_broker_sources.delete',
      targetType: 'platform_broker_sources',
      targetId: params.id,
      targetName: existing.name,
      before: existing,
      after: null,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[broker-sources/delete] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
