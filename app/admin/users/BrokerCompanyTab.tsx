'use client'

import { COLORS, FONT_INTER, FONT_SORA } from '@/components/dalgo/theme'

export default function BrokerCompanyTab() {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: COLORS.muted }}>
      <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.25 }}>🏦</div>
      <p style={{ fontFamily: FONT_SORA, fontSize: 18, fontWeight: 600, color: COLORS.heading, marginBottom: 8 }}>
        Broker Companies
      </p>
      <p style={{ fontFamily: FONT_INTER, fontSize: 14, color: COLORS.muted }}>
        This section is under construction. It will list supported broker companies (e.g. Zerodha, Angel One) and their platform-level configuration.
      </p>
    </div>
  )
}
