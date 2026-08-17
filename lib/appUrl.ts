// Build URLs that preserve the current subdomain in multi-tenant mode.
// Always called from client-side code where `window` is available.

export function getAppUrl(): string {
  if (typeof window === 'undefined') {
    // Fallback for server-side usage (shouldn't normally happen)
    return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://dalgo.online').replace(/\/$/, '')
  }

  const host = window.location.hostname
  const isSubdomain = host.endsWith('.dalgo.online') && host !== 'dalgo.online' && host !== 'www.dalgo.online'
  
  if (isSubdomain) {
    return `https://${host}`
  }
  
  // Main domain or dev — use env-configured URL
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.dalgo.online').replace(/\/$/, '')
}

export function getCallbackUrl(path: string = '/api/zerodha/callback'): string {
  return `${getAppUrl()}${path}`
}
