// app/api/dalgo/contact/route.ts
//
// POST /api/dalgo/contact — public /contact page form submission
// (Phase 7, Task 7.10).
//
// Public route (no auth) — added to middleware.ts PUBLIC_EXACT below.
// No DB storage — this is a fire-and-forget email via Resend to the
// Grievance Officer / founder inbox (NOTIFY_TO, already
// dinesh.k.wadhwani@gmail.com in every deployed environment).

import { NextRequest, NextResponse } from 'next/server'
import { sendContactForm } from '@/lib/email'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface ContactBody {
  name?: string
  email?: string
  message?: string
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ContactBody | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = (body.name || '').trim()
  const email = (body.email || '').trim()
  const message = (body.message || '').trim()

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'Name, email, and message are all required.' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  const result = await sendContactForm({ name, email, message })
  if (!result.ok) {
    console.error('[contact] send failed:', result.error)
    return NextResponse.json({ error: 'Failed to send your message. Please try again later.' }, { status: 500 })
  }

  return NextResponse.json({ message: 'Thank you. We will respond within 2 business days.' }, { status: 200 })
}
