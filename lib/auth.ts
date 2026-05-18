import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || 'dineshtrade-secret-2026')
const COOKIE = 'dt_session'

// Password = ddmmyyyyhh based on current IST time
export function getExpectedPassword(): string {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dd   = String(ist.getDate()).padStart(2,'0')
  const mm   = String(ist.getMonth()+1).padStart(2,'0')
  const yyyy = String(ist.getFullYear())
  const hh   = String(ist.getHours()).padStart(2,'0')
  return `${dd}${mm}${yyyy}${hh}`
}

// Password hint shown on login screen
export function getPasswordHint(): { date: string; time: string; hint: string } {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dd   = String(ist.getDate()).padStart(2,'0')
  const mm   = String(ist.getMonth()+1).padStart(2,'0')
  const yyyy = String(ist.getFullYear())
  const hh   = String(ist.getHours()).padStart(2,'0')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return {
    date: `${ist.getDate()} ${months[ist.getMonth()]} ${yyyy}`,
    time: `${hh}:00 IST`,
    hint: `${dd}${mm}${yyyy}${hh}`
  }
}

export async function createSession(): Promise<string> {
  // Session expires at midnight IST
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const midnight = new Date(ist)
  midnight.setDate(midnight.getDate()+1)
  midnight.setHours(0,0,0,0)
  const expiresIn = Math.floor((midnight.getTime() - ist.getTime()) / 1000)

  const token = await new SignJWT({ user: 'dinesh', role: 'trader' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(SECRET)
  return token
}

export async function verifySession(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, SECRET)
    return true
  } catch { return false }
}

export async function getSession(): Promise<boolean> {
  const token = cookies().get(COOKIE)?.value
  if (!token) return false
  return verifySession(token)
}

// Used by middleware (Edge runtime) — reads cookie from the request directly
// because next/headers cookies() is not available in middleware.
export async function requireAuth(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(COOKIE)?.value
  if (!token) return false
  return verifySession(token)
}
