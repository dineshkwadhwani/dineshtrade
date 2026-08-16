import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// GET /api/dalgo/admin/broker-sources
export async function GET() {
  try {
    await requireRole('superadmin')
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('platform_broker_sources')
      .select('*')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ sources: data ?? [] })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[broker-sources/list] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST /api/dalgo/admin/broker-sources
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => null) as {
      name?: string
      url?: string
      notes?: string | null
      active?: boolean
      displayOrder?: number
    } | null

    if (!body || !body.name || !body.url) {
      return NextResponse.json({ error: 'name and url are required.' }, { status: 400 })
    }

    const name = String(body.name).trim()
    const url = String(body.url).trim()
    const notes = body.notes == null ? null : String(body.notes).trim()
    const active = body.active !== false
    const displayOrder = Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 100

    if (!name) return NextResponse.json({ error: 'name cannot be empty.' }, { status: 400 })
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'url must start with http:// or https://.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const now = new Date().toISOString()
    const { data: row, error } = await admin
      .from('platform_broker_sources')
      .insert({
        name,
        url,
        notes,
        active,
        display_order: displayOrder,
        updated_at: now,
        updated_by: actor.id,
      })
      .select('*')
      .single()

    if (error) {
      const duplicate = error.message.toLowerCase().includes('duplicate') || error.message.toLowerCase().includes('unique')
      return NextResponse.json({ error: duplicate ? 'Source name or URL already exists.' : error.message }, { status: duplicate ? 409 : 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_broker_sources.create',
      targetType: 'platform_broker_sources',
      targetId: row.id,
      targetName: row.name,
      before: null,
      after: row,
    })

    return NextResponse.json({ ok: true, source: row })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[broker-sources/create] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
