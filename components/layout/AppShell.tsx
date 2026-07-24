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
      { href: '/health', label: 'Health Check', icon: '⬡' },
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
      { href: '/holdings', label: 'Current Holdings', icon: '◐' },
      { href: '/trades', label: "Today's Orders", icon: '≡', isActive: (pathname, view) => pathname === '/trades' && view !== 'retro' },
      { href: '/positions', label: "Today's Positions", icon: '◈' },
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

export default function AppShell({ children }: { children: React.ReactNode }) {
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
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--dt-bg)' }}>

      <LiveTicker />

      <nav className="sticky top-0 z-50 border-b"
        style={{ background: 'var(--dt-bg-nav)', borderColor: 'var(--dt-nav-border)', backdropFilter: 'blur(12px)' }}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">

          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="accent-text text-2xl leading-none select-none"
              style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 300 }}>
              DW
            </span>
            <span className="text-[11px] tracking-[0.2em] uppercase hidden sm:block"
              style={{ color: 'var(--dt-accent-display)', fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>
              DineshTrade
            </span>
          </Link>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold border transition-all"
              style={{
                background: menuOpen ? 'rgba(93,169,255,0.2)' : 'rgba(93,169,255,0.1)',
                borderColor: 'rgba(93,169,255,0.32)',
                color: '#5da9ff',
                fontFamily: 'Cormorant Garamond, serif',
              }}>
              DW
            </button>

            {menuOpen && (
              <div role="menu"
                className="absolute right-0 top-11 z-50 w-[min(16.75rem,calc(100vw-1rem))] max-h-[calc(100vh-4.5rem)] overflow-y-auto rounded-xl shadow-2xl"
                style={{ background: 'var(--dt-bg-card)', border: '1px solid var(--dt-border-accent)' }}>

                {/* Identity */}
                <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--dt-border)' }}>
                  <p className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--dt-text-primary)' }}>
                    <span>Dinesh Wadhwani</span>
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
                      {light ? 'Light mode' : 'Dark mode'}
                    </span>
                  </div>
                  <button onClick={toggleLight}
                    className="relative w-10 h-5 rounded-full transition-all"
                    style={{
                      background: light ? 'rgba(93,169,255,0.32)' : 'rgba(255,255,255,0.12)',
                      border: `1px solid ${light ? 'rgba(93,169,255,0.55)' : 'rgba(255,255,255,0.22)'}`,
                    }}>
                    <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                      style={{ background: light ? '#5da9ff' : 'rgba(255,255,255,0.5)', left: light ? '1.25rem' : '0.125rem' }} />
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
                      <div className="rounded-lg overflow-hidden"
                        style={{ background: 'var(--dt-surface)', border: '1px solid var(--dt-border)' }}>
                        {group.items.map(item => {
                          const active = item.isActive ? item.isActive(pathname, currentView) : pathname === item.href
                          return (
                            <Link key={item.href} href={item.href} role="menuitem"
                              className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-[11px] transition-all"
                              style={{
                                background: active ? 'rgba(93,169,255,0.12)' : 'transparent',
                                color: active ? '#5da9ff' : 'var(--dt-text-secondary)',
                              }}>
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

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 animate-fade-up">
        {children}
      </main>
    </div>
  )
}
