import { gunzipSync } from 'zlib'
import type {
  IBroker,
  BrokerSession,
  BrokerMargins,
  BrokerProfile,
  BrokerHolding,
  BrokerPosition,
  BrokerPositions,
  BrokerOrder,
  BrokerQuoteMap,
  BrokerCandle,
  BrokerOrderInput,
  BrokerOrderResult,
  CandleInterval,
  BrokerOrderStatus,
} from './IBroker'

const API_BASE = 'https://api.upstox.com'
const INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz'

interface UpstoxInstrument { instrument_key: string; trading_symbol: string; segment: string; instrument_type: string }
interface UpstoxResponse<T> { status?: string; data?: T; errors?: Array<{ message?: string }> }

let instrumentMapPromise: Promise<Map<string, string>> | null = null

function orderStatus(status: string): BrokerOrderStatus {
  switch (status.toLowerCase()) {
    case 'complete': return 'COMPLETE'
    case 'open':
    case 'put order req received':
    case 'validation pending': return 'OPEN'
    case 'cancelled': return 'CANCELLED'
    case 'rejected': return 'REJECTED'
    default: return 'PENDING'
  }
}

function getInstrumentMap(): Promise<Map<string, string>> {
  if (!instrumentMapPromise) {
    instrumentMapPromise = (async () => {
      const response = await fetch(INSTRUMENTS_URL, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Upstox instrument master HTTP ${response.status}`)
      const compressed = Buffer.from(await response.arrayBuffer())
      const instruments = JSON.parse(gunzipSync(compressed).toString('utf8')) as UpstoxInstrument[]
      const map = new Map<string, string>()
      for (const instrument of instruments) {
        if (instrument.segment === 'NSE_EQ' && instrument.instrument_type === 'EQ') {
          map.set(instrument.trading_symbol.toUpperCase(), instrument.instrument_key)
        }
      }
      return map
    })().catch(err => {
      instrumentMapPromise = null
      throw err
    })
  }
  return instrumentMapPromise
}

function toCandleUnit(interval: CandleInterval): { unit: string; size: number } {
  switch (interval) {
    case 'day': return { unit: 'days', size: 1 }
    case '5minute': return { unit: 'minutes', size: 5 }
    case '15minute': return { unit: 'minutes', size: 15 }
    case '60minute': return { unit: 'hours', size: 1 }
  }
}

function ymd(value: string): string { return value.slice(0, 10) }

export interface UpstoxAdapterConfig {
  apiKey: string
  accessToken: string
  apiSecret?: string
}

export class UpstoxAdapter implements IBroker {
  readonly brokerName = 'upstox'
  constructor(private readonly config: UpstoxAdapterConfig) {}

  getLoginUrl(): string {
    const redirectUri = process.env.UPSTOX_REDIRECT_URI
    if (!redirectUri) throw new Error('UPSTOX_REDIRECT_URI must be configured')
    const params = new URLSearchParams({ client_id: this.config.apiKey, redirect_uri: redirectUri, response_type: 'code' })
    return `https://api.upstox.com/v2/login/authorization/dialog?${params}`
  }

  async generateSession(authCode: string): Promise<BrokerSession> {
    if (!this.config.apiSecret) throw new Error('Upstox API secret is required to exchange the authorization code')
    const redirectUri = process.env.UPSTOX_REDIRECT_URI
    if (!redirectUri) throw new Error('UPSTOX_REDIRECT_URI must be configured')
    const response = await fetch(`${API_BASE}/v2/login/authorization/token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: authCode,
        client_id: this.config.apiKey,
        client_secret: this.config.apiSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => ({})) as UpstoxResponse<{ access_token?: string; refresh_token?: string; expires_in?: number }>
    if (!response.ok || !payload.data?.access_token) throw new Error(payload.errors?.[0]?.message || `Upstox token HTTP ${response.status}`)
    const expiresAt = new Date(Date.now() + Number(payload.data.expires_in || 86400) * 1000).toISOString()
    return { accessToken: payload.data.access_token, refreshToken: payload.data.refresh_token, expiresAt }
  }

  async refreshSession(_refreshToken: string): Promise<BrokerSession> {
    throw new Error('Upstox refresh-token flow is not enabled for this integration; reconnect the account')
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.config.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => ({})) as UpstoxResponse<T>
    if (!response.ok || payload.status === 'error') {
      throw new Error(payload.errors?.map(error => error.message).filter(Boolean).join('; ') || `Upstox HTTP ${response.status}`)
    }
    return payload.data as T
  }

  async getMargins(): Promise<BrokerMargins> {
    const data = await this.request<{ equity?: { available_margin?: number; used_margin?: number } }>('/v2/user/get-funds-and-margin')
    return { available: Number(data.equity?.available_margin || 0), used: Number(data.equity?.used_margin || 0) }
  }

  async getProfile(): Promise<BrokerProfile> {
    const data = await this.request<{ user_id?: string; user_name?: string; email?: string }>('/v2/user/profile')
    return { clientId: data.user_id || '', name: data.user_name || '', email: data.email || '' }
  }

  async getHoldings(): Promise<BrokerHolding[]> {
    const rows = await this.request<Array<Record<string, any>>>('/v2/portfolio/long-term-holdings')
    return rows.map(row => ({
      symbol: String(row.trading_symbol || row.tradingsymbol || '').toUpperCase(),
      quantity: Number(row.quantity || 0),
      t1Quantity: Number(row.t1_quantity || 0),
      averagePrice: Number(row.average_price || 0),
      lastPrice: Number(row.last_price || 0),
      pnl: Number(row.pnl || 0),
      closePrice: Number(row.close_price || 0),
    }))
  }

  async getPositions(): Promise<BrokerPositions> {
    const rows = await this.request<Array<Record<string, any>>>('/v2/portfolio/short-term-positions')
    const map = (row: Record<string, any>): BrokerPosition => ({
      symbol: String(row.trading_symbol || row.tradingsymbol || '').toUpperCase(),
      quantity: Number(row.quantity || 0),
      averagePrice: Number(row.average_price || row.buy_price || 0),
      lastPrice: Number(row.last_price || 0),
      pnl: Number(row.pnl || 0),
      product: row.product === 'I' ? 'intraday' : 'delivery',
      buyQuantity: Number(row.day_buy_quantity || 0) + Number(row.overnight_buy_quantity || 0),
      sellQuantity: Number(row.day_sell_quantity || 0) + Number(row.overnight_sell_quantity || 0),
      dayBuyPrice: Number(row.day_buy_price || 0),
      closePrice: Number(row.close_price || 0),
    })
    const net = rows.map(map)
    const day = rows.filter(row => Number(row.day_buy_quantity || 0) || Number(row.day_sell_quantity || 0)).map(map)
    return { net, day }
  }

  async getOrders(): Promise<BrokerOrder[]> {
    const rows = await this.request<Array<Record<string, any>>>('/v2/order/retrieve-all')
    return rows.map(row => ({
      orderId: String(row.order_id || ''),
      symbol: String(row.trading_symbol || row.tradingsymbol || '').toUpperCase(),
      side: row.transaction_type === 'SELL' ? 'SELL' : 'BUY',
      quantity: Number(row.quantity || 0),
      filledQuantity: Number(row.filled_quantity || 0),
      averagePrice: Number(row.average_price || 0),
      status: orderStatus(String(row.status || '')),
      timestamp: String(row.order_timestamp || ''),
      product: row.product === 'I' ? 'intraday' : 'delivery',
      tag: row.tag || undefined,
    }))
  }

  async getQuotes(symbols: string[]): Promise<BrokerQuoteMap> {
    const instrumentMap = await getInstrumentMap()
    const keys = symbols.map(symbol => instrumentMap.get(symbol.toUpperCase())).filter((key): key is string => !!key)
    const out: BrokerQuoteMap = {}
    for (let offset = 0; offset < keys.length; offset += 500) {
      const query = new URLSearchParams({ instrument_key: keys.slice(offset, offset + 500).join(',') })
      const data = await this.request<Record<string, Record<string, any>>>(`/v2/market-quote/quotes?${query}`)
      for (const quote of Object.values(data)) {
        const symbol = String(quote.symbol || '').toUpperCase()
        const close = Number(quote.ohlc?.close || 0)
        const netChange = Number(quote.net_change || 0)
        if (!symbol) continue
        out[symbol] = {
          symbol,
          lastPrice: Number(quote.last_price || 0),
          open: Number(quote.ohlc?.open || 0),
          high: Number(quote.ohlc?.high || 0),
          low: Number(quote.ohlc?.low || 0),
          close,
          volume: Number(quote.volume || 0),
          netChange,
          netChangePct: close ? netChange / close * 100 : 0,
        }
      }
    }
    return out
  }

  async getHistoricalCandles(symbol: string, from: string, to: string, interval: CandleInterval): Promise<BrokerCandle[]> {
    const instrumentKey = await this.resolveInstrumentToken(symbol)
    const { unit, size } = toCandleUnit(interval)
    const fromDate = ymd(from)
    const toDate = ymd(to)
    const isTodayIntraday = interval !== 'day' && toDate === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    const endpoint = isTodayIntraday
      ? `/v3/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/${unit}/${size}`
      : `/v3/historical-candle/${encodeURIComponent(instrumentKey)}/${unit}/${size}/${toDate}/${fromDate}`
    const data = await this.request<{ candles?: any[][] }>(endpoint)
    return (data.candles || []).map(row => ({
      date: String(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5] || 0),
    })).sort((a, b) => a.date.localeCompare(b.date))
  }

  async resolveInstrumentToken(symbol: string): Promise<string> {
    const instrumentMap = await getInstrumentMap()
    const key = instrumentMap.get(symbol.toUpperCase())
    if (!key) throw new Error(`Upstox NSE instrument not found for symbol: ${symbol}`)
    return key
  }

  private async instrumentKey(symbol: string): Promise<string> {
    const instrumentMap = await getInstrumentMap()
    const key = instrumentMap.get(symbol.toUpperCase())
    if (!key) throw new Error(`Upstox NSE instrument not found for symbol: ${symbol}`)
    return key
  }

  async placeOrder(input: BrokerOrderInput): Promise<BrokerOrderResult> {
    const instrumentKey = await this.instrumentKey(input.symbol)
    const data = await this.request<{ order_id?: string }>('/v2/order/place', {
      method: 'POST',
      body: JSON.stringify({
        quantity: input.quantity,
        product: input.product === 'intraday' ? 'I' : 'D',
        validity: 'DAY',
        price: input.orderType === 'LIMIT' ? input.price || 0 : 0,
        tag: input.tag?.slice(0, 20),
        instrument_token: instrumentKey,
        order_type: input.orderType,
        transaction_type: input.side,
        disclosed_quantity: 0,
        trigger_price: 0,
        is_amo: false,
        market_protection: -1,
      }),
    })
    if (!data.order_id) throw new Error('Upstox order placement response did not include order_id')
    return { orderId: data.order_id, status: 'OPEN' }
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request<{ order_id?: string }>(`/v2/order/cancel?${new URLSearchParams({ order_id: orderId })}`, { method: 'DELETE' })
  }
}