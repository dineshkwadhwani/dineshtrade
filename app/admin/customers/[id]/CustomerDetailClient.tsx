'use client'

// Shared client component for the customer detail view — used by both
// app/admin/customers/[id]/page.tsx (Task 6.5) and
// app/manager/customers/[id]/page.tsx (Task 6.12: same component, with
// `canReassign=false` since an AM cannot reassign their own customers away).
//
// Deliberate scope decision: neither the admin nor the AM variant renders a
// per-customer audit trail here — Task 6.5's spec lists exactly 4 sections
// (Profile / Instance Health / Strategies / Capital Config) with no audit
// section on the admin side either, so Task 6.12's "no audit log section"
// note is read as "same as admin, still none" rather than implying the admin
// version has one this component would need to hide. The platform-wide audit
// trail lives at /admin/audit (Task 6.13).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CustomerFullDetail } from '@/lib/dalgoAdmin'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import {
  Badge,
  EmptyState,
  STATUS_LABELS,
  SectionCard,
  Table,
  Td,
  Th,
  primaryButtonStyle,
  secondaryButtonStyle,
  statusTone,
} from '@/components/dalgo/ui'

interface Manager {
  id: string
  full_name: string
}

interface Props {
  detail: CustomerFullDetail
  accountManagers?: Manager[] // present + non-empty → reassign control shown
  canActivate: boolean
  canEditCapital: boolean // role/assignment check — cron_mode==='manual' check happens client + server-side too
}

const CAPITAL_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'per_trade', label: 'Per Trade (₹)' },
  { key: 'max_buys_per_day', label: 'Max Buys / Day' },
  { key: 'max_sells_per_day', label: 'Max Sells / Day' },
  { key: 'max_positions', label: 'Max Positions' },
  { key: 'max_buys_per_symbol', label: 'Max Buys / Symbol' },
  { key: 'min_drop_between_buys_pct', label: 'Min Drop Between Buys (%)' },
  { key: 'max_deploy_pct', label: 'Max Deploy (%)' },
  { key: 'delivery_dp_charge', label: 'Delivery DP Charge (₹)' },
  { key: 'circuit_breaker_pct', label: 'Circuit Breaker (%)' },
  { key: 'intraday_circuit_trip_pct', label: 'Intraday Circuit Trip (%)' },
  { key: 'intraday_circuit_resume_pct', label: 'Intraday Circuit Resume (%)' },
  { key: 'panic_drop_pct', label: 'Panic Drop (%)' },
  { key: 'panic_window_min', label: 'Panic Window (min)' },
]

const inputStyle: React.CSSProperties = {
  fontFamily: FONT_INTER,
  fontSize: 13,
  padding: '7px 9px',
  borderRadius: 6,
  border: `1px solid ${COLORS.border}`,
  width: '100%',
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: COLORS.body, marginTop: 2 }}>{value ?? '—'}</div>
    </div>
  )
}

export default function CustomerDetailClient({ detail, accountManagers, canActivate, canEditCapital }: Props) {
  const router = useRouter()
  const { profile, instance, amName, strategies, capitalConfig } = detail
  const [reassignBusy, setReassignBusy] = useState(false)
  const [activateBusy, setActivateBusy] = useState(false)
  const [editingCapital, setEditingCapital] = useState(false)
  const [capitalDraft, setCapitalDraft] = useState<Record<string, string>>(
    Object.fromEntries(CAPITAL_FIELDS.map(f => [f.key, String(capitalConfig?.[f.key] ?? '')]))
  )
  const [savingCapital, setSavingCapital] = useState(false)

  const isManualMode = instance?.cron_mode === 'manual'

  async function handleReassign(newAmId: string) {
    if (!newAmId) return
    setReassignBusy(true)
    try {
      const res = await fetch(`/api/dalgo/admin/customers/${profile.id}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newAmId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error || 'Failed to reassign.')
      } else {
        router.refresh()
      }
    } finally {
      setReassignBusy(false)
    }
  }

  async function handleActivate() {
    if (!confirm(`Activate ${profile.full_name}'s account?`)) return
    setActivateBusy(true)
    try {
      const res = await fetch(`/api/dalgo/admin/customers/${profile.id}/activate`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error || 'Failed to activate.')
      } else {
        router.refresh()
      }
    } finally {
      setActivateBusy(false)
    }
  }

  async function handleSaveCapital() {
    setSavingCapital(true)
    try {
      const res = await fetch(`/api/dalgo/admin/customers/${profile.id}/capital`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capitalDraft),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error || 'Failed to update capital config.')
      } else {
        setEditingCapital(false)
        router.refresh()
      }
    } finally {
      setSavingCapital(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ---- Section 1: Profile ---- */}
      <SectionCard title="Profile">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 16 }}>
          <Field label="Name" value={profile.full_name} />
          <Field label="Email" value={profile.email} />
          <Field label="Status" value={<Badge tone={statusTone(profile.status)}>{STATUS_LABELS[profile.status] ?? profile.status}</Badge>} />
          <Field label="Role" value="Customer" />
          <Field label="Registered" value={new Date(profile.created_at).toLocaleDateString('en-IN')} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Field label="Assigned Account Manager" value={amName ?? 'Unassigned'} />
          {accountManagers && accountManagers.length > 0 && (
            <select
              disabled={reassignBusy}
              defaultValue=""
              onChange={e => handleReassign(e.target.value)}
              style={{ ...inputStyle, width: 'auto' }}
            >
              <option value="" disabled>
                Reassign to…
              </option>
              {accountManagers.map(am => (
                <option key={am.id} value={am.id}>
                  {am.full_name}
                </option>
              ))}
            </select>
          )}
        </div>
      </SectionCard>

      {/* ---- Section 2: Instance Health ---- */}
      <SectionCard
        title="Instance Health"
        actions={
          canActivate && profile.status === 'identity_verified' ? (
            <button onClick={handleActivate} disabled={activateBusy} style={{ ...primaryButtonStyle, opacity: activateBusy ? 0.6 : 1 }}>
              {activateBusy ? 'Activating…' : 'Activate Account'}
            </button>
          ) : undefined
        }
      >
        {!instance ? (
          <EmptyState>No instance provisioned yet.</EmptyState>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <Field label="EC2 Status" value={<Badge tone={instance.status === 'active' ? 'green' : 'grey'}>{instance.status}</Badge>} />
            <Field label="Subdomain" value={instance.subdomain} />
            <Field label="Elastic IP" value={instance.elastic_ip} />
            <Field label="Last Heartbeat" value={instance.last_heartbeat_at ? new Date(instance.last_heartbeat_at).toLocaleString('en-IN') : 'never'} />
            <Field label="Last Cron Tick" value={instance.last_cron_tick_at ? new Date(instance.last_cron_tick_at).toLocaleString('en-IN') : 'never'} />
            <Field label="Token Status" value={<Badge tone={statusTone(instance.kite_token_status)}>{instance.kite_token_status}</Badge>} />
            <Field label="Cron Mode" value={<Badge tone={instance.cron_mode === 'auto' ? 'green' : 'amber'}>{instance.cron_mode}</Badge>} />
            <Field label="Open Positions" value={instance.open_positions_count} />
          </div>
        )}
      </SectionCard>

      {/* ---- Section 3: Strategies (read only) ---- */}
      <SectionCard title="Strategies">
        {strategies.length === 0 ? (
          <EmptyState>No strategies configured yet.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Active</Th>
                <Th align="right">Scan Interval (min)</Th>
              </tr>
            </thead>
            <tbody>
              {strategies.map(s => (
                <tr key={s.id}>
                  <Td>{s.name}</Td>
                  <Td>
                    <Badge tone="teal">{s.type}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={s.active ? 'green' : 'grey'}>{s.active ? 'Active' : 'Inactive'}</Badge>
                  </Td>
                  <Td align="right">{s.scan_interval_min}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </SectionCard>

      {/* ---- Section 4: Capital Config ---- */}
      <SectionCard
        title="Capital Config"
        actions={
          canEditCapital && isManualMode && !editingCapital ? (
            <button onClick={() => setEditingCapital(true)} style={secondaryButtonStyle}>
              Edit
            </button>
          ) : undefined
        }
      >
        {!capitalConfig ? (
          <EmptyState>No capital config yet.</EmptyState>
        ) : !isManualMode ? (
          <>
            <div
              style={{
                background: COLORS.statusAmberBg,
                border: `1px solid ${COLORS.statusAmberText}55`,
                color: COLORS.statusAmberText,
                borderRadius: 8,
                padding: 12,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              Switch customer to Manual mode to edit capital configuration. This prevents configuration changes
              during live trading.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              {CAPITAL_FIELDS.map(f => (
                <Field key={f.key} label={f.label} value={String(capitalConfig[f.key] ?? '—')} />
              ))}
            </div>
          </>
        ) : editingCapital ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
              {CAPITAL_FIELDS.map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {f.label}
                  </label>
                  <input
                    type="number"
                    value={capitalDraft[f.key]}
                    onChange={e => setCapitalDraft(prev => ({ ...prev, [f.key]: e.target.value }))}
                    style={{ ...inputStyle, marginTop: 4 }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSaveCapital} disabled={savingCapital} style={{ ...primaryButtonStyle, opacity: savingCapital ? 0.6 : 1 }}>
                {savingCapital ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditingCapital(false)} disabled={savingCapital} style={secondaryButtonStyle}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
            {CAPITAL_FIELDS.map(f => (
              <Field key={f.key} label={f.label} value={String(capitalConfig[f.key] ?? '—')} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
