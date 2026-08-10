export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { getSupabaseAdmin } from '@/lib/supabase'
import { PageHeader, SectionCard, Table, Th, Td, EmptyState, secondaryButtonStyle } from '@/components/dalgo/ui'
import { COLORS } from '@/components/dalgo/theme'
import AuditFiltersClient from './AuditFiltersClient'

const PAGE_SIZE = 50

// Task 6.13 — Audit Log. Read-only, paginated 50/page, filterable by action
// type and actor.
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: { page?: string; action?: string; actor?: string }
}) {
  const admin = getSupabaseAdmin()
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1)
  const offset = (page - 1) * PAGE_SIZE

  let query = admin.from('audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false })
  if (searchParams.action) query = query.eq('action', searchParams.action)
  if (searchParams.actor) query = query.eq('actor_id', searchParams.actor)
  const { data: rows, count } = await query.range(offset, offset + PAGE_SIZE - 1)

  // Filter dropdown option lists — sourced from the most recent 1000 entries
  // rather than a true DISTINCT query (not cheaply expressible via the
  // Supabase JS client without an RPC), which is more than enough for a
  // platform-scale audit log's filter dropdowns.
  const { data: recentForFilters } = await admin
    .from('audit_log')
    .select('action, actor_id, actor_name')
    .order('created_at', { ascending: false })
    .limit(1000)
  const actions = Array.from(new Set((recentForFilters ?? []).map(r => r.action))).sort()
  const actorMap = new Map<string, string>()
  for (const r of recentForFilters ?? []) {
    if (r.actor_id && !actorMap.has(r.actor_id)) actorMap.set(r.actor_id, r.actor_name ?? r.actor_id)
  }
  const actors = Array.from(actorMap.entries()).map(([id, name]) => ({ id, name }))

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))

  function pageHref(p: number) {
    const params = new URLSearchParams()
    if (searchParams.action) params.set('action', searchParams.action)
    if (searchParams.actor) params.set('actor', searchParams.actor)
    params.set('page', String(p))
    return `/admin/audit?${params.toString()}`
  }

  return (
    <div>
      <PageHeader title="Audit Log" subtitle={`${count ?? 0} entries — SuperAdmin actions across the platform`} />
      <SectionCard>
        <AuditFiltersClient actions={actions} actors={actors} />
        {!rows || rows.length === 0 ? (
          <EmptyState>No audit log entries match these filters.</EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Timestamp</Th>
                  <Th>Actor</Th>
                  <Th>Role</Th>
                  <Th>Action</Th>
                  <Th>Target</Th>
                  <Th>Before</Th>
                  <Th>After</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <Td style={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString('en-IN')}</Td>
                    <Td>{r.actor_name ?? '—'}</Td>
                    <Td>{r.actor_role ?? '—'}</Td>
                    <Td>{r.action}</Td>
                    <Td>{r.target_name ?? r.target_id ?? '—'}</Td>
                    <Td style={{ maxWidth: 220 }}>
                      <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {r.before_value ? JSON.stringify(r.before_value) : '—'}
                      </pre>
                    </Td>
                    <Td style={{ maxWidth: 220 }}>
                      <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {r.after_value ? JSON.stringify(r.after_value) : '—'}
                      </pre>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <span style={{ fontSize: 12, color: COLORS.muted }}>
                Page {page} of {totalPages}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {page > 1 && (
                  <Link href={pageHref(page - 1)} style={secondaryButtonStyle}>
                    ← Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={pageHref(page + 1)} style={secondaryButtonStyle}>
                    Next →
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  )
}
