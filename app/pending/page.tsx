// app/pending/page.tsx

import { redirect } from 'next/navigation'
import { getSession, getProfile, type ProfileStatus } from '@/lib/dalgoAuth'

const FONT_SORA = "'Sora', sans-serif"
const FONT_INTER = "'Inter', sans-serif"

const STATUS_LABEL: Record<ProfileStatus, string> = {
  pending: 'Pending',
  under_review: 'Under review',
  identity_verified: 'Identity verified',
  active: 'Active',
  suspended: 'Suspended',
  rejected: 'Rejected',
}

const STATUS_COLOR: Record<ProfileStatus, { bg: string; text: string }> = {
  pending: { bg: '#FEF3C7', text: '#92400E' },
  under_review: { bg: '#DBEAFE', text: '#1E3A8A' },
  identity_verified: { bg: '#D1FAE5', text: '#065F46' },
  active: { bg: '#D1FAE5', text: '#065F46' },
  suspended: { bg: '#FEE2E2', text: '#991B1B' },
  rejected: { bg: '#FEE2E2', text: '#991B1B' },
}

function StatusBadge({ status }: { status: ProfileStatus }) {
  const c = STATUS_COLOR[status]
  return (
    <span
      style={{
        display: 'inline-block', padding: '4px 12px', borderRadius: 999,
        background: c.bg, color: c.text, fontFamily: FONT_INTER, fontWeight: 600, fontSize: 12,
        letterSpacing: '0.02em', textTransform: 'uppercase',
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFF', padding: '32px 16px' }}>
      <div
        style={{
          width: '100%', maxWidth: 440, background: '#FFFFFF', border: '1px solid #BFDBFE',
          borderRadius: 16, padding: 40, boxShadow: '0 4px 24px rgba(30,58,138,0.06)', textAlign: 'center',
        }}
      >
        <div style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 26, marginBottom: 24 }}>
          <span style={{ color: '#1E3A8A' }}>D</span>
          <span style={{ color: '#F59E0B' }}>A</span>
          <span style={{ color: '#1E3A8A' }}>lgo</span>
        </div>
        {children}
      </div>
    </div>
  )
}

// Server Component — no interactivity, so no separate Client file.
export default async function PendingPage() {
  const session = await getSession()
  const profile = session ? await getProfile() : null

  // Approved — they should log in properly instead of sitting on this page.
  if (profile?.status === 'active') {
    redirect('/login')
  }

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Inter:wght@400;500&display=swap"
      />
      <CardShell>
        <h1 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 22, color: '#1E3A8A', margin: '0 0 12px' }}>
          Application under review
        </h1>

        {profile && (
          <div style={{ marginBottom: 16 }}>
            <StatusBadge status={profile.status} />
          </div>
        )}

        <p style={{ fontFamily: FONT_INTER, fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 20px' }}>
          Your application has been submitted and is currently under review.
          This typically takes 1–2 business days.
        </p>

        <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#94A3B8', margin: 0 }}>
          Questions? Contact{' '}
          <a href="mailto:support@dalgo.online" style={{ color: '#3B82F6' }}>
            support@dalgo.online
          </a>
        </p>
      </CardShell>
    </>
  )
}
