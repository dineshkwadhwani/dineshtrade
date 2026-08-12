'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import LiveTicker from '@/components/LiveTicker'

interface NavItem {
  href: string
  label: string
  icon: string
  isActive?: (pathname: string, view: string | null) => boolean
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Account',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: '▦' },
      { href: '/settings', label: 'Settings', icon: '⚙' },
    ],
  },
  {
    title: 'Lists',
    items: [
      { href: '/watchlist', label: 'Watchlist', icon: '◎' },
      { href: '/manage-lists', label: 'Manage Lists', icon: '✎' },
      { href: '/pivotal-lists', label: 'Pivotal Lists', icon: '◭' },
    ],
  },
  {
    title: 'Trades',
    items: [
      { href: '/engine', label: 'Trading Engine', icon: '⚡' },
      { href: '/holdings', label: 'Holdings', icon: '◐' },
      { href: '/trades', label: 'Orders', icon: '≡', isActive: (pathname, view) => pathname === '/trades' && view !== 'retro' },
      { href: '/positions', label: 'Open Positions', icon: '◈' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { href: '/skipped-orders', label: 'Skipped Orders', icon: '⊘' },
      { href: '/trade-report', label: 'Trade Reports', icon: '▤' },
      { href: '/trades?view=retro', label: 'Retrospection Report', icon: '◫', isActive: (pathname, view) => pathname === '/trades' && view === 'retro' },
    ],
  },
]

export default function AppShell({ children, fullName, tokenExpired }: { children: React.ReactNode; fullName?: string; tokenExpired?: boolean }) {
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const currentView = searchParams.get('view')
  const [light, setLight] = useState(false)

  // Apply persisted light mode on mount
  useEffect(() => {
    const stored = localStorage.getItem('dt-light') === '1'
    setLight(stored)
    document.documentElement.classList.toggle('light', stored)
  }, [])

  function toggleLight() {
    const next = !light
    setLight(next)
    document.documentElement.classList.toggle('light', next)
    localStorage.setItem('dt-light', next ? '1' : '0')
  }

  // Close on outside click + Escape
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen])

  useEffect(() => { setMenuOpen(false) }, [pathname])

  async function handleLogout() {
    // Clear both V1 dt_session and DAlgo dalgo_access_token
    await Promise.all([
      fetch('/api/auth', { method: 'DELETE' }),
      fetch('/api/dalgo/auth/logout', { method: 'POST' }),
    ])
    router.push('/login')
  }

  return (
    <div className="dt-app-shell min-h-screen flex flex-col">

      <LiveTicker />

      <nav className="dt-topnav sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">

          <Link href="/dashboard" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontFamily: "'Sora', sans-serif", fontWeight: 800, fontSize: 22, color: '#1E3A8A', letterSpacing: '-0.01em' }}>D</span>
            <span style={{ fontFamily: "'Sora', sans-serif", fontWeight: 800, fontSize: 22, color: '#F59E0B', letterSpacing: '-0.01em' }}>A</span>
            <span style={{ fontFamily: "'Sora', sans-serif", fontWeight: 800, fontSize: 22, color: '#1E3A8A', letterSpacing: '-0.01em' }}>lgo</span>
          </Link>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              style={{
                width: 36, height: 36, borderRadius: '50%', border: '1px solid #BFDBFE',
                background: menuOpen ? '#DBEAFE' : '#EFF6FF',
                color: '#1E3A8A', fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 13,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              {(fullName ?? 'T').charAt(0).toUpperCase()}
            </button>

            {menuOpen && (
              <div role="menu"
                className="dt-menu-panel absolute right-0 top-11 z-50 w-[min(16.75rem,calc(100vw-1rem))] max-h-[calc(100vh-4.5rem)] overflow-y-auto rounded-xl shadow-2xl">

                {/* Identity */}
                <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--dt-border)' }}>
                  <p className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--dt-text-primary)' }}>
                    <span>{fullName ?? 'Trader'}</span>
                    <span
                      className="text-[8px] tracking-[0.18em] uppercase"
                      style={{ color: 'var(--dt-accent-display)', fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>
                      Trader
                    </span>
                  </p>
                </div>

                {/* Light mode toggle */}
                <div className="px-3 py-2 flex items-center justify-between border-b"
                  style={{ borderColor: 'var(--dt-border)' }}>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 14 }}>{light ? '☀️' : '🌙'}</span>
                    <span className="text-[11px]"
                      style={{ color: 'var(--dt-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                      Theme: {light ? 'Light' : 'Dark'}
                    </span>
                  </div>
                  <button onClick={toggleLight}
                    aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
                    className="dt-theme-switch"
                    data-on={light ? '1' : '0'}>
                    <span className="dt-theme-switch-thumb" />
                  </button>
                </div>

                {/* Nav links */}
                <div className="py-0.5">
                  {NAV_GROUPS.map(group => (
                    <div key={group.title} className="px-1 pb-0.5 last:pb-0">
                      <p className="px-2 pb-0.5 text-[8px] tracking-[0.2em] uppercase"
                        style={{ color: 'var(--dt-accent-display)', fontFamily: 'JetBrains Mono, monospace', opacity: 0.65 }}>
                        {group.title}
                      </p>
                      <div className="dt-menu-section rounded-lg overflow-hidden">
                        {group.items.map(item => {
                          const active = item.isActive ? item.isActive(pathname, currentView) : pathname === item.href
                          return (
                            <Link key={item.href} href={item.href} role="menuitem"
                              className="dt-menu-link flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-[11px] transition-all"
                              data-active={active ? '1' : '0'}>
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="text-[13px] leading-none opacity-80" style={{ width: '1em', textAlign: 'center' }}>{item.icon}</span>
                                <span className="truncate">{item.label}</span>
                              </span>
                              {active && (
                                <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: '#5da9ff' }} />
                              )}
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Logout */}
                <button onClick={handleLogout} role="menuitem"
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] transition-all text-left border-t"
                  style={{ color: '#e05a5e', borderColor: 'var(--dt-border)' }}>
                  <span className="text-[13px] leading-none opacity-80" style={{ width: '1em', textAlign: 'center' }}>→</span>
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {tokenExpired && !bannerDismissed && (
        <div
          role="alert"
          style={{
            background: 'rgba(245,158,11,0.12)',
            borderBottom: '1px solid rgba(245,158,11,0.35)',
            color: 'rgba(245,158,11,1)',
          }}
          className="w-full px-4 py-2.5 flex items-center justify-center gap-3 text-[12px]"
        >
          <span style={{ fontSize: 15 }}>⚠</span>
          <span>
            Your Zerodha token has expired — automated trading is paused.{' '}
            <Link href="/settings" className="underline font-semibold" style={{ color: 'rgba(245,158,11,1)' }}>
              Go to Settings → Connection
            </Link>{' '}
            to reconnect.
          </span>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
            style={{ marginLeft: 8, opacity: 0.6, lineHeight: 1, fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 animate-fade-up">
        {children}
      </main>
    </div>
  )
}
