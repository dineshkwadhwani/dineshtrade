import { NextResponse } from 'next/server'

// Capture server startup time (only once when the module is first loaded)
const serverStartTime = new Date().toISOString()
const BUILD_TAG = '2026-08-10-a'

export async function GET() {
  return NextResponse.json({ startedAt: serverStartTime, build: BUILD_TAG })
}
