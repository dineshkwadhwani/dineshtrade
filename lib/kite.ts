// Shared Kite Connect helpers. Used by both API routes (which run in request
// context) and the node-cron monitor (which runs outside any request context).
// Per-account credentials: api_key from env (via getAccountSecrets), access_token
// from session state (file backend on EC2, cookie locally).

import { getAccountSecrets, isAccountConfigured } from '@/lib/accounts'
import { getState } from '@/lib/state'

export const KITE_BASE = 'https://api.kite.trade'

export interface KiteCreds {
  apiKey: string
  accessToken: string
}

export interface KiteResolveResult {
  ok: true
  apiKey: string
  accessToken: string
}

export interface KiteResolveError {
  ok: false
  error: string
}

// Resolve { apiKey, accessToken } for a configured account.
// apiKey is from env (selected by ZERODHA_ENVIRONMENT prefix).
// accessToken is from state (pasted via Login-with-Kite flow).
export async function resolveAccountCreds(account: string): Promise<KiteResolveResult | KiteResolveError> {
  if (!isAccountConfigured(account)) return { ok: false, error: `Unknown account: ${account}` }
  const secrets = getAccountSecrets(account)!
  const state = await getState()
  const accessToken = state.kiteTokens[account]
  if (!accessToken) return { ok: false, error: `${account} not connected — paste today's Kite access token in Settings` }
  return { ok: true, apiKey: secrets.apiKey, accessToken }
}

export interface KiteResponse<T = any> {
  status: number
  ok: boolean
  data: T
}

export async function kiteRequest<T = any>(
  endpoint: string,
  creds: KiteCreds,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: Record<string, string>,
): Promise<KiteResponse<T>> {
  const res = await fetch(`${KITE_BASE}${endpoint}`, {
    method,
    headers: {
      'X-Kite-Version': '3',
      'Authorization': `token ${creds.apiKey}:${creds.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
    cache: 'no-store',   // Kite data must be live — never cached by Next.js fetch
  })
  const data = await res.json().catch(() => ({} as any))
  return { status: res.status, ok: res.ok, data: data as T }
}

// ──────── HIGH-LEVEL HELPERS ────────

export interface KitePosition {
  tradingsymbol: string
  exchange: string
  product: string
  quantity: number
  buy_quantity?: number
  sell_quantity?: number
  day_buy_quantity?: number
  day_sell_quantity?: number
  day_buy_price?: number
  day_buy_value?: number
  average_price: number
  last_price: number
  close_price?: number   // previous trading day's close — used to compute today's %
  pnl?: number
  m2m?: number
}

export interface KiteOrder {
  order_id: string
  tradingsymbol: string
  exchange: string
  transaction_type: 'BUY' | 'SELL'
  quantity: number
  filled_quantity: number
  average_price: number
  status: 'COMPLETE' | 'OPEN' | 'REJECTED' | 'CANCELLED' | 'PENDING' | string
  order_timestamp: string
  product: string
  tag?: string
}

export interface KiteQuoteEntry {
  instrument_token: number
  last_price: number
  ohlc?: { open: number; high: number; low: number; close: number }
  volume?: number
  net_change?: number
  oi?: number
  last_quantity?: number
  timestamp?: string
}

// /portfolio/positions — today's positions (intraday + delivery for today)
export async function getPositions(creds: KiteCreds): Promise<{ net: KitePosition[]; day: KitePosition[] }> {
  const r = await kiteRequest<{ data?: { net?: KitePosition[]; day?: KitePosition[] } }>(
    '/portfolio/positions', creds,
  )
  return {
    net: r.data?.data?.net || [],
    day: r.data?.data?.day || [],
  }
}

export interface KiteHolding {
  tradingsymbol: string
  exchange: string
  product: string
  quantity: number
  average_price: number
  last_price: number
  close_price?: number
  pnl: number
  day_change?: number
  day_change_percentage?: number
}

// /portfolio/holdings — long-term holdings (delivery / CNC) carried across days
export async function getHoldings(creds: KiteCreds): Promise<KiteHolding[]> {
  const r = await kiteRequest<{ data?: KiteHolding[] }>('/portfolio/holdings', creds)
  return r.data?.data || []
}

// /orders — today's order book
export async function getOrders(creds: KiteCreds): Promise<KiteOrder[]> {
  const r = await kiteRequest<{ data?: KiteOrder[] }>('/orders', creds)
  return r.data?.data || []
}

// /quote?i=NSE:SYM1&i=NSE:SYM2 — live LTPs (paid plan). Kite expects REPEATED
// i= params, not a comma-separated single value (which silently returns {}).
export async function getQuotes(creds: KiteCreds, symbols: string[]): Promise<Record<string, KiteQuoteEntry>> {
  if (symbols.length === 0) return {}
  const query = symbols.map(s => `i=${encodeURIComponent(`NSE:${s.toUpperCase()}`)}`).join('&')
  const r = await kiteRequest<{ data?: Record<string, KiteQuoteEntry> }>(
    `/quote?${query}`, creds,
  )
  return r.data?.data || {}
}

// /instruments/historical/{token}/{interval} — daily candles.
// Returns array of { date, open, high, low, close, volume }. Paid plan only.
export interface HistoricalCandle {
  date: string   // ISO datetime
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export async function getHistoricalCandles(
  creds: KiteCreds,
  instrumentToken: number,
  from: string,                    // YYYY-MM-DD
  to: string,                      // YYYY-MM-DD
  interval: 'day' | '5minute' | '15minute' | '60minute' = 'day',
): Promise<HistoricalCandle[]> {
  const url = `/instruments/historical/${instrumentToken}/${interval}?from=${from}&to=${to}`
  const r = await kiteRequest<{ data?: { candles?: any[][] } }>(url, creds)
  const rows = r.data?.data?.candles || []
  return rows.map(row => ({
    date: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low:  Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }))
}

// POST /orders/regular — place an order. Returns Kite's response.
export interface PlaceOrderInput {
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  tag?: string
  product?: 'CNC' | 'MIS'
  orderType?: 'MARKET' | 'LIMIT'
  price?: number
}

export async function placeKiteOrder(
  creds: KiteCreds,
  input: PlaceOrderInput,
): Promise<KiteResponse<{ data?: { order_id?: string }; message?: string; error_type?: string }>> {
  const body: Record<string, string> = {
    tradingsymbol: input.symbol,
    exchange: 'NSE',
    transaction_type: input.side,
    quantity: String(input.quantity),
    product: input.product || 'CNC',
    order_type: input.orderType || 'MARKET',
    validity: 'DAY',
    market_protection: '-1',
  }
  if (input.tag) body.tag = input.tag.slice(0, 20)  // Kite cap
  if (input.orderType === 'LIMIT' && input.price !== undefined) body.price = String(input.price)
  return kiteRequest('/orders/regular', creds, 'POST', body)
}
