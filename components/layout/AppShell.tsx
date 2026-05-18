'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/dashboard', label: 'Dashboard',         icon: '▦' },
  { href: '/watchlist', label: 'Watchlist',         icon: '◎' },
  { href: '/engine',    label: 'Trading Engine',    icon: '⚡' },
  { href: '/holdings',  label: 'Current Holdings',  icon: '◐' },
  { href: '/trades',    label: "Today's Orders",    icon: '≡' },
  { href: '/settings',  label: 'Settings',          icon: '⚙' },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
                className="absolute right-0 top-11 w-56 rounded-xl overflow-hidden z-50 shadow-2xl"
                style={{ background:'#100e0a', border:'1px solid rgba(201,168,76,0.15)' }}>

                {/* Identity header */}
                <div className="px-4 py-3 border-b" style={{ borderColor:'rgba(201,168,76,0.1)' }}>
                  <p className="text-[12px] text-white/70">Dinesh Wadhwani</p>
                  <p className="text-[10px]" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>Trader</p>
                </div>

                {/* Nav links */}
                <div className="py-1">
                  {NAV.map(n => {
                    const active = pathname === n.href
                    return (
                      <Link key={n.href} href={n.href} role="menuitem"
                        className={`flex items-center gap-3 px-4 py-2.5 text-[13px] transition-all ${
                          active
                            ? 'text-[#c9a84c] bg-[rgba(201,168,76,0.08)]'
                            : 'text-white/60 hover:text-white/90 hover:bg-white/5'
                        }`}>
                        <span className="text-base leading-none" style={{ width: '1.2em', textAlign: 'center' }}>{n.icon}</span>
                        <span>{n.label}</span>
                      </Link>
                    )
                  })}
                </div>

                {/* Logout */}
                <button onClick={handleLogout} role="menuitem"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#e05a5e]/80 hover:text-[#e05a5e] hover:bg-white/5 transition-all text-left border-t"
                  style={{ borderColor:'rgba(201,168,76,0.08)' }}>
                  <span className="text-base leading-none" style={{ width: '1.2em', textAlign: 'center' }}>→</span>
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
