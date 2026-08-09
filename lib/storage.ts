// lib/storage.ts
//
// Server-side Supabase Storage helpers for KYC document uploads
// (Phase 3 — Registration and Onboarding). SERVER-ONLY — every call goes
// through getSupabaseAdmin() (service-role key), which throws if invoked
// from a browser context.

import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from './supabase'

const BUCKET_ID = 'kyc-documents'
const READ_URL_TTL_SECONDS = 60 * 60 // 60 minutes — time for an Account Manager to review

export interface UploadUrlResult {
  uploadUrl: string
  path: string
}

// Creates a signed upload URL for a new KYC document. Path is UUID-scoped
// (kyc/{uuid}/{fileName}) so it's unguessable even though the route that
// calls this (Task 3.4) requires no auth — the security boundary is the
// unguessable path + private bucket, not a login check.
//
// Two deviations from the original task spec, both forced by the Supabase
// Storage API rather than a choice — see PR/task notes:
//   1. Returns { uploadUrl, path } instead of a bare string: the uuid is
//      generated INSIDE this function, so returning it is the only way the
//      caller learns the path it uploaded to.
//   2. No "valid for 60 seconds": createSignedUploadUrl() takes no
//      expiresIn param — upload-sign URLs have a fixed, server-controlled
//      TTL Supabase does not expose to the client (unlike createSignedUrl()
//      below, which does). `contentType` is accepted here for interface
//      parity with the task spec and future use, but Supabase itself
//      validates MIME type against the bucket's allowlist from the PUT
//      request, not from anything passed to this call.
export async function generateUploadUrl(fileName: string, _contentType: string): Promise<UploadUrlResult> {
  const admin = getSupabaseAdmin()
  const path = `kyc/${randomUUID()}/${fileName}`
  const { data, error } = await admin.storage.from(BUCKET_ID).createSignedUploadUrl(path)
  if (error || !data) {
    throw new Error(`[lib/storage] failed to create signed upload URL for ${path}: ${error?.message || 'unknown error'}`)
  }
  return { uploadUrl: data.signedUrl, path: data.path }
}

// Creates a signed read URL for an existing KYC document, valid for 60
// minutes — used by Account Manager review screens (not built in this
// phase; this is storage plumbing only).
export async function getFileUrl(path: string): Promise<string> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.storage.from(BUCKET_ID).createSignedUrl(path, READ_URL_TTL_SECONDS)
  if (error || !data) {
    throw new Error(`[lib/storage] failed to create signed read URL for ${path}: ${error?.message || 'unknown error'}`)
  }
  return data.signedUrl
}
