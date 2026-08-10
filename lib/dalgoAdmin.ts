// Shared read-side data access for the SuperAdmin / Account Manager
// dashboards (Phase 6). All server-only (Server Components / Route Handlers
// only) — every function goes through getSupabaseAdmin() (service-role,
// bypasses RLS), since these pages need cross-tenant reads that a customer's
// own RLS-scoped session could never satisfy anyway (that's the whole point
// of these roles).
//
// Column names verified against the live schema/migration script, not just
// the spec's SQL — see scripts/migrate-to-supabase.ts and
// lib/strategyConfigStore.ts/lib/watchlistStore.ts for the ground truth where
// it mattered (e.g. platform_strategies keys off `id`, not `strategy_key`;
// customer_strategies keys off `strategy_key`; customer_watchlists.symbols
// entries are `{nse, name, sector?}`, not `{symbol, name, sector}`).

import { getSupabaseAdmin } from './supabase'
import { isMarketOpen } from './market'
import type { ProfileRole, ProfileStatus } from './dalgoAuth'

// ---------------------------------------------------------------------------
// Shared row shapes
// ---------------------------------------------------------------------------

export interface ProfileRow {
  id: string
  role: ProfileRole
  full_name: string
  email: string
  mobile: string | null
  status: ProfileStatus
  assigned_account_manager_id: string | null
  broking_company_id: string | null
  subdomain: string | null
  instance_ip: string | null
  created_at: string
  updated_at: string
}

export interface CustomerInstanceRow {
  id: string
  customer_id: string
  subdomain: string | null
  instance_url: string | null
  elastic_ip: string | null
  ec2_instance_id: string | null
  status: string
  last_heartbeat_at: string | null
  last_cron_tick_at: string | null
  kite_token_status: 'connected' | 'missing' | 'expired'
  cron_mode: 'auto' | 'manual'
  open_positions_count: number
  todays_orders_count: number
  todays_buy_count: number
  todays_sell_count: number
  last_reset_at: string | null
  created_at: string
  updated_at: string
}

export interface RegistrationRow {
  id: string
  profile_id: string
  registration_type: 'customer' | 'broking_company'
  full_name: string
  dob: string | null
  address: string | null
  city: string | null
  state: string | null
  pincode: string | null
  mobile: string | null
  aadhar_number: string | null
  aadhar_front_url: string | null
  aadhar_back_url: string | null
  surepass_result: unknown
  surepass_verified: boolean
  company_name: string | null
  gst_number: string | null
  company_registration_number: string | null
  company_address: string | null
  company_city: string | null
  company_state: string | null
  company_pincode: string | null
  company_email: string | null
  company_mobile: string | null
  assigned_to: string | null
  step1_approved_at: string | null
  step1_approved_by: string | null
  rejection_reason: string | null
  step2_activated_at: string | null
  step2_activated_by: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Dashboard stats (Task 6.2 / 6.10)
// ---------------------------------------------------------------------------

export interface DashboardStats {
  totalCustomers: number
  activeCustomers: number
  pendingRegistrations: number
  accountManagers: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const admin = getSupabaseAdmin()
  const [totalCustomers, activeCustomers, pendingRegistrations, accountManagers] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer').eq('status', 'active'),
    admin
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .is('step1_approved_at', null)
      .is('rejection_reason', null),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'account_manager'),
  ])
  return {
    totalCustomers: totalCustomers.count ?? 0,
    activeCustomers: activeCustomers.count ?? 0,
    pendingRegistrations: pendingRegistrations.count ?? 0,
    accountManagers: accountManagers.count ?? 0,
  }
}

// AM-scoped variant of the above 4 cards (Task 6.10).
export interface ManagerDashboardStats {
  myCustomers: number
  myPendingRegistrations: number
  myActiveCustomers: number
  myAutoModeCustomers: number
}

export async function getManagerDashboardStats(amId: string): Promise<ManagerDashboardStats> {
  const admin = getSupabaseAdmin()
  const [customers, pending] = await Promise.all([
    admin.from('profiles').select('id, status').eq('role', 'customer').eq('assigned_account_manager_id', amId),
    admin
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', amId)
      .is('step1_approved_at', null)
      .is('rejection_reason', null),
  ])
  const rows = customers.data ?? []
  const customerIds = rows.map(r => r.id)
  let autoModeCount = 0
  if (customerIds.length > 0) {
    const { data: instances } = await admin
      .from('customer_instances')
      .select('customer_id, cron_mode')
      .in('customer_id', customerIds)
    autoModeCount = (instances ?? []).filter(i => i.cron_mode === 'auto').length
  }
  return {
    myCustomers: rows.length,
    myPendingRegistrations: pending.count ?? 0,
    myActiveCustomers: rows.filter(r => r.status === 'active').length,
    myAutoModeCustomers: autoModeCount,
  }
}

// ---------------------------------------------------------------------------
// Customer health table (Task 6.2, spec §13.5)
// ---------------------------------------------------------------------------

export interface CustomerHealthRow {
  instance: CustomerInstanceRow
  customerName: string
  customerEmail: string
  lastTickDot: 'green' | 'red' | 'grey'
}

function minutesSince(iso: string | null): number | null {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / 60000
}

export async function getCustomerHealthRows(filter?: { customerIds?: string[] }): Promise<CustomerHealthRow[]> {
  const admin = getSupabaseAdmin()
  let query = admin.from('customer_instances').select('*').eq('status', 'active')
  if (filter?.customerIds) {
    if (filter.customerIds.length === 0) return []
    query = query.in('customer_id', filter.customerIds)
  }
  const { data: instances } = await query
  if (!instances || instances.length === 0) return []

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .in('id', instances.map(i => i.customer_id))
  const byId = new Map((profiles ?? []).map(p => [p.id, p]))

  const marketOpen = isMarketOpen().open

  return instances.map(instance => {
    const profile = byId.get(instance.customer_id)
    const mins = minutesSince(instance.last_cron_tick_at)
    let lastTickDot: 'green' | 'red' | 'grey' = 'grey'
    if (marketOpen) {
      lastTickDot = mins !== null && mins < 6 ? 'green' : 'red'
    }
    return {
      instance: instance as CustomerInstanceRow,
      customerName: profile?.full_name ?? '(unknown)',
      customerEmail: profile?.email ?? '',
      lastTickDot,
    }
  })
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

export interface RegistrationWithProfile {
  registration: RegistrationRow
  profileStatus: ProfileStatus
  profileEmail: string
  assignedToName: string | null
}

async function attachProfilesAndAssignees(regs: RegistrationRow[]): Promise<RegistrationWithProfile[]> {
  if (regs.length === 0) return []
  const admin = getSupabaseAdmin()
  const profileIds = Array.from(new Set(regs.map(r => r.profile_id)))
  const assigneeIds = Array.from(new Set(regs.map(r => r.assigned_to).filter((x): x is string => !!x)))
  const allIds = Array.from(new Set([...profileIds, ...assigneeIds]))

  const { data: profiles } = await admin.from('profiles').select('id, status, email, full_name').in('id', allIds)
  const byId = new Map((profiles ?? []).map(p => [p.id, p]))

  return regs.map(registration => ({
    registration,
    profileStatus: (byId.get(registration.profile_id)?.status as ProfileStatus) ?? 'pending',
    profileEmail: byId.get(registration.profile_id)?.email ?? '',
    assignedToName: registration.assigned_to ? byId.get(registration.assigned_to)?.full_name ?? null : null,
  }))
}

export async function getRecentRegistrations(limit: number): Promise<RegistrationWithProfile[]> {
  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('registrations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  return attachProfilesAndAssignees((data ?? []) as RegistrationRow[])
}

export async function listRegistrations(filter?: { assignedTo?: string }): Promise<RegistrationWithProfile[]> {
  const admin = getSupabaseAdmin()
  let query = admin.from('registrations').select('*').order('created_at', { ascending: false })
  if (filter?.assignedTo) query = query.eq('assigned_to', filter.assignedTo)
  const { data } = await query
  return attachProfilesAndAssignees((data ?? []) as RegistrationRow[])
}

export async function getRegistrationById(id: string): Promise<RegistrationWithProfile | null> {
  const admin = getSupabaseAdmin()
  const { data } = await admin.from('registrations').select('*').eq('id', id).maybeSingle()
  if (!data) return null
  const [withProfile] = await attachProfilesAndAssignees([data as RegistrationRow])
  return withProfile
}

// ---------------------------------------------------------------------------
// Account Managers
// ---------------------------------------------------------------------------

export interface AccountManagerRow extends ProfileRow {
  customerCount: number
}

export async function listAccountManagers(): Promise<AccountManagerRow[]> {
  const admin = getSupabaseAdmin()
  const { data: managers } = await admin
    .from('profiles')
    .select('*')
    .eq('role', 'account_manager')
    .order('created_at', { ascending: false })
  if (!managers || managers.length === 0) return []

  const { data: customers } = await admin
    .from('profiles')
    .select('assigned_account_manager_id')
    .eq('role', 'customer')
    .not('assigned_account_manager_id', 'is', null)

  const counts = new Map<string, number>()
  for (const c of customers ?? []) {
    const key = c.assigned_account_manager_id as string
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return (managers as ProfileRow[]).map(m => ({ ...m, customerCount: counts.get(m.id) ?? 0 }))
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface CustomerListRow {
  profile: ProfileRow
  amName: string | null
  instance: CustomerInstanceRow | null
}

export async function listCustomers(filter?: { assignedTo?: string }): Promise<CustomerListRow[]> {
  const admin = getSupabaseAdmin()
  let query = admin.from('profiles').select('*').eq('role', 'customer').order('created_at', { ascending: false })
  if (filter?.assignedTo) query = query.eq('assigned_account_manager_id', filter.assignedTo)
  const { data: customers } = await query
  if (!customers || customers.length === 0) return []

  const amIds = Array.from(
    new Set(customers.map(c => c.assigned_account_manager_id).filter((x): x is string => !!x))
  )
  const [{ data: managers }, { data: instances }] = await Promise.all([
    amIds.length > 0
      ? admin.from('profiles').select('id, full_name').in('id', amIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    admin
      .from('customer_instances')
      .select('*')
      .in('customer_id', customers.map(c => c.id)),
  ])
  const amById = new Map((managers ?? []).map(m => [m.id, m.full_name]))
  const instanceByCustomer = new Map((instances ?? []).map(i => [i.customer_id, i as CustomerInstanceRow]))

  return (customers as ProfileRow[]).map(profile => ({
    profile,
    amName: profile.assigned_account_manager_id ? amById.get(profile.assigned_account_manager_id) ?? null : null,
    instance: instanceByCustomer.get(profile.id) ?? null,
  }))
}

export interface CustomerFullDetail {
  profile: ProfileRow
  registration: RegistrationRow | null
  instance: CustomerInstanceRow | null
  amName: string | null
  strategies: Array<{
    id: string
    name: string
    type: string
    active: boolean
    scan_interval_min: number
  }>
  capitalConfig: Record<string, unknown> | null
}

export async function getCustomerFullDetail(customerId: string): Promise<CustomerFullDetail | null> {
  const admin = getSupabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('*')
    .eq('id', customerId)
    .eq('role', 'customer')
    .maybeSingle()
  if (!profile) return null

  const [{ data: registration }, { data: instance }, { data: strategies }, { data: capital }] = await Promise.all([
    admin
      .from('registrations')
      .select('*')
      .eq('profile_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('customer_instances').select('*').eq('customer_id', customerId).maybeSingle(),
    admin
      .from('customer_strategies')
      .select('id, name, type, active, scan_interval_min')
      .eq('customer_id', customerId)
      .order('name', { ascending: true }),
    admin.from('customer_capital_config').select('*').eq('customer_id', customerId).maybeSingle(),
  ])

  let amName: string | null = null
  if (profile.assigned_account_manager_id) {
    const { data: am } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', profile.assigned_account_manager_id)
      .maybeSingle()
    amName = am?.full_name ?? null
  }

  return {
    profile: profile as ProfileRow,
    registration: (registration as RegistrationRow) ?? null,
    instance: (instance as CustomerInstanceRow) ?? null,
    amName,
    strategies: strategies ?? [],
    capitalConfig: capital ?? null,
  }
}

// ---------------------------------------------------------------------------
// Reports (Task 6.14, spec §13.1/§13.4)
// ---------------------------------------------------------------------------

export interface ReportFilter {
  fromDate: string // yyyy-mm-dd
  toDate: string // yyyy-mm-dd
  customerId?: string
  assignedTo?: string // AM id — scopes to that AM's customers
}

export interface ReportRow {
  customerId: string
  customerName: string
  totalOrders: number
  totalBuys: number
  totalSells: number
  totalTrades: number
  winningTrades: number
  winRatePct: number
}

// Small dataset assumption (Phase 6 MVP scope, per spec §13's "simple
// summary table") — aggregates in JS after fetching the filtered rows rather
// than a Postgres-side GROUP BY, which the untyped Supabase JS client can't
// express without a hand-written RPC.
export async function getReportsRows(filter: ReportFilter): Promise<ReportRow[]> {
  const admin = getSupabaseAdmin()

  let customerQuery = admin.from('profiles').select('id, full_name').eq('role', 'customer')
  if (filter.customerId) customerQuery = customerQuery.eq('id', filter.customerId)
  if (filter.assignedTo) customerQuery = customerQuery.eq('assigned_account_manager_id', filter.assignedTo)
  const { data: customers } = await customerQuery
  if (!customers || customers.length === 0) return []

  const customerIds = customers.map(c => c.id)
  const [{ data: orders }, { data: trades }] = await Promise.all([
    admin
      .from('orders')
      .select('customer_id, side')
      .in('customer_id', customerIds)
      .gte('trade_date', filter.fromDate)
      .lte('trade_date', filter.toDate),
    admin
      .from('trades')
      .select('customer_id, pnl_rupees, exit_price')
      .in('customer_id', customerIds)
      .gte('trade_date', filter.fromDate)
      .lte('trade_date', filter.toDate),
  ])

  return customers.map(customer => {
    const custOrders = (orders ?? []).filter(o => o.customer_id === customer.id)
    const custTrades = (trades ?? []).filter(t => t.customer_id === customer.id && t.exit_price !== null)
    const winningTrades = custTrades.filter(t => (t.pnl_rupees ?? 0) > 0).length
    return {
      customerId: customer.id,
      customerName: customer.full_name,
      totalOrders: custOrders.length,
      totalBuys: custOrders.filter(o => o.side === 'BUY').length,
      totalSells: custOrders.filter(o => o.side === 'SELL').length,
      totalTrades: custTrades.length,
      winningTrades,
      winRatePct: custTrades.length > 0 ? Math.round((winningTrades / custTrades.length) * 1000) / 10 : 0,
    }
  })
}
