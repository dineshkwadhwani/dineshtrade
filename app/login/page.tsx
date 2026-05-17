import LoginClient from './LoginClient'
import { getPasswordHint } from '@/lib/auth'
import { isMarketOpen, getISTDateTime } from '@/lib/market'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function LoginPage() {
  const session = await getSession()
  if (session) redirect('/dashboard')

  const hint = getPasswordHint()
  const market = isMarketOpen()
  const datetime = getISTDateTime()

  return <LoginClient hint={hint} market={market} datetime={datetime} />
}
