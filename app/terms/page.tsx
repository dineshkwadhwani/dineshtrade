// app/terms/page.tsx — Phase 7, Task 7.4.

import type { Metadata } from 'next'
import LegalLayout, { legalStyles as s } from '@/components/LegalLayout'

export const metadata: Metadata = {
  title: 'Terms of Service — DAlgo',
  robots: { index: false },
}

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="August 2026">
      <h2 style={s.h2}>1. Acceptance of Terms</h2>
      <p style={s.p}>By registering for a DAlgo account, you agree to be bound by these Terms of Service.</p>

      <h2 style={s.h2}>2. Description of Service</h2>
      <p style={s.p}>DAlgo is an automated trading software platform.</p>
      <p style={s.p}>DAlgo is NOT a SEBI-registered investment advisor.</p>
      <p style={s.p}>DAlgo does not provide investment advice.</p>
      <p style={s.p}>All trading decisions and parameters are yours.</p>

      <h2 style={s.h2}>3. Eligibility</h2>
      <ul style={s.ul}>
        <li style={s.li}>You must be 18 years of age or older.</li>
        <li style={s.li}>You must be an Indian resident.</li>
        <li style={s.li}>You must have a valid Zerodha account with API access.</li>
        <li style={s.li}>You must have read and understood our Risk Disclosure.</li>
      </ul>

      <h2 style={s.h2}>4. User Responsibilities</h2>
      <ul style={s.ul}>
        <li style={s.li}>Maintain your Zerodha API key and secret securely.</li>
        <li style={s.li}>Paste a fresh access token daily before market open.</li>
        <li style={s.li}>Review and understand all strategy parameters before enabling auto mode.</li>
        <li style={s.li}>Monitor your account regularly.</li>
        <li style={s.li}>Ensure sufficient funds before enabling auto mode.</li>
      </ul>

      <h2 style={s.h2}>5. Trading Risks</h2>
      <p style={s.p}>
        Markets involve substantial risk of loss. Past performance of DAlgo&apos;s strategies is not indicative of
        future results. You may lose all invested capital.
      </p>

      <h2 style={s.h2}>6. Platform Limitations</h2>
      <ul style={s.ul}>
        <li style={s.li}>Cron jobs may miss ticks due to server load or network issues.</li>
        <li style={s.li}>API rate limits may delay order execution.</li>
        <li style={s.li}>Market circuit breakers may stop execution.</li>
        <li style={s.li}>Zerodha API outages are outside our control.</li>
        <li style={s.li}>DAlgo is not liable for missed trades or execution delays.</li>
      </ul>

      <h2 style={s.h2}>7. Fees and Billing</h2>
      <ul style={s.ul}>
        <li style={s.li}>Monthly subscription fees as per current pricing.</li>
        <li style={s.li}>Access continues until the end of the billing period on cancellation.</li>
        <li style={s.li}>No refunds on partial months.</li>
        <li style={s.li}>Zerodha charges their own brokerage separately.</li>
      </ul>

      <h2 style={s.h2}>8. Intellectual Property</h2>
      <p style={s.p}>The DAlgo platform, code, and strategies are proprietary.</p>
      <p style={s.p}>You may not copy, resell, or reverse engineer the platform.</p>

      <h2 style={s.h2}>9. Termination</h2>
      <p style={s.p}>
        We may suspend or terminate accounts for Terms of Service violations, fraudulent activity, or non-payment,
        with notice where reasonably possible.
      </p>

      <h2 style={s.h2}>10. Limitation of Liability</h2>
      <p style={s.p}>
        DAlgo&apos;s liability is limited to subscription fees paid in the last 3 months. DAlgo is not liable for any
        trading losses, missed opportunities, or consequential damages.
      </p>

      <h2 style={s.h2}>11. Governing Law</h2>
      <p style={s.p}>
        These terms are governed by the laws of Maharashtra, India. Disputes are subject to the exclusive
        jurisdiction of courts in Pune, Maharashtra.
      </p>

      <h2 style={s.h2}>12. Contact</h2>
      <p style={s.p}>support@dalgo.online</p>
    </LegalLayout>
  )
}
