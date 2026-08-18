import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/dalgoAuth'
import DalgoShell, { type DalgoNavItem } from '@/components/dalgo/DalgoShell'
import { FONT_LINK_HREF } from '@/components/dalgo/theme'

// Task 6.1 — shared SuperAdmin layout.
//
// Deviates from the spec's literal `app/(admin)/layout.tsx` path: this repo's
// Phase 1 already built the SuperAdmin pages at the plain (non-route-group)
// `app/admin/` segment, which every /admin/** page already lives under. A
// Next.js route-group folder like `app/(admin)/` does not itself add a URL
// segment, so wrapping `app/admin/page.tsx` would actually require moving it
// to `app/(admin)/admin/page.tsx` — a pointless rename with no behavioural
// difference. A plain nested `app/admin/layout.tsx` achieves the same "shared
// layout for every /admin/* route" outcome with zero URL disruption, so that's
// what's built here (and for app/manager/layout.tsx below).
//
// Role check here is defense-in-depth: middleware.ts already redirects
// non-superadmin sessions away from /admin/* at the edge before this ever
// renders.
const ADMIN_NAV: DalgoNavItem[] = [
  { label: 'Dashboard', href: '/admin' },
  { label: 'Trading Engine', href: '/admin/engine' },
  { label: 'Health Check', href: '/admin/health' },
  { label: 'Registrations', href: '/admin/registrations' },
  { label: 'Users', href: '/admin/users' },
  { label: 'Platform Strategies', href: '/admin/strategies' },
  { label: 'Watchlists', href: '/admin/watchlists' },
  { label: 'Fixed Rules', href: '/admin/fixed-rules' },
  { label: 'Platform Config', href: '/admin/config' },
  { label: 'Reports', href: '/admin/reports' },
  { label: 'Audit Log', href: '/admin/audit' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'superadmin') redirect('/login')

  return (
    <>
      <link rel="stylesheet" href={FONT_LINK_HREF} />
      <DalgoShell profile={profile} navItems={ADMIN_NAV} logoHref="/admin">
        {children}
      </DalgoShell>
    </>
  )
}
