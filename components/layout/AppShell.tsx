'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href:'/dashboard', label:'Dashboard',       icon:'▦' },
  { href:'/watchlist', label:'Watchlist',        icon:'◎' },
  { href:'/engine',    label:'Trading Engine',   icon:'⚡' },
  { href:'/trades',    label:"Today's Trades",   icon:'≡'  },
  { href:'/settings',  label:'Settings',         icon:'⚙'  },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#080604]">

      {/* Top nav */}
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

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {NAV.filter(n => n.href !== '/settings').map(n => (
              <Link key={n.href} href={n.href}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium tracking-wide transition-all ${
                  pathname === n.href
                    ? 'text-[#c9a84c] bg-[rgba(201,168,76,0.08)]'
                    : 'text-white/40 hover:text-white/70'
                }`}>
                {n.label}
              </Link>
            ))}
          </div>

          {/* DW Avatar */}
          <div className="relative">
            <button onClick={() => setMenuOpen(!menuOpen)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold border transition-all"
              style={{
                background:'rgba(201,168,76,0.1)',
                borderColor:'rgba(201,168,76,0.3)',
                color:'#c9a84c',
                fontFamily:'Cormorant Garamond, serif',
              }}>
              DW
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-11 w-48 rounded-xl overflow-hidden z-50 shadow-2xl"
                style={{ background:'#100e0a', border:'1px solid rgba(201,168,76,0.15)' }}>
                <div className="px-4 py-3 border-b" style={{ borderColor:'rgba(201,168,76,0.1)' }}>
                  <p className="text-[11px] text-white/60">Dinesh Wadhwani</p>
                  <p className="text-[10px]" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>Trader</p>
                </div>
                <Link href="/settings" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/5 transition-all">
                  <span>⚙</span> Settings
                </Link>
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-3 text-[12px] text-[#e05a5e]/70 hover:text-[#e05a5e] hover:bg-white/5 transition-all text-left border-t"
                  style={{ borderColor:'rgba(201,168,76,0.08)' }}>
                  <span>→</span> Logout
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

      {/* Mobile bottom nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t"
        style={{ background:'rgba(8,6,4,0.97)', borderColor:'rgba(201,168,76,0.12)', backdropFilter:'blur(12px)' }}>
        <div className="flex">
          {NAV.map(n => (
            <Link key={n.href} href={n.href}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-all ${
                pathname === n.href ? 'text-[#c9a84c]' : 'text-white/30'
              }`}>
              <span className="text-base leading-none">{n.icon}</span>
              <span className="text-[8px] tracking-wide leading-none">{n.label.split(' ')[0]}</span>
            </Link>
          ))}
        </div>
        <div style={{ height:'env(safe-area-inset-bottom,0px)' }} />
      </div>

      {/* Bottom padding for mobile nav */}
      <div className="md:hidden h-16" />
    </div>
  )
}
