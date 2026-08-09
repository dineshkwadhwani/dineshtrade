// app/risk/page.tsx — Phase 7, Task 7.5.

import type { Metadata } from 'next'
import LegalLayout, { legalStyles as s } from '@/components/LegalLayout'

export const metadata: Metadata = {
  title: 'Risk Disclosure — DAlgo',
  robots: { index: false },
}

export default function RiskPage() {
  return (
    <LegalLayout title="Risk Disclosure" lastUpdated="August 2026">
      <div
        style={{
          background: '#FEE2E2',
          border: '1px solid #DC2626',
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          color: '#7F1D1D',
          lineHeight: 1.6,
        }}
      >
        ⚠️ IMPORTANT RISK DISCLOSURE: Trading in equity markets involves substantial risk of loss. You may lose all
        or more than your invested capital. Past performance is not a guarantee of future results. Read this
        document carefully before using DAlgo.
      </div>

      <h2 style={s.h2}>1. General Market Risk</h2>
      <p style={s.p}>
        Equity markets are volatile. Prices can fall sharply and may not recover. Economic conditions, global events,
        and company-specific news can cause sudden large losses.
      </p>

      <h2 style={s.h2}>2. Algorithmic Trading Specific Risks</h2>
      <ul style={s.ul}>
        <li style={s.li}>System failures: server downtime can prevent order execution.</li>
        <li style={s.li}>Network outages: internet connectivity issues can cause missed signals.</li>
        <li style={s.li}>API rate limiting: Zerodha may throttle API calls during peak periods.</li>
        <li style={s.li}>Timing risk: cron-based execution means orders may be placed minutes after a signal fires.</li>
        <li style={s.li}>Configuration risk: incorrect strategy parameters can lead to unintended trades.</li>
      </ul>

      <h2 style={s.h2}>3. Strategy-Specific Risks</h2>
      <ul style={s.ul}>
        <li style={s.li}>
          Mean reversion (Accumulator): works in ranging markets, may produce losses in strong trending markets.
        </li>
        <li style={s.li}>Momentum (Catalyst/Market Boom): can amplify losses if momentum reverses unexpectedly.</li>
        <li style={s.li}>Breakout (Pivotal): false breakouts can trigger losses.</li>
        <li style={s.li}>No strategy guarantees profit in all market conditions.</li>
      </ul>

      <h2 style={s.h2}>4. Capital Risk</h2>
      <ul style={s.ul}>
        <li style={s.li}>Never deploy capital you cannot afford to lose.</li>
        <li style={s.li}>Diversify across strategies and symbols.</li>
        <li style={s.li}>Monitor your account regularly even in auto mode.</li>
      </ul>

      <h2 style={s.h2}>5. Regulatory Risk</h2>
      <p style={s.p}>
        SEBI regulations may change. Tax laws on trading profits may change. Zerodha&apos;s API terms may change.
      </p>

      <h2 style={s.h2}>6. DAlgo Is Not An Advisor</h2>
      <p style={s.p}>
        DAlgo is a software platform only. DAlgo is NOT registered with SEBI as an investment advisor or portfolio
        manager. All strategies, parameters, and trading decisions are entirely yours.
      </p>
      <p style={s.p}>
        We strongly recommend consulting a SEBI-registered investment advisor before deploying significant capital.
      </p>
    </LegalLayout>
  )
}
