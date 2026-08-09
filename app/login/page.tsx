import { getSession, getProfile } from '@/lib/dalgoAuth'
import LoginClient from './LoginClient'

// Server Component — safe to use lib/dalgoAuth.ts's getSession()/getProfile()
// here (they use next/headers' cookies(), which works in Server Components /
// Route Handlers, just not in middleware.ts — that's why Task 7 is separate).
//
// No redirect-by-role here: /admin, /manager, /sso don't exist as pages yet
// (that's Task 7+ territory), so there is nowhere real to send an
// already-logged-in user. If a valid session exists, the page just renders
// LoginClient pre-populated with the profile so it shows the "signed in"
// state instead of the form.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  const session = await getSession()
  const profile = session ? await getProfile() : null

  // ?error=invalid_sso — bounced back here from app/sso/page.tsx (missing,
  // invalid, expired, or already-used SSO token). Keyed by code, not a raw
  // message, so a bad/forged query param can't be used to inject arbitrary
  // text onto the login page.
  const initialError = searchParams.error === 'invalid_sso'
    ? 'Your sign-in link has expired or was already used. Please log in again.'
    : ''

  return (
    <>
      {/* Scoped to this page only — not touching app/globals.css or
          app/layout.tsx. Next.js hoists <link> tags rendered anywhere in the
          component tree into <head> automatically. */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Inter:wght@400;500&display=swap"
      />
      <LoginClient initialProfile={profile} initialError={initialError} />
    </>
  )
}
