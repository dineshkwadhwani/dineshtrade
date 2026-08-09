// app/refund/page.tsx — Phase 7, Task 7.7.

import type { Metadata } from 'next'
import LegalLayout, { legalStyles as s } from '@/components/LegalLayout'

export const metadata: Metadata = {
  title: 'Refund Policy — DAlgo',
  robots: { index: false },
}

export default function RefundPage() {
  return (
    <LegalLayout title="Refund Policy" lastUpdated="August 2026">
      <h2 style={s.h2}>1. Subscription Billing</h2>
      <p style={s.p}>DAlgo subscriptions are billed monthly on the date you first subscribed.</p>

      <h2 style={s.h2}>2. Cancellation</h2>
      <ul style={s.ul}>
        <li style={s.li}>Cancel anytime from your account settings.</li>
        <li style={s.li}>Access continues until the end of your current billing period.</li>
        <li style={s.li}>No further charges after cancellation.</li>
      </ul>

      <h2 style={s.h2}>3. Refund Policy</h2>
      <ul style={s.ul}>
        <li style={s.li}>No refunds on partial months.</li>
        <li style={s.li}>
          No refunds based on trading performance — DAlgo is a software platform, not responsible for trading
          outcomes.
        </li>
        <li style={s.li}>
          Refunds for billing errors (charged incorrectly) within 7 days: email support@dalgo.online with subject
          &quot;Billing Error&quot; and your transaction ID.
        </li>
        <li style={s.li}>Razorpay is our payment processor (coming soon).</li>
      </ul>

      <h2 style={s.h2}>4. Account Deletion</h2>
      <p style={s.p}>
        Deleting your account does not automatically cancel your subscription. Cancel first, then request deletion.
      </p>

      <h2 style={s.h2}>5. Contact</h2>
      <p style={s.p}>support@dalgo.online</p>
      <p style={s.p}>Response within 2 business days.</p>
    </LegalLayout>
  )
}
