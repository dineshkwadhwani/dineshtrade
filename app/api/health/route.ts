// GET /api/health?test=zerodha|ai|email
// Runs the specified integration test and returns structured logs.
// Auth required.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth'
import { getAccountList } from '@/lib/accounts'
import { resolveAccountCreds, kiteRequest } from '@/lib/kite'
import { getState } from '@/lib/state'
import { callAI, getProvider, getModel } from '@/lib/ai'
import { sendTestEmail, isEmailConfigured } from '@/lib/email'

export const dynamic = 'force-dynamic'

type LogLevel = 'info' | 'ok' | 'error' | 'warn'
interface LogLine { level: LogLevel; msg: string }

function log(lines: LogLine[], level: LogLevel, msg: string) {
  lines.push({ level, msg })
}

// ──────── ZERODHA TEST ────────
async function testZerodha(): Promise<LogLine[]> {
  const lines: LogLine[] = []
  log(lines, 'info', 'Checking accounts config...')

  const accounts = getAccountList()
  if (accounts.length === 0) {
    log(lines, 'error', 'No accounts configured in config/accounts.json')
    return lines
  }
  log(lines, 'info', `Found ${accounts.length} account(s): ${accounts.map(a => a.name).join(', ')}`)

  const state = await getState()
  const tokenAccounts = Object.keys(state.kiteTokens)
  if (tokenAccounts.length === 0) {
    log(lines, 'warn', 'No Kite access tokens in state — log in via Zerodha first')
    return lines
  }
  log(lines, 'info', `Access tokens present for: ${tokenAccounts.join(', ')}`)

  for (const account of tokenAccounts) {
    log(lines, 'info', `[${account}] Resolving credentials...`)
    const creds = await resolveAccountCreds(account)
    if (!creds.ok) {
      log(lines, 'error', `[${account}] Creds failed: ${creds.error}`)
      continue
    }
    log(lines, 'ok', `[${account}] API key resolved — calling Kite /user/profile...`)
    try {
      const res = await kiteRequest<{ data?: { user_name?: string; email?: string; broker?: string } }>(
        '/user/profile', creds
      )
      if (res?.data) {
        const { user_name, email, broker } = res.data
        log(lines, 'ok', `[${account}] Connected ✓ — ${user_name} (${email}) via ${broker}`)
      } else {
        log(lines, 'warn', `[${account}] Profile returned empty data — token may be expired`)
      }
    } catch (err) {
      log(lines, 'error', `[${account}] Kite API error: ${String(err).slice(0, 200)}`)
    }
  }
  return lines
}

// ──────── AI TEST ────────
async function testAI(): Promise<LogLine[]> {
  const lines: LogLine[] = []
  let provider: string
  let model: string
  try {
    provider = getProvider()
    model = getModel(provider as any)
  } catch (err) {
    log(lines, 'error', `Config error: ${String(err)}`)
    return lines
  }
  log(lines, 'info', `AI_PROVIDER=${provider}  model=${model}`)
  const envKey = `${provider.toUpperCase()}_AI_API_KEY`
  const keySet = !!process.env[envKey]
  if (!keySet) {
    log(lines, 'error', `${envKey} is not set in environment`)
    return lines
  }
  log(lines, 'info', `${envKey} is set ✓`)
  log(lines, 'info', `Sending test prompt to ${provider}...`)
  const start = Date.now()
  try {
    const result = await callAI({ prompt: 'Reply with exactly: "DineshTrade health check OK"', maxTokens: 50 })
    const ms = Date.now() - start
    if (result.ok) {
      log(lines, 'ok', `Response received in ${ms}ms ✓`)
      log(lines, 'info', `Reply: "${result.text.trim()}"`)
    } else {
      log(lines, 'error', `Call failed (HTTP ${result.status}): ${result.error?.slice(0, 200)}`)
    }
  } catch (err) {
    log(lines, 'error', `Exception: ${String(err).slice(0, 200)}`)
  }
  return lines
}

// ──────── EMAIL TEST ────────
async function testEmail(): Promise<LogLine[]> {
  const lines: LogLine[] = []
  const user = process.env.SMTP_USER
  const passSet = !!process.env.SMTP_PASS
  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = process.env.SMTP_PORT || '587'
  const notifyTo = process.env.NOTIFY_TO || user

  log(lines, 'info', `SMTP_HOST=${host}  SMTP_PORT=${port}`)
  log(lines, 'info', `SMTP_USER=${user || '(not set)'}`)
  log(lines, 'info', `SMTP_PASS=${passSet ? '(set)' : '(NOT SET)'}`)
  log(lines, 'info', `NOTIFY_TO=${notifyTo || '(not set)'}`)

  if (!isEmailConfigured()) {
    log(lines, 'error', 'SMTP not configured — set SMTP_USER and SMTP_PASS in .env.local')
    return lines
  }
  log(lines, 'info', 'Configuration looks good — sending test email...')
  const start = Date.now()
  try {
    const result = await sendTestEmail()
    const ms = Date.now() - start
    if (result.ok) {
      log(lines, 'ok', `Email sent in ${ms}ms ✓  messageId=${result.messageId}`)
      log(lines, 'info', `Delivered to: ${notifyTo}`)
    } else if (result.skipped) {
      log(lines, 'warn', 'SMTP skipped — not configured')
    } else {
      log(lines, 'error', `Send failed: ${result.error?.slice(0, 300)}`)
      if (/invalid login|authentication|EAUTH|535/i.test(result.error || '')) {
        log(lines, 'error', 'Auth failure — regenerate Gmail App Password and update SMTP_PASS')
      }
    }
  } catch (err) {
    log(lines, 'error', `Exception: ${String(err).slice(0, 200)}`)
  }
  return lines
}

// ──────── HANDLER ────────
export async function GET(req: NextRequest) {
  const session = cookies().get('dt_session')?.value
  if (!session || !(await verifySession(session))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const test = req.nextUrl.searchParams.get('test')
  let logs: LogLine[]

  switch (test) {
    case 'zerodha': logs = await testZerodha(); break
    case 'ai':      logs = await testAI();      break
    case 'email':   logs = await testEmail();   break
    default:
      return NextResponse.json({ error: 'Invalid test. Use ?test=zerodha|ai|email' }, { status: 400 })
  }

  const ok = logs.every(l => l.level !== 'error')
  return NextResponse.json({ ok, logs })
}
