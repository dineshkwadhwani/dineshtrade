import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/dalgoAuth'

// Server Component — getProfile() uses lib/dalgoAuth.ts's getSupabaseAdmin()
// (service role), so this page works correctly regardless of the profiles
// RLS recursion bug — that bug only affects middleware's anon-key-scoped
// read. Middleware still gates this page first either way.

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  account_manager: 'Account Manager',
  broking_company: 'Broking Company',
  customer: 'Customer',
}

export default async function AdminPage() {
  const profile = await getProfile()
  if (!profile) {
    redirect('/login')
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F8FAFF',
        padding: 32,
      }}
    >
      <div style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: 40, marginBottom: 24 }}>
        <span style={{ color: '#1E3A8A' }}>D</span>
        <span style={{ color: '#F59E0B' }}>A</span>
        <span style={{ color: '#1E3A8A' }}>lgo</span>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: '#FFFFFF',
          border: '1px solid #BFDBFE',
          borderRadius: 16,
          padding: 40,
          textAlign: 'center',
          boxShadow: '0 4px 24px rgba(30,58,138,0.06)',
        }}
      >
        <h1 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: 22, color: '#1E3A8A', margin: 0 }}>
          SuperAdmin Dashboard
        </h1>
        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: '#475569', marginTop: 12, marginBottom: 4 }}>
          Welcome, {profile.full_name}
        </p>
        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: '#94A3B8', marginTop: 0, marginBottom: 20 }}>
          {profile.email}
        </p>
        <span
          style={{
            display: 'inline-block',
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            fontWeight: 500,
            color: '#0D5C6B',
            background: '#E6FAFA',
            border: '1px solid #7DD8E0',
            borderRadius: 999,
            padding: '4px 12px',
            marginBottom: 24,
          }}
        >
          {ROLE_LABELS[profile.role] ?? profile.role}
        </span>
        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: '#94A3B8', margin: 0 }}>
          Phase 2 coming soon
        </p>
      </div>
    </div>
  )
}
