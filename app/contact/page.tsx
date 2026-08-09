// app/contact/page.tsx — Phase 7, Task 7.10.

import type { Metadata } from 'next'
import LegalLayout, { legalStyles as s } from '@/components/LegalLayout'
import ContactForm from './ContactForm'

export const metadata: Metadata = {
  title: 'Contact Us — DAlgo',
  robots: { index: false },
}

export default function ContactPage() {
  return (
    <LegalLayout title="Contact Us" lastUpdated="August 2026">
      <p style={s.p}>Email: support@dalgo.online</p>
      <p style={s.p}>Response time: within 2 business days.</p>
      <p style={s.p}>
        For trading support: include your registered email and a description of the issue.
      </p>

      <ContactForm />
    </LegalLayout>
  )
}
