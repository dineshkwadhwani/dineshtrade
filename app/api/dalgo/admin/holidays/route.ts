import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// GET /api/dalgo/admin/holidays
export async function GET() {
  try {
    await requireRole('superadmin')
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('platform_holidays')
      .select('*')
      .order('holiday_date', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ holidays: data ?? [] })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[holidays/list] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST /api/dalgo/admin/holidays
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole('superadmin')
    const body = await req.json().catch(() => null) as {
      holidayDate?: string
      name?: string
      market?: string
      notes?: string | null
      active?: boolean
    } | null

    if (!body || !body.holidayDate || !body.name) {
      return NextResponse.json({ error: 'holidayDate and name are required.' }, { status: 400 })
    }

    const holidayDate = String(body.holidayDate)
    const market = String(body.market || 'NSE').toUpperCase().trim()
    const name = String(body.name).trim()
    const notes = body.notes == null ? null : String(body.notes).trim()
    const active = body.active !== false

    if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) {
      return NextResponse.json({ error: 'holidayDate must be YYYY-MM-DD.' }, { status: 400 })
    }
    if (!name) {
      return NextResponse.json({ error: 'name cannot be empty.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const now = new Date().toISOString()
    const { data: row, error } = await admin
      .from('platform_holidays')
      .insert({
        market,
        holiday_date: holidayDate,
        name,
        notes,
        active,
        updated_at: now,
        updated_by: actor.id,
      })
      .select('*')
      .single()

    if (error) {
      const duplicate = error.message.toLowerCase().includes('duplicate') || error.message.toLowerCase().includes('unique')
      return NextResponse.json({ error: duplicate ? 'Holiday already exists for this date/market.' : error.message }, { status: duplicate ? 409 : 500 })
    }

    await writeAuditLog({
      actor,
      action: 'platform_holidays.create',
      targetType: 'platform_holidays',
      targetId: row.id,
      targetName: `${market}:${holidayDate}`,
      before: null,
      after: row,
    })

    return NextResponse.json({ ok: true, holiday: row })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[holidays/create] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
