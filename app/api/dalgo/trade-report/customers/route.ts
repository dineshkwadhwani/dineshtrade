// GET /api/dalgo/trade-report/customers
// Returns the list of customers the current user may run trade reports for,
// scoped by role: superadmin = all, AM = assigned, BC = their customers, customer = none (self only).

import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'No active session.' }, { status: 401 })

  if (profile.role === 'customer') {
    return NextResponse.json({ role: profile.role, customers: [] })
  }

  const admin = getSupabaseAdmin()
  let query = admin.from('profiles').select('id, full_name').eq('role', 'customer').order('full_name')

  if (profile.role === 'account_manager') {
    query = query.eq('assigned_account_manager_id', profile.id)
  } else if (profile.role === 'broking_company') {
    query = query.eq('broking_company_id', profile.id)
  }
  // superadmin: no additional filter

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const customers = (data ?? []).map((c: { id: string; full_name: string }) => ({
    id: c.id,
    name: c.full_name,
  }))

  return NextResponse.json({ role: profile.role, customers })
}
