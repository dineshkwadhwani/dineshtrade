'use client'

// Task 6.14 — Reports filter bar (date range + customer + AM). Same
// URL-query-param navigation pattern as AuditFiltersClient.

import { useRouter, useSearchParams } from 'next/navigation'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { primaryButtonStyle } from '@/components/dalgo/ui'

interface Option {
  id: string
  label: string
}

interface Props {
  basePath: string // '/admin/reports' | '/manager/reports'
  exportPath: string // '/api/dalgo/admin/reports/export'
  customers: Option[]
  accountManagers?: Option[] // omit to hide the AM filter (manager view)
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

export default function ReportsFiltersClient({ basePath, exportPath, customers, accountManagers }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    router.push(`${basePath}?${next.toString()}`)
  }

  const exportHref = `${exportPath}?${searchParams.toString()}`

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
      <div>
        <label style={{ fontSize: 11, color: COLORS.muted }}>From</label>
        <br />
        <input
          type="date"
          defaultValue={searchParams.get('from') ?? ''}
          onChange={e => setParam('from', e.target.value)}
          style={{ ...inputStyle, marginTop: 4 }}
        />
      </div>
      <div>
        <label style={{ fontSize: 11, color: COLORS.muted }}>To</label>
        <br />
        <input
          type="date"
          defaultValue={searchParams.get('to') ?? ''}
          onChange={e => setParam('to', e.target.value)}
          style={{ ...inputStyle, marginTop: 4 }}
        />
      </div>
      <div>
        <label style={{ fontSize: 11, color: COLORS.muted }}>Customer</label>
        <br />
        <select
          defaultValue={searchParams.get('customer') ?? ''}
          onChange={e => setParam('customer', e.target.value)}
          style={{ ...inputStyle, marginTop: 4 }}
        >
          <option value="">All customers</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {accountManagers && (
        <div>
          <label style={{ fontSize: 11, color: COLORS.muted }}>Account Manager</label>
          <br />
          <select
            defaultValue={searchParams.get('am') ?? ''}
            onChange={e => setParam('am', e.target.value)}
            style={{ ...inputStyle, marginTop: 4 }}
          >
            <option value="">All Account Managers</option>
            {accountManagers.map(am => (
              <option key={am.id} value={am.id}>
                {am.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <a href={exportHref} style={{ ...primaryButtonStyle, textDecoration: 'none', alignSelf: 'flex-end' }}>
        Export to CSV
      </a>
    </div>
  )
}
