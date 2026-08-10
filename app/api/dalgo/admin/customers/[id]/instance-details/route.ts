import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// PUT /api/dalgo/admin/customers/[id]/instance-details
// Sets subdomain (mandatory) and instance_ip (optional) on the customer profile.
// Must be called before activation so the login redirect knows where to send the customer.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole(['superadmin', 'account_manager'])
    const body = await req.json().catch(() => ({}))
    const subdomain = typeof body.subdomain === 'string' ? body.subdomain.trim().toLowerCase() : ''
    const instance_ip = typeof body.instance_ip === 'string' ? body.instance_ip.trim() || null : null

    if (!subdomain) {
      return NextResponse.json({ error: 'subdomain is required.' }, { status: 400 })
    }
    if (!/^[a-z0-9-]+$/.test(subdomain)) {
      return NextResponse.json({ error: 'Subdomain may only contain lowercase letters, numbers, and hyphens.' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const { data: customer, error: fetchErr } = await admin
      .from('profiles')
      .select('id, full_name, subdomain, instance_ip, role, assigned_account_manager_id')
      .eq('id', params.id)
      .eq('role', 'customer')
      .maybeSingle()
    if (fetchErr || !customer) {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })
    }
    if (actor.role === 'account_manager' && customer.assigned_account_manager_id !== actor.id) {
      return NextResponse.json({ error: 'This customer is not assigned to you.' }, { status: 403 })
    }

    const before = { subdomain: customer.subdomain, instance_ip: customer.instance_ip }
    const { error: updateErr } = await admin
      .from('profiles')
      .update({ subdomain, instance_ip, updated_at: new Date().toISOString() })
      .eq('id', params.id)
    if (updateErr) {
      // unique constraint on subdomain
      if (updateErr.code === '23505') {
        return NextResponse.json({ error: `Subdomain "${subdomain}" is already taken.` }, { status: 409 })
      }
      return NextResponse.json({ error: 'Failed to save.' }, { status: 500 })
    }

    await writeAuditLog({
      actor,
      action: 'customer.instance_details',
      targetType: 'customer',
      targetId: params.id,
      targetName: customer.full_name,
      before,
      after: { subdomain, instance_ip },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[customers/instance-details] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
