// Build URLs that preserve the current subdomain in multi-tenant mode.
// The active browser host must win over any static main-domain fallback; a
// customer app running on dinesh.dalgo.online must never synthesize URLs against
// the root dalgo.online host unless the user is actually on that host.

function isDAlgoSubdomain(hostname: string): boolean {
  const host = hostname.split(':')[0].toLowerCase()
  return host.endsWith('.dalgo.online') && host !== 'dalgo.online' && host !== 'www.dalgo.online'
}

export function getAppUrl(): string {
  if (typeof window === 'undefined') {
    // Fallback for server-side usage (shouldn't normally happen)
    return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://dalgo.online').replace(/\/$/, '')
  }

  const host = window.location.hostname
  if (isDAlgoSubdomain(host)) {
    return `https://${host}`
  }
  
  // Main domain or dev — use env-configured URL
  // Important: when the app is already on a customer subdomain, do not let a
  // root-domain env value override the current site origin.
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.dalgo.online').replace(/\/$/, '')
}

export function getCallbackUrl(path: string = '/api/zerodha/callback'): string {
  return `${getAppUrl()}${path}`
}
