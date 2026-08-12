// POST /api/dalgo/admin/health/reminder  { customerId }
// Sends a professional reminder email to a customer whose Kite token has expired.

import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { sendTokenMissingAlert } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const allowed = ['superadmin', 'account_manager']
    if (!allowed.includes(profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const customerId = typeof body.customerId === 'string' ? body.customerId : ''
    if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 })

    const admin = getSupabaseAdmin()
    const { data: customer } = await admin.from('profiles').select('full_name, email, assigned_account_manager_id')
      .eq('id', customerId).eq('role', 'customer').maybeSingle()

    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    // AM can only remind their own customers
    if (profile.role === 'account_manager' && customer.assigned_account_manager_id !== profile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await sendTokenMissingAlert(customer.email, customer.full_name)
    return NextResponse.json({ ok: result.ok, error: result.error })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
