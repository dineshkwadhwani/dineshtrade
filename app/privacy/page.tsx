// app/privacy/page.tsx — Phase 7, Task 7.3.

import type { Metadata } from 'next'
import LegalLayout, { legalStyles as s } from '@/components/LegalLayout'

export const metadata: Metadata = {
  title: 'Privacy Policy — DAlgo',
  robots: { index: false },
}

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="August 2026">
      <p style={s.p}>
        This Privacy Policy explains how DAlgo Technologies Pvt. Ltd. (&quot;DAlgo&quot;, &quot;we&quot;, &quot;us&quot;)
        collects, uses, stores, and shares your information when you use our automated trading platform. It is
        written to comply with the Information Technology Act, 2000, the Information Technology (Amendment) Act,
        2008, the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or
        Information) Rules, 2011, and applicable GDPR principles.
      </p>

      <h2 style={s.h2}>1. Information We Collect</h2>
      <ul style={s.ul}>
        <li style={s.li}>Name, email, and mobile number — collected when you create an account.</li>
        <li style={s.li}>
          Aadhar card number and images — collected for KYC verification, encrypted at rest in Supabase Storage.
        </li>
        <li style={s.li}>
          Broker API credentials — AES-256 encrypted, never stored in plaintext.
        </li>
        <li style={s.li}>Trading data — your positions, orders, and journal entries.</li>
        <li style={s.li}>
          Session cookie — <strong style={s.strong}>dalgo_access_token</strong> (HttpOnly).
        </li>
      </ul>

      <h2 style={s.h2}>2. Why We Collect It</h2>
      <ul style={s.ul}>
        <li style={s.li}>KYC verification as required by the Prevention of Money Laundering Act (PMLA), 2002.</li>
        <li style={s.li}>Operating the automated trading platform on your behalf.</li>
        <li style={s.li}>Sending trade notifications and alerts.</li>
        <li style={s.li}>Improving platform performance.</li>
      </ul>

      <h2 style={s.h2}>3. How We Store It</h2>
      <ul style={s.ul}>
        <li style={s.li}>Database: Supabase PostgreSQL, hosted in the ap-south-1 (Mumbai) region.</li>
        <li style={s.li}>KYC documents: Supabase Storage, in a private bucket accessible only via signed URLs.</li>
        <li style={s.li}>
          Broker credentials: AES-256-GCM encrypted before storage, decrypted only at trade execution time.
        </li>
        <li style={s.li}>No data is stored outside India.</li>
      </ul>

      <h2 style={s.h2}>4. Who We Share It With</h2>
      <ul style={s.ul}>
        <li style={s.li}>Zerodha Kite Connect API — to execute your trades.</li>
        <li style={s.li}>Resend — email delivery only (name and email).</li>
        <li style={s.li}>Supabase — database and storage provider.</li>
      </ul>
      <p style={s.p}>We never sell your data to any third party, ever.</p>

      <h2 style={s.h2}>5. Data Retention</h2>
      <ul style={s.ul}>
        <li style={s.li}>KYC documents: retained 5 years after account closure, per PMLA 2002.</li>
        <li style={s.li}>Trading journal: retained 7 years, per the IT Act.</li>
        <li style={s.li}>
          Account data: deleted within 30 days of a written deletion request, subject to legal retention
          requirements.
        </li>
      </ul>

      <h2 style={s.h2}>6. Your Rights</h2>
      <ul style={s.ul}>
        <li style={s.li}>
          <strong style={s.strong}>Access:</strong> request a copy of your data at any time.
        </li>
        <li style={s.li}>
          <strong style={s.strong}>Correction:</strong> update incorrect information.
        </li>
        <li style={s.li}>
          <strong style={s.strong}>Deletion:</strong> request account deletion.
        </li>
        <li style={s.li}>
          <strong style={s.strong}>Contact:</strong> support@dalgo.online for all requests.
        </li>
      </ul>

      <h2 style={s.h2}>7. Cookies</h2>
      <ul style={s.ul}>
        <li style={s.li}>One cookie only: dalgo_access_token.</li>
        <li style={s.li}>HttpOnly, Secure, SameSite=Lax.</li>
        <li style={s.li}>Expires at midnight IST daily.</li>
        <li style={s.li}>Required for login — cannot be disabled while logged in.</li>
        <li style={s.li}>No tracking, advertising, or third-party cookies.</li>
      </ul>

      <h2 style={s.h2}>8. Security</h2>
      <ul style={s.ul}>
        <li style={s.li}>All connections are encrypted via TLS.</li>
        <li style={s.li}>Broker credentials are encrypted with AES-256-GCM.</li>
        <li style={s.li}>Access tokens are never logged or exposed in responses.</li>
        <li style={s.li}>Regular security reviews.</li>
      </ul>

      <h2 style={s.h2}>9. Contact</h2>
      <p style={s.p}>Privacy Officer: Dinesh Wadhwani</p>
      <p style={s.p}>Email: support@dalgo.online</p>
      <p style={s.p}>We respond to all privacy requests within 30 days.</p>
    </LegalLayout>
  )
}
