// app/api/dalgo/upload-url/route.ts
//
// POST /api/dalgo/upload-url — generates a signed Supabase Storage upload
// URL for Aadhar KYC images (Phase 3 — Registration and Onboarding).
//
// Public route (no auth) — added to middleware.ts PUBLIC_EXACT in Task 3.9.
// Security boundary is NOT a login check: the path returned is UUID-scoped
// (see lib/storage.ts) and the bucket is private, so a caller who doesn't
// already know the exact signed URL/path can't read or overwrite anything.

import { NextRequest, NextResponse } from 'next/server'
import { generateUploadUrl } from '@/lib/storage'

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { fileName?: string; contentType?: string } | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { fileName, contentType } = body

  if (typeof fileName !== 'string' || fileName.trim() === '') {
    return NextResponse.json({ error: 'fileName is required' }, { status: 400 })
  }
  if (typeof contentType !== 'string' || !ALLOWED_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: `contentType must be one of: ${Array.from(ALLOWED_CONTENT_TYPES).join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const { uploadUrl, path } = await generateUploadUrl(fileName, contentType)
    return NextResponse.json({ uploadUrl, path }, { status: 200 })
  } catch (err) {
    console.error('[upload-url] generateUploadUrl failed:', err)
    return NextResponse.json({ error: 'Failed to generate upload URL. Please try again.' }, { status: 500 })
  }
}
