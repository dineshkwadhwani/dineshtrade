import { getProfile } from '@/lib/dalgoAuth'
import { redirect } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  return <AppShell fullName={profile?.full_name ?? undefined}>{children}</AppShell>
}
