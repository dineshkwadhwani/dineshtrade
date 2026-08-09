// app/cookies/page.tsx — Phase 7, Task 7.6.

import type { Metadata } from 'next'
import LegalLayout, { legalStyles as s } from '@/components/LegalLayout'

export const metadata: Metadata = {
  title: 'Cookie Policy — DAlgo',
  robots: { index: false },
}

export default function CookiesPage() {
  return (
    <LegalLayout title="Cookie Policy" lastUpdated="August 2026">
      <h2 style={s.h2}>1. What Cookies We Use</h2>
      <p style={s.p}>
        One cookie only: <strong style={s.strong}>dalgo_access_token</strong>.
      </p>
      <ul style={s.ul}>
        <li style={s.li}>Purpose: keeps you logged in.</li>
        <li style={s.li}>Type: HttpOnly (JavaScript cannot read it).</li>
        <li style={s.li}>Expiry: midnight IST every day.</li>
        <li style={s.li}>Required: yes — the platform cannot work without it.</li>
      </ul>

      <h2 style={s.h2}>2. What We Do NOT Use</h2>
      <ul style={s.ul}>
        <li style={s.li}>No Google Analytics.</li>
        <li style={s.li}>No Facebook Pixel.</li>
        <li style={s.li}>No advertising cookies.</li>
        <li style={s.li}>No third-party tracking of any kind.</li>
      </ul>

      <h2 style={s.h2}>3. Managing Cookies</h2>
      <p style={s.p}>
        You can delete the cookie by logging out or clearing your browser cookies. This will log you out of DAlgo.
      </p>

      <h2 style={s.h2}>4. No Consent Banner Needed</h2>
      <p style={s.p}>
        Since we use only one essential cookie with no tracking purpose, no cookie consent banner is required under
        Indian IT Rules or the EU ePrivacy Directive.
      </p>
    </LegalLayout>
  )
}
