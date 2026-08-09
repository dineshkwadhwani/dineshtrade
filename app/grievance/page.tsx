// app/grievance/page.tsx — Phase 7, Task 7.8.

import type { Metadata } from 'next'
import LegalLayout, { legalStyles as s } from '@/components/LegalLayout'

export const metadata: Metadata = {
  title: 'Grievance Redressal — DAlgo',
  robots: { index: false },
}

export default function GrievancePage() {
  return (
    <LegalLayout title="Grievance Redressal" lastUpdated="August 2026">
      <h2 style={s.h2}>1. Grievance Officer</h2>
      <p style={s.p}>Name: Dinesh Wadhwani</p>
      <p style={s.p}>Designation: Founder, DAlgo</p>
      <p style={s.p}>Email: dinesh.k.wadhwani@gmail.com</p>
      <p style={s.p}>Address: Pune, Maharashtra, India 411001</p>
      <p style={s.p}>Hours: Monday to Friday, 10:00 AM – 6:00 PM IST</p>

      <h2 style={s.h2}>2. How to File a Grievance</h2>
      <p style={s.p}>Email support@dalgo.online with:</p>
      <ul style={s.ul}>
        <li style={s.li}>Subject: &quot;Grievance: [brief description]&quot;</li>
        <li style={s.li}>Your registered email address.</li>
        <li style={s.li}>Detailed description of the issue.</li>
        <li style={s.li}>What resolution you are seeking.</li>
        <li style={s.li}>Any supporting documents.</li>
      </ul>

      <h2 style={s.h2}>3. Response Timeline</h2>
      <ul style={s.ul}>
        <li style={s.li}>Acknowledgement: within 3 business days.</li>
        <li style={s.li}>Resolution: within 30 days.</li>
        <li style={s.li}>If unresolved in 30 days: escalation path below.</li>
      </ul>

      <h2 style={s.h2}>4. Escalation</h2>
      <p style={s.p}>If your grievance is not resolved to your satisfaction:</p>
      <ul style={s.ul}>
        <li style={s.li}>
          SEBI SCORES Portal:{' '}
          <a href="https://scores.gov.in" style={{ color: '#3B82F6' }}>
            https://scores.gov.in
          </a>
        </li>
        <li style={s.li}>
          NSE Investor Service:{' '}
          <a href="https://investorhelpline.nsein.in" style={{ color: '#3B82F6' }}>
            https://investorhelpline.nsein.in
          </a>
        </li>
      </ul>

      <h2 style={s.h2}>5. Important Note</h2>
      <p style={s.p}>
        DAlgo is a technology platform — not a broker or investment advisor. For grievances related to:
      </p>
      <ul style={s.ul}>
        <li style={s.li}>Order execution failures → contact Zerodha support.</li>
        <li style={s.li}>Brokerage charges → contact Zerodha support.</li>
        <li style={s.li}>API issues → contact Zerodha developer support.</li>
      </ul>
      <p style={s.p}>For platform-related grievances, we are here to help.</p>
    </LegalLayout>
  )
}
