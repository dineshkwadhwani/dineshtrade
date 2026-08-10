// 9:00 AM IST daily token-status alert — Phase 5 Task 5.5.
//
// Deliberate scoping decision (documented per the "full autonomy" brief):
// the full spec (§5.9) describes this as a cron on the MAIN instance that
// loops over ALL active customers. The Phase 5 task brief given for this
// session instead describes a per-customer check gated by CRON_ENABLED=true
// — which is only ever 'true' on a customer (or Dinesh's dual-role) EC2, per
// spec §5.4, never on the main instance. We followed the task brief's
// literal wording: this registers as one more per-customer cron job (see
// lib/cron.ts), each instance checking only its own CUSTOMER_ID. This is
// simpler, requires no cross-tenant admin query from a customer process, and
// composes cleanly with the rest of Phase 5's "everything scoped to this one
// CUSTOMER_ID" model. A true main-instance sweep across all customers is
// Phase 6 SuperAdmin-dashboard territory, not built here.
//
// Correctness note: we do NOT trust customer_instances.kite_token_status for
// the send/skip decision, because that column is only kept fresh when the
// SuperAdmin has HEARTBEAT_DB_ENABLED='true' (default OFF — see
// lib/instanceStatus.ts). Trusting a column that defaults to 'missing' and
// is never updated under the default config would fire a false "token
// missing" alert every single weekday morning. Instead we run our own live
// checkKiteTokenStatus() probe (same helper Task 5.4 uses) as the source of
// truth for the decision, and opportunistically write the result through to
// customer_instances (a no-op unless heartbeat writes are enabled) so the
// health dashboard stays consistent when that flag is on.

import { getSupabaseAdmin, getCustomerId } from './supabase'
import { getState } from './state'
import { checkKiteTokenStatus, updateInstanceStatus } from './instanceStatus'
import { sendTokenMissingAlert } from './email'

export async function checkAndSendTokenAlert(): Promise<void> {
  if (process.env.CRON_ENABLED !== 'true') {
    console.log('[tokenAlert] skipped — CRON_ENABLED is not true')
    return
  }

  try {
    const customerId = getCustomerId()
    const admin = getSupabaseAdmin()

    const state = await getState()
    const tokenStatus = await checkKiteTokenStatus(state.kiteTokens)
    // Opportunistic write-through — no-ops unless HEARTBEAT_DB_ENABLED='true'.
    updateInstanceStatus({ kiteTokenStatus: tokenStatus }).catch(err =>
      console.warn('[tokenAlert] instance status write-through failed (non-fatal):', String(err).slice(0, 150)))

    if (tokenStatus === 'connected') {
      console.log('[tokenAlert] 09:00 IST check — token connected, no alert needed')
      return
    }

    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('email, full_name, assigned_account_manager_id')
      .eq('id', customerId)
      .maybeSingle()
    if (profileErr || !profile?.email) {
      console.warn('[tokenAlert] could not load customer profile — skipping alert:', profileErr?.message || 'no profile found')
      return
    }

    let amEmail: string | undefined
    if (profile.assigned_account_manager_id) {
      const { data: am, error: amErr } = await admin
        .from('profiles')
        .select('email')
        .eq('id', profile.assigned_account_manager_id)
        .maybeSingle()
      if (amErr) console.warn('[tokenAlert] could not load assigned AM email:', amErr.message)
      amEmail = am?.email || undefined
    }

    const result = await sendTokenMissingAlert(profile.email, profile.full_name || 'there', amEmail)
    if (result.ok) {
      console.log(`[tokenAlert] 09:00 IST — sent token-missing alert to ${profile.email}${amEmail ? ` (cc ${amEmail})` : ''} (status=${tokenStatus})`)
    } else {
      console.error('[tokenAlert] send failed:', result.error)
    }
  } catch (err) {
    console.error('[tokenAlert] failed:', String(err).slice(0, 300))
  }
}

// Fires mid-tick when the primary account token is missing or expired.
// Alerts every customer in the list plus their assigned Account Managers.
// Primary account must have a Connect plan — if its token is missing, market
// data cannot be fetched for ANY customer, so the entire tick is skipped.
export async function sendPrimaryTokenMissingAlert(primaryCustomerId: string, allCustomerIds: string[]): Promise<void> {
  try {
    const admin = getSupabaseAdmin()
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email, full_name, assigned_account_manager_id')
      .in('id', allCustomerIds)

    const amIds = [...new Set((profiles ?? [])
      .map(p => p.assigned_account_manager_id)
      .filter((id): id is string => !!id))]
    const amEmails: Record<string, string> = {}
    if (amIds.length > 0) {
      const { data: ams } = await admin.from('profiles').select('id, email').in('id', amIds)
      for (const am of ams ?? []) amEmails[am.id] = am.email
    }

    for (const profile of profiles ?? []) {
      const amEmail = profile.assigned_account_manager_id ? amEmails[profile.assigned_account_manager_id] : undefined
      const isPrimary = profile.id === primaryCustomerId
      const result = await sendTokenMissingAlert(profile.email, profile.full_name || 'there', amEmail)
      if (!result.ok) console.error(`[tokenAlert] primaryMissing send to ${profile.email} failed:`, result.error)
    }
    console.log(`[tokenAlert] primary-missing alert sent to ${profiles?.length ?? 0} customer(s)`)
  } catch (err) {
    console.error('[tokenAlert] sendPrimaryTokenMissingAlert failed:', String(err).slice(0, 300))
  }
}
