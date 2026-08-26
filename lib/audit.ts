// Audit log writer — shared by every SuperAdmin/Account Manager mutation API
// route (Phase 6). Writes to `audit_log` via the service-role client (RLS on
// that table only allows `is_superadmin()` to SELECT; INSERT is
// `with check (true)`, so the admin client bypassing RLS is not required for
// the insert itself, but IS required to read it back on /admin/audit).
//
// Never throws — an audit-log write failure must not fail the underlying
// action it's recording (the action already succeeded by the time this is
// called in every call site).

import { getSupabaseAdmin } from './supabase'

// Lightweight actor shape for audit entries. Keep `role` as string so system
// actors can be recorded without requiring ProfileRole.
export type AuditActor = { id: string; role: string; full_name: string }

export interface AuditEntryInput {
  actor: AuditActor
  action: string
  targetType?: string
  targetId?: string
  targetName?: string
  before?: unknown
  after?: unknown
}

export async function writeAuditLog(entry: AuditEntryInput): Promise<void> {
  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin.from('audit_log').insert({
      actor_id: entry.actor.id,
      actor_role: entry.actor.role,
      actor_name: entry.actor.full_name,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      target_name: entry.targetName ?? null,
      before_value: entry.before ?? null,
      after_value: entry.after ?? null,
    })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.error('[audit] writeAuditLog failed:', String(err).slice(0, 300))
  }
}
