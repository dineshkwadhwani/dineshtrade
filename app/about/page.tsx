// app/about/page.tsx — Phase 7, Task 7.9.

import type { Metadata } from 'next'
import LegalLayout, { legalStyles as s } from '@/components/LegalLayout'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'

export const metadata: Metadata = {
  title: 'About DAlgo',
  robots: { index: false },
}

const TRACK_RECORD = [
  { account: 'Dinesh', pnl: '₹7,28,820', roc: '17.5% (FY23-24)' },
  { account: 'Kiran', pnl: '₹27,68,752', roc: '20.8% (FY23-24)' },
  { account: 'Sheela', pnl: '₹19,35,215', roc: '11.1% (FY23-24)' },
  { account: 'Sonia', pnl: '₹4,96,373', roc: '2.2% (FY24-26)' },
  { account: 'TOTAL', pnl: '₹59,28,726', roc: '₹26.56L in one year' },
]

export default function AboutPage() {
  return (
    <LegalLayout title="About DAlgo" lastUpdated="August 2026">
      <h2 style={s.h2}>Our Story</h2>
      <p style={s.p}>
        DAlgo was built by Dinesh Wadhwani, a retail trader from Pune who spent years developing a disciplined,
        rules-based approach to NSE equity trading. After 6 years of trading across 4 family accounts with verified
        results, he built DAlgo to automate what was working — and to make that same discipline available to every
        Indian retail investor.
      </p>

      <h2 style={s.h2}>Verified Track Record</h2>
      <div style={{ overflowX: 'auto', margin: '0 0 12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT_INTER, fontSize: 14 }}>
          <thead>
            <tr>
              <th style={thStyle}>Account</th>
              <th style={thStyle}>Net P&amp;L (FY2020–2026)</th>
              <th style={thStyle}>Best Year ROC</th>
            </tr>
          </thead>
          <tbody>
            {TRACK_RECORD.map(row => (
              <tr key={row.account} style={row.account === 'TOTAL' ? { fontWeight: 700 } : undefined}>
                <td style={tdStyle}>{row.account}</td>
                <td style={tdStyle}>{row.pnl}</td>
                <td style={tdStyle}>{row.roc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ ...s.p, fontSize: 13, color: COLORS.muted }}>
        Figures are net realised P&amp;L from official broker reports. Past performance is not indicative of future
        results.
      </p>

      <h2 style={s.h2}>Our Philosophy</h2>
      <ul style={s.ul}>
        <li style={s.li}>Never sell at a loss in auto mode.</li>
        <li style={s.li}>Blue-chip stocks on dips always recover.</li>
        <li style={s.li}>Consistent, rules-based execution beats emotional trading.</li>
        <li style={s.li}>Capital velocity: free capital quickly, redeploy faster.</li>
      </ul>

      <h2 style={s.h2}>What We Built</h2>
      <p style={s.p}>
        DAlgo runs three proven strategies: Accumulator (mean reversion), Catalyst (momentum), and Pivotal
        (breakout). Each is backtested, parameter-tunable, and fully automated.
      </p>

      <h2 style={s.h2}>Built With</h2>
      <p style={s.p}>Next.js 14, Supabase, Zerodha Kite Connect, AWS EC2 (ap-south-1), Resend</p>

      <h2 style={s.h2}>Contact</h2>
      <p style={s.p}>Dinesh Wadhwani</p>
      <p style={s.p}>dinesh.k.wadhwani@gmail.com</p>
      <p style={s.p}>Pune, Maharashtra, India</p>
    </LegalLayout>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: COLORS.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: `1px solid ${COLORS.border}`,
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: COLORS.body,
  borderBottom: '1px solid #EFF6FF',
  whiteSpace: 'nowrap',
}
