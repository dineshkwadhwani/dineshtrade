// Resolve redirects from the host that handled the request.
// APP_BASE_URL remains the main-platform fallback, but shared servers also
// serve customer subdomains and must preserve those hosts during OAuth.

interface RequestHeaders {
  get(name: string): string | null
}

const DALGO_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*dalgo\.online$/i
const MAIN_HOSTS = new Set(['dalgo.online', 'www.dalgo.online'])

function firstHeaderValue(value: string | null): string {
  return value?.split(',')[0]?.trim() || ''
}

function isAllowedHost(host: string): boolean {
  const hostname = host.split(':')[0].toLowerCase()
  return DALGO_HOST.test(hostname) && (MAIN_HOSTS.has(hostname) || hostname.endsWith('.dalgo.online'))
}

export function getRequestBase(headers: RequestHeaders): string {
  const forwardedHost = firstHeaderValue(headers.get('x-forwarded-host'))
  const hostHeader = firstHeaderValue(headers.get('host'))
  const candidate = forwardedHost || hostHeader
  const configured = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://dalgo.online').replace(/\/$/, '')

  if (!candidate || !isAllowedHost(candidate)) return configured

  const hostname = candidate.split(':')[0].toLowerCase()
  const isProduction = process.env.NODE_ENV === 'production'
  const protocol = isProduction
    ? 'https'
    : firstHeaderValue(headers.get('x-forwarded-proto')) || 'http'
  const port = !isProduction && candidate.includes(':') ? `:${candidate.split(':').slice(1).join(':')}` : ''
  return `${protocol}://${hostname}${port}`
}
