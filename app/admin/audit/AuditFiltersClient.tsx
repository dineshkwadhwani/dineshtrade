'use client'

// Task 6.13 — Audit Log filter controls. Plain GET-style navigation via
// router.push so filters/pagination are shareable URLs and the page itself
// stays a Server Component doing the actual Supabase query + pagination.

import { useRouter, useSearchParams } from 'next/navigation'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'

interface Props {
  actions: string[]
  actors: Array<{ id: string; name: string }>
}

const inputStyle: React.CSSProperties = {
  fontFamily: FONT_INTER,
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  background: '#fff',
  color: COLORS.body,
}

export default function AuditFiltersClient({ actions, actors }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page') // any filter change resets to page 1
    router.push(`/admin/audit?${next.toString()}`)
  }

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
      <select
        defaultValue={searchParams.get('action') ?? ''}
        onChange={e => setParam('action', e.target.value)}
        style={inputStyle}
      >
        <option value="">All actions</option>
        {actions.map(a => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <select
        defaultValue={searchParams.get('actor') ?? ''}
        onChange={e => setParam('actor', e.target.value)}
        style={inputStyle}
      >
        <option value="">All actors</option>
        {actors.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  )
}
