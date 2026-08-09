// components/LegalLayout.tsx — Phase 7, Task 7.2.
//
// Shared shell for every public legal page (/privacy, /terms, /risk,
// /cookies, /refund, /grievance) plus /about and /contact. Colors reuse the
// same tokens as components/dalgo/theme.ts (COLORS.pageBg/border/heading/
// body/muted all match the hex values Task 7.2 specifies exactly), so this
// imports from there rather than re-declaring a second copy.
//
// `legalStyles` is exported alongside the component because React doesn't
// cascade parent inline styles onto children — each legal page's own h2/p/ul
// elements need to import and apply these directly rather than relying on
// LegalLayout to style content it doesn't render itself.

import { COLORS, FONT_SORA, FONT_INTER, FONT_LINK_HREF } from '@/components/dalgo/theme'

export const legalStyles: Record<string, React.CSSProperties> = {
  h2: {
    fontFamily: FONT_SORA,
    fontWeight: 600,
    fontSize: 18,
    color: COLORS.heading,
    marginTop: 32,
    marginBottom: 8,
  },
  p: {
    fontFamily: FONT_INTER,
    fontWeight: 400,
    fontSize: 15,
    color: COLORS.body,
    lineHeight: 1.8,
    margin: '0 0 12px',
  },
  ul: {
    fontFamily: FONT_INTER,
    fontWeight: 400,
    fontSize: 15,
    color: COLORS.body,
    lineHeight: 1.8,
    margin: '0 0 12px',
    paddingLeft: 22,
  },
  li: {
    marginBottom: 4,
  },
  strong: {
    color: COLORS.heading,
    fontWeight: 600,
  },
}

const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/risk', label: 'Risk' },
  { href: '/contact', label: 'Contact' },
]

export default function LegalLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string
  lastUpdated: string
  children: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100vh', background: COLORS.pageBg, display: 'flex', flexDirection: 'column' }}>
      <link rel="stylesheet" href={FONT_LINK_HREF} />

      {/* NAV */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: `1px solid ${COLORS.border}`,
          background: '#fff',
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: FONT_SORA,
            fontWeight: 700,
            fontSize: 24,
            textDecoration: 'none',
            letterSpacing: '-0.02em',
          }}
        >
          <span style={{ color: COLORS.logoD }}>D</span>
          <span style={{ color: COLORS.logoA }}>A</span>
          <span style={{ color: COLORS.logoD }}>lgo</span>
        </a>
        <a
          href="/login"
          style={{
            fontFamily: FONT_INTER,
            fontWeight: 500,
            fontSize: 13,
            color: '#fff',
            background: COLORS.primary,
            padding: '8px 18px',
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          Log in
        </a>
      </nav>

      {/* MAIN */}
      <main style={{ flex: 1, maxWidth: 720, width: '100%', margin: '0 auto', padding: '32px 16px' }}>
        <div
          style={{
            background: '#FFFFFF',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: 40,
          }}
        >
          <h1 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 28, color: COLORS.heading, marginBottom: 8, marginTop: 0 }}>
            {title}
          </h1>
          <p style={{ fontFamily: FONT_INTER, fontWeight: 400, fontSize: 13, color: COLORS.muted, margin: '0 0 24px' }}>
            Last updated: {lastUpdated}
          </p>

          {children}

          <footer style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 24, marginTop: 40 }}>
            <div style={{ fontFamily: FONT_INTER, fontWeight: 400, fontSize: 13, color: COLORS.muted, marginBottom: 8 }}>
              © 2026 DAlgo. All rights reserved.
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {FOOTER_LINKS.map((l, i) => (
                <span key={l.href} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {i > 0 && <span style={{ color: COLORS.muted, fontSize: 13 }}>|</span>}
                  <a
                    href={l.href}
                    style={{ fontFamily: FONT_INTER, fontWeight: 400, fontSize: 13, color: COLORS.muted, textDecoration: 'none' }}
                  >
                    {l.label}
                  </a>
                </span>
              ))}
            </div>
          </footer>
        </div>
      </main>
    </div>
  )
}
