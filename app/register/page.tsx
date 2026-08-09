// app/register/page.tsx

import { redirect } from 'next/navigation'
import { getSession, getProfile, type ProfileRole } from '@/lib/dalgoAuth'
import RegisterClient from './RegisterClient'

// Duplicated from app/login/LoginClient.tsx's REDIRECT_BY_ROLE on purpose —
// same reasoning as that file's comment: a 4-line map isn't worth a shared
// module just to avoid hand-syncing two copies.
const REDIRECT_BY_ROLE: Record<ProfileRole, string> = {
  superadmin: '/admin',
  account_manager: '/manager',
  broking_company: '/manager',
  customer: '/sso',
}

// Server Component — if a valid session already exists, send the user
// where they belong instead of showing them a registration form:
//   - status !== 'active' (still mid-approval, any role) → /pending
//   - status === 'active' → their normal role landing page
export default async function RegisterPage() {
  const session = await getSession()
  const profile = session ? await getProfile() : null

  if (profile) {
    redirect(profile.status !== 'active' ? '/pending' : REDIRECT_BY_ROLE[profile.role])
  }

  return (
    <>
      {/* Scoped to this page only, same as app/login/page.tsx. */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Inter:wght@400;500&display=swap"
      />
      <RegisterClient />
    </>
  )
}
