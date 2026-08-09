'use client'

// Shared top nav + side nav (desktop) / bottom nav (mobile) shell for the
// SuperAdmin (/admin/*) and Account Manager (/manager/*) dashboards
// (Phase 6, Task 6.1). One component, parameterised by navItems/logoHref so
// app/admin/layout.tsx and app/manager/layout.tsx can both use it without
// duplicating the nav chrome.

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { COLORS, FONT_INTER, FONT_SORA } from './theme'
import { Badge, ROLE_LABELS } from './ui'

export interface DalgoNavItem {
  label: string
  href: string
}

export interface DalgoShellProfile {
  full_name: string
  email: string
  role: string
}

interface Props {
  profile: DalgoShellProfile
  navItems: DalgoNavItem[]
  logoHref: string
  children: React.ReactNode
}

function isActive(pathname: string, href: string, rootHref: string): boolean {
  if (href === rootHref) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function Logo() {
  return (
    <span style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 22 }}>
      <span style={{ color: COLORS.logoD }}>D</span>
      <span style={{ color: COLORS.logoA }}>A</span>
      <span style={{ color: COLORS.logoD }}>lgo</span>
    </span>
  )
}

export default function DalgoShell({ profile, navItems, logoHref, children }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/api/dalgo/auth/logout', { method: 'POST' })
    } finally {
      router.push('/login')
      router.refresh()
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: COLORS.pageBg, fontFamily: FONT_INTER }}>
      {/* ---- Top bar ---- */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          background: COLORS.cardBg,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <Link href={logoHref} style={{ textDecoration: 'none' }}>
          <Logo />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hidden sm:block" style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.heading }}>{profile.full_name}</div>
            <div style={{ fontSize: 11, color: COLORS.muted }}>{profile.email}</div>
          </div>
          <Badge tone="teal">{ROLE_LABELS[profile.role] ?? profile.role}</Badge>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            style={{
              fontFamily: FONT_INTER,
              fontSize: 12,
              fontWeight: 500,
              color: COLORS.heading,
              background: '#fff',
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              padding: '6px 12px',
              cursor: loggingOut ? 'default' : 'pointer',
              opacity: loggingOut ? 0.6 : 1,
            }}
          >
            {loggingOut ? 'Logging out…' : 'Logout'}
          </button>
        </div>
      </header>

      <div style={{ display: 'flex' }}>
        {/* ---- Side nav (desktop) ---- */}
        <nav
          className="hidden md:block"
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: `1px solid ${COLORS.border}`,
            minHeight: 'calc(100vh - 49px)',
            padding: '16px 12px',
          }}
        >
          {navItems.map(item => {
            const active = isActive(pathname, item.href, navItems[0].href)
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '9px 12px',
                  marginBottom: 2,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  textDecoration: 'none',
                  color: active ? COLORS.primary : COLORS.body,
                  background: active ? '#EFF6FF' : 'transparent',
                }}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* ---- Page content ---- */}
        <main style={{ flex: 1, padding: 24, paddingBottom: 84, minWidth: 0 }}>{children}</main>
      </div>

      {/* ---- Bottom nav (mobile) ---- */}
      <nav
        className="md:hidden"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          display: 'flex',
          overflowX: 'auto',
          background: COLORS.cardBg,
          borderTop: `1px solid ${COLORS.border}`,
          padding: '6px 4px',
        }}
      >
        {navItems.map(item => {
          const active = isActive(pathname, item.href, navItems[0].href)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                flex: '0 0 auto',
                textAlign: 'center',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 500,
                textDecoration: 'none',
                color: active ? COLORS.primary : COLORS.body,
                whiteSpace: 'nowrap',
                borderBottom: active ? `2px solid ${COLORS.primary}` : '2px solid transparent',
              }}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
