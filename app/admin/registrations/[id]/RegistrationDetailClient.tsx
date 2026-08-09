'use client'

// Shared client component for the registration detail/approval view — used
// by both app/admin/registrations/[id]/page.tsx (Task 6.3) and
// app/manager/registrations/[id]/page.tsx (Task 6.11).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { RegistrationRow } from '@/lib/dalgoAdmin'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import { Badge, STATUS_LABELS, dangerButtonStyle, primaryButtonStyle, statusTone } from '@/components/dalgo/ui'
import type { ProfileStatus } from '@/lib/dalgoAuth'

interface Props {
  registration: RegistrationRow
  profileEmail: string
  profileStatus: ProfileStatus
  assignedToName: string | null
  aadharFrontUrl: string | null
  aadharBackUrl: string | null
  canAct: boolean
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: COLORS.body, marginTop: 2 }}>{value || '—'}</div>
    </div>
  )
}

export default function RegistrationDetailClient({
  registration,
  profileEmail,
  profileStatus,
  assignedToName,
  aadharFrontUrl,
  aadharBackUrl,
  canAct,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [reason, setReason] = useState('')

  const isDecided = !!registration.step1_approved_at || !!registration.rejection_reason

  async function handleApprove() {
    if (!confirm(`Approve identity verification for ${registration.full_name}?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/dalgo/admin/registrations/${registration.id}/approve`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error || 'Failed to approve.')
      } else {
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleReject() {
    if (!reason.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/dalgo/admin/registrations/${registration.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error || 'Failed to reject.')
      } else {
        setShowRejectForm(false)
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <Badge tone={statusTone(profileStatus)}>{STATUS_LABELS[profileStatus] ?? profileStatus}</Badge>
        <Badge tone="teal">{registration.registration_type === 'customer' ? 'Customer' : 'Broking Company'}</Badge>
        {registration.surepass_verified && <Badge tone="green">Surepass verified</Badge>}
      </div>

      {registration.rejection_reason && (
        <div
          style={{
            background: COLORS.statusRedBg,
            border: `1px solid ${COLORS.statusRedText}55`,
            borderRadius: 10,
            padding: 14,
            marginBottom: 20,
            color: COLORS.statusRedText,
            fontSize: 13,
          }}
        >
          <strong>Rejected:</strong> {registration.rejection_reason}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        <Field label="Full Name (Aadhar)" value={registration.full_name} />
        <Field label="Email" value={profileEmail} />
        <Field label="Mobile" value={registration.mobile} />
        <Field label="Date of Birth" value={registration.dob ? new Date(registration.dob).toLocaleDateString('en-IN') : null} />
        <Field label="Address" value={registration.address} />
        <Field label="City" value={registration.city} />
        <Field label="State" value={registration.state} />
        <Field label="Pincode" value={registration.pincode} />
        <Field label="Aadhar Number" value={registration.aadhar_number ? `XXXX XXXX ${registration.aadhar_number.slice(-4)}` : null} />
        <Field label="Submitted" value={new Date(registration.created_at).toLocaleString('en-IN')} />
        <Field label="Assigned Account Manager" value={assignedToName ?? 'Unassigned'} />
      </div>

      {registration.registration_type === 'broking_company' && (
        <>
          <h3 style={{ fontSize: 14, color: COLORS.heading, marginBottom: 12 }}>Company Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
            <Field label="Company Name" value={registration.company_name} />
            <Field label="GST Number" value={registration.gst_number} />
            <Field label="Company Registration No." value={registration.company_registration_number} />
            <Field label="Company Address" value={registration.company_address} />
            <Field label="Company City" value={registration.company_city} />
            <Field label="Company State" value={registration.company_state} />
            <Field label="Company Pincode" value={registration.company_pincode} />
            <Field label="Company Email" value={registration.company_email} />
            <Field label="Company Mobile" value={registration.company_mobile} />
          </div>
        </>
      )}

      <h3 style={{ fontSize: 14, color: COLORS.heading, marginBottom: 12 }}>Aadhar Documents</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        {[
          { label: 'Aadhar Front', url: aadharFrontUrl },
          { label: 'Aadhar Back', url: aadharBackUrl },
        ].map(doc => (
          <div key={doc.label}>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6 }}>{doc.label}</div>
            {doc.url ? (
              <a href={doc.url} target="_blank" rel="noreferrer">
                <img
                  src={doc.url}
                  alt={doc.label}
                  style={{ width: 220, height: 140, objectFit: 'cover', borderRadius: 8, border: `1px solid ${COLORS.border}` }}
                />
              </a>
            ) : (
              <div
                style={{
                  width: 220,
                  height: 140,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  border: `1px dashed ${COLORS.border}`,
                  color: COLORS.muted,
                  fontSize: 12,
                }}
              >
                Not available
              </div>
            )}
          </div>
        ))}
      </div>

      {registration.surepass_result != null && (
        <>
          <h3 style={{ fontSize: 14, color: COLORS.heading, marginBottom: 12 }}>Surepass Result</h3>
          <pre
            style={{
              background: '#F8FAFF',
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              overflowX: 'auto',
              marginBottom: 24,
            }}
          >
            {JSON.stringify(registration.surepass_result, null, 2)}
          </pre>
        </>
      )}

      {canAct && !isDecided && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <button onClick={handleApprove} disabled={busy} style={{ ...primaryButtonStyle, opacity: busy ? 0.6 : 1 }}>
            Approve Identity
          </button>
          {!showRejectForm ? (
            <button onClick={() => setShowRejectForm(true)} disabled={busy} style={{ ...dangerButtonStyle, opacity: busy ? 0.6 : 1 }}>
              Reject
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 280 }}>
              <textarea
                placeholder="Rejection reason (required)…"
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                style={{
                  fontFamily: FONT_INTER,
                  fontSize: 13,
                  padding: 10,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleReject}
                  disabled={busy || !reason.trim()}
                  style={{ ...dangerButtonStyle, opacity: busy || !reason.trim() ? 0.6 : 1 }}
                >
                  Confirm Reject
                </button>
                <button
                  onClick={() => {
                    setShowRejectForm(false)
                    setReason('')
                  }}
                  disabled={busy}
                  style={{ ...primaryButtonStyle, background: '#fff', color: COLORS.body, border: `1px solid ${COLORS.border}` }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
