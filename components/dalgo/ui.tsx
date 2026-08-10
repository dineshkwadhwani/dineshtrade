// Shared presentational primitives for the SuperAdmin / Account Manager
// dashboards (Phase 6). Pure, prop-driven, no hooks — safe to import from
// both Server and Client Components.

import { COLORS, FONT_INTER, FONT_SORA, TONE_STYLE, type StatusTone } from './theme'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 20,
      }}
    >
      <div>
        <h1 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 22, color: COLORS.heading, margin: 0 }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: COLORS.body, marginTop: 4, marginBottom: 0 }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  )
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        background: COLORS.cardBg,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        boxShadow: '0 1px 4px rgba(59,130,246,0.06)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function SectionCard({
  title,
  actions,
  children,
  style,
}: {
  title?: string
  actions?: React.ReactNode
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <Card style={{ padding: 20, ...style }}>
      {(title || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 14,
          }}
        >
          {title && (
            <h2 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 16, color: COLORS.heading, margin: 0 }}>
              {title}
            </h2>
          )}
          {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
        </div>
      )}
      {children}
    </Card>
  )
}

export function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: StatusTone
}) {
  const color = tone ? TONE_STYLE[tone].color : COLORS.heading
  return (
    <Card style={{ padding: 18, flex: '1 1 180px', minWidth: 160 }}>
      <div
        style={{
          fontFamily: FONT_INTER,
          fontSize: 11,
          fontWeight: 500,
          color: COLORS.muted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 28, color, marginTop: 6 }}>{value}</div>
    </Card>
  )
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>{children}</div>
}

export function Badge({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  const s = TONE_STYLE[tone]
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: FONT_INTER,
        fontSize: 11,
        fontWeight: 500,
        color: s.color,
        background: s.background,
        border: s.border ? `1px solid ${s.border}` : 'none',
        borderRadius: 999,
        padding: '3px 10px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

export function StatusDot({ tone, title }: { tone: 'green' | 'red' | 'grey'; title?: string }) {
  const color =
    tone === 'green' ? COLORS.statusGreenText : tone === 'red' ? COLORS.statusRedText : COLORS.statusGreyText
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: color,
      }}
    />
  )
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT_INTER, fontSize: 13 }}>
        {children}
      </table>
    </div>
  )
}

export function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      style={{
        textAlign: align || 'left',
        padding: '10px 12px',
        fontSize: 11,
        fontWeight: 500,
        color: COLORS.muted,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        borderBottom: `1px solid ${COLORS.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align,
  style,
}: {
  children: React.ReactNode
  align?: 'left' | 'right' | 'center'
  style?: React.CSSProperties
}) {
  return (
    <td
      style={{
        textAlign: align || 'left',
        padding: '10px 12px',
        color: COLORS.body,
        borderBottom: '1px solid #EFF6FF',
        ...style,
      }}
    >
      {children}
    </td>
  )
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '32px 12px',
        textAlign: 'center',
        fontFamily: FONT_INTER,
        fontSize: 13,
        color: COLORS.muted,
      }}
    >
      {children}
    </div>
  )
}

export const buttonBase: React.CSSProperties = {
  fontFamily: FONT_INTER,
  fontWeight: 500,
  fontSize: 13,
  borderRadius: 8,
  padding: '8px 14px',
  cursor: 'pointer',
  border: 'none',
  transition: 'opacity 0.15s',
}

export const primaryButtonStyle: React.CSSProperties = {
  ...buttonBase,
  background: COLORS.primary,
  color: '#fff',
}

export const secondaryButtonStyle: React.CSSProperties = {
  ...buttonBase,
  background: '#fff',
  color: COLORS.heading,
  border: `1px solid ${COLORS.border}`,
}

export const dangerButtonStyle: React.CSSProperties = {
  ...buttonBase,
  background: COLORS.statusRedBg,
  color: COLORS.statusRedText,
  border: `1px solid ${COLORS.statusRedText}55`,
}

export function statusTone(status: string): StatusTone {
  if (status === 'active' || status === 'identity_verified' || status === 'broker_setup_complete' || status === 'connected' || status === 'auto') {
    return 'green'
  }
  if (status === 'rejected' || status === 'suspended' || status === 'missing' || status === 'expired') {
    return 'red'
  }
  if (status === 'pending' || status === 'under_review' || status === 'manual') {
    return 'amber'
  }
  return 'grey'
}

export const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  account_manager: 'Account Manager',
  broking_company: 'Broking Company',
  customer: 'Customer',
}

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  under_review: 'Under Review',
  identity_verified: 'Identity Verified',
  broker_setup_complete: 'Broker Connected',
  active: 'Active',
  suspended: 'Suspended',
  rejected: 'Rejected',
}
