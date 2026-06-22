import { NextResponse } from 'next/server'

// Capture server startup time (only once when the module is first loaded)
const serverStartTime = new Date().toISOString()

export async function GET() {
  return NextResponse.json({ startedAt: serverStartTime })
}
