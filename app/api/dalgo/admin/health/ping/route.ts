// GET  /api/dalgo/admin/health/ping?type=db|ai|zerodha
// POST /api/dalgo/admin/health/ping  (body: { type: 'email' })
// All health ping endpoints — requires SA or AM.

import { NextRequest, NextResponse } from 'next/server'
import { getProfile, AuthError } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { callAI, getProvider, getModel } from '@/lib/ai'
import { isEmailConfigured, sendEmail } from '@/lib/email'
import { loadBrokerAccountCreds, kiteRequest } from '@/lib/kite'

export const dynamic = 'force-dynamic'

async function checkRole(profile: Awaited<ReturnType<typeof getProfile>>) {
  if (!profile) return false
  return profile.role === 'superadmin' || profile.role === 'account_manager'
}

export async function GET(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile || !await checkRole(profile)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const type = new URL(req.url).searchParams.get('type')

    if (type === 'db') {
      const admin = getSupabaseAdmin()
      const start = Date.now()
      const { count, error } = await admin.from('profiles').select('*', { count: 'exact', head: true })
      if (error) return NextResponse.json({ ok: false, error: error.message })
      return NextResponse.json({ ok: true, detail: `${count} profiles · ${Date.now() - start}ms` })
    }

    if (type === 'ai') {
      const provider = getProvider()
      const model = getModel(provider)
      const start = Date.now()
      const result = await callAI({ prompt: 'Reply with exactly: PONG', maxTokens: 10 })
      return NextResponse.json({
        ok: result.ok,
        detail: result.ok
          ? `${provider} / ${model} responded in ${Date.now() - start}ms: "${result.text.trim().slice(0, 40)}"`
          : `${provider} error: ${result.error}`,
        error: result.ok ? undefined : result.error,
      })
    }

    if (type === 'zerodha') {
      const primaryCustomerId = (process.env.CUSTOMER_IDS || '').split(',')[0]?.trim() || profile.id
      const creds = await loadBrokerAccountCreds(primaryCustomerId)
      if (!creds) return NextResponse.json({ ok: false, error: 'Primary account Kite not connected' })
      const start = Date.now()
      const r = await kiteRequest<{ data?: Record<string, any> }>(
        '/quote?i=NSE%3ARELIANCE', creds,
      )
      const ltp = r.data?.data?.['NSE:RELIANCE']?.last_price
      return NextResponse.json({
        ok: r.ok && ltp != null,
        detail: r.ok && ltp != null
          ? `RELIANCE LTP ₹${ltp} · ${Date.now() - start}ms`
          : `Kite HTTP ${r.status} · ${Date.now() - start}ms`,
        error: r.ok ? undefined : (r.data as any)?.message,
      })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    return NextResponse.json({ ok: false, error: String(err) })
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await getProfile()
    if (!profile || !await checkRole(profile)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    if (body.type === 'email') {
      if (!isEmailConfigured()) return NextResponse.json({ ok: false, error: 'Email not configured (RESEND_API_KEY / FROM_EMAIL missing)' })
      const target = process.env.HEALTH_CHECK_EMAIL || process.env.NOTIFY_TO || process.env.FROM_EMAIL || ''
      if (!target) return NextResponse.json({ ok: false, error: 'No target email (set HEALTH_CHECK_EMAIL in env)' })
      const result = await sendEmail('test')
      return NextResponse.json({ ok: result.ok, detail: result.ok ? `Sent to ${target}` : undefined, error: result.error })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    return NextResponse.json({ ok: false, error: String(err) })
  }
}
