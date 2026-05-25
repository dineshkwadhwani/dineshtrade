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

  // Close on route change
  useEffect(() => { setMenuOpen(false) }, [pathname])

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#080604]">

      {/* Live indices ticker — top strip, persistent across all pages */}
      <LiveTicker />

      {/* Top nav — logo + DW menu only */}
      <nav className="sticky top-0 z-50 border-b"
        style={{ background:'rgba(8,6,4,0.95)', borderColor:'rgba(201,168,76,0.12)', backdropFilter:'blur(12px)' }}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">

          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="gold-text text-2xl leading-none select-none"
              style={{ fontFamily:'Cormorant Garamond, Georgia, serif', fontWeight:300 }}>
              DW
            </span>
            <span className="text-[11px] tracking-[0.2em] uppercase hidden sm:block"
              style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
              DineshTrade
            </span>
          </Link>

          {/* DW avatar + dropdown — only nav surface */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold border transition-all"
              style={{
                background: menuOpen ? 'rgba(201,168,76,0.2)' : 'rgba(201,168,76,0.1)',
                borderColor: 'rgba(201,168,76,0.3)',
                color: '#c9a84c',
                fontFamily: 'Cormorant Garamond, serif',
              }}>
              DW
            </button>

            {menuOpen && (
              <div role="menu"
                className="absolute right-0 top-11 z-50 w-[min(19rem,calc(100vw-1rem))] max-h-[calc(100vh-4.5rem)] overflow-y-auto rounded-xl shadow-2xl"
                style={{ background:'#100e0a', border:'1px solid rgba(201,168,76,0.15)' }}>

                {/* Identity header */}
                <div className="px-3.5 py-2.5 border-b" style={{ borderColor:'rgba(201,168,76,0.1)' }}>
                  <p className="text-[11px] text-white/75">Dinesh Wadhwani</p>
                  <p className="text-[9px] tracking-[0.2em] uppercase" style={{ color:'rgba(201,168,76,0.48)', fontFamily:'JetBrains Mono, monospace' }}>Trader</p>
                </div>

                {/* Nav links */}
                <div className="py-1.5">
                  {NAV_GROUPS.map(group => (
                    <div key={group.title} className="px-1.5 pb-1.5 last:pb-0">
                      <p className="px-2 pb-1 text-[9px] tracking-[0.24em] uppercase"
                        style={{ color:'rgba(201,168,76,0.45)', fontFamily:'JetBrains Mono, monospace' }}>
                        {group.title}
                      </p>
                      <div className="rounded-lg overflow-hidden" style={{ background:'rgba(255,255,255,0.015)', border:'1px solid rgba(255,255,255,0.04)' }}>
                        {group.items.map(item => {
                          const active = item.isActive ? item.isActive(pathname, currentView) : pathname === item.href
                          return (
                            <Link key={item.href} href={item.href} role="menuitem"
                              className={`flex items-center justify-between gap-2.5 px-3 py-2 text-[12px] transition-all ${
                                active
                                  ? 'text-[#c9a84c] bg-[rgba(201,168,76,0.08)]'
                                  : 'text-white/60 hover:text-white/90 hover:bg-white/5'
                              }`}>
                              <span className="flex min-w-0 items-center gap-2.5">
                                <span className="text-[14px] leading-none opacity-90" style={{ width: '1.1em', textAlign: 'center' }}>{item.icon}</span>
                                <span className="truncate">{item.label}</span>
                              </span>
                              {active && (
                                <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background:'#c9a84c' }} />
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
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-[#e05a5e]/80 hover:text-[#e05a5e] hover:bg-white/5 transition-all text-left border-t"
                  style={{ borderColor:'rgba(201,168,76,0.08)' }}>
                  <span className="text-[14px] leading-none" style={{ width: '1.1em', textAlign: 'center' }}>→</span>
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Page content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 animate-fade-up">
        {children}
      </main>
    </div>
  )
}
