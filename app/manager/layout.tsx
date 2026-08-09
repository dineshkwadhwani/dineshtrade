import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/dalgoAuth'
import DalgoShell, { type DalgoNavItem } from '@/components/dalgo/DalgoShell'
import { FONT_LINK_HREF } from '@/components/dalgo/theme'

// Task 6.1 — shared Account Manager layout. See app/admin/layout.tsx's header
// comment for why this is a plain nested layout rather than a `(manager)`
// route group.
const MANAGER_NAV: DalgoNavItem[] = [
  { label: 'Dashboard', href: '/manager' },
  { label: 'My Customers', href: '/manager/customers' },
  { label: 'Registrations', href: '/manager/registrations' },
  { label: 'Reports', href: '/manager/reports' },
]

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'account_manager') redirect('/login')

  return (
    <>
      <link rel="stylesheet" href={FONT_LINK_HREF} />
      <DalgoShell profile={profile} navItems={MANAGER_NAV} logoHref="/manager">
        {children}
      </DalgoShell>
    </>
  )
}
