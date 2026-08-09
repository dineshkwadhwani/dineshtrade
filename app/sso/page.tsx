import { redirect } from 'next/navigation'
import SsoClient from './SsoClient'

// Server Component — the landing point for a customer redirected here from
// the main DAlgo instance after login, carrying a one-time SSO token
// (?token=xxx, see lib/dalgoAuth.ts's generateSSOToken/validateSSOToken).
//
// This page itself never calls validateSSOToken()/completeSsoLogin() — those
// live in app/sso/actions.ts's Server Action instead, because turning a valid
// token into a real session means setting SESSION_COOKIE, and Next.js only
// allows cookies().set() from a Server Action or Route Handler, never from a
// plain page render (see actions.ts's header comment for the full reasoning).
// This component's only real job is the free early-exit: no token at all
// means there's nothing worth a round trip to the client for.
export default function SsoPage({
  searchParams,
}: {
  searchParams: { token?: string }
}) {
  const token = searchParams.token
  if (!token) {
    redirect('/login?error=invalid_sso')
  }

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Inter:wght@400;500&display=swap"
      />
      <SsoClient token={token} />
    </>
  )
}
