// lib/broker/ZerodhaAdapter.ts
//
// IBroker implementation for Zerodha Kite Connect. Wraps the existing
// lib/kite.ts request helpers — does NOT reimplement Kite's HTTP/URL-encoding
// logic. lib/kite.ts is NOT deleted in Phase 2; V1 code paths still call it
// directly until they're migrated.

import { createHash } from 'crypto'
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
  ProductType,
  BrokerOrderStatus,
} from './IBroker'
import {
  kiteRequest,
  getPositions as kiteGetPositions,
  getHoldings as kiteGetHoldings,
  getOrders as kiteGetOrders,
  getQuotes as kiteGetQuotes,
  getHistoricalCandles as kiteGetHistoricalCandles,
  placeKiteOrder,
  cancelKiteOrder,
  type KiteCreds,
} from '@/lib/kite'
import { getInstrumentToken } from '@/lib/instruments'

export interface ZerodhaAdapterConfig {
  apiKey: string
  accessToken: string
  // Not part of the original task 2.2 constructor shape — added because
  // generateSession() needs it to compute Kite's login checksum
  // (sha256(api_key + request_token + api_secret)). Optional so adapters
  // built for data/order calls only (the common case) don't need it.
  apiSecret?: string
}

function toKiteProduct(product: ProductType): 'CNC' | 'MIS' {
  return product === 'delivery' ? 'CNC' : 'MIS'
}

function fromKiteProduct(product: string): ProductType {
  return product === 'CNC' ? 'delivery' : 'intraday'
}

function toBrokerOrderStatus(status: string): BrokerOrderStatus {
  switch (status) {
    case 'COMPLETE': return 'COMPLETE'
    case 'OPEN': return 'OPEN'
    case 'CANCELLED': return 'CANCELLED'
    case 'REJECTED': return 'REJECTED'
    default: return 'PENDING'   // Kite's various *PENDING / *REQ RECEIVED states
  }
}

// Kite invalidates all access tokens around 6am IST the next day and does not
// return an explicit expiry from /session/token — this is our best approximation.
function nextSixAmIST(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
  const istNow = new Date(Date.now() + IST_OFFSET_MS)
  const istNextSixAm = new Date(Date.UTC(
    istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + 1, 6, 0, 0,
  ))
  return new Date(istNextSixAm.getTime() - IST_OFFSET_MS).toISOString()
}

export class ZerodhaAdapter implements IBroker {
  private creds: KiteCreds
  private apiSecret?: string

  constructor(config: ZerodhaAdapterConfig) {
    this.creds = { apiKey: config.apiKey, accessToken: config.accessToken }
    this.apiSecret = config.apiSecret
  }

  // ──────── Auth ────────

  getLoginUrl(): string {
    return `https://kite.zerodha.com/connect/login?v=3&api_key=${this.creds.apiKey}`
  }

  async generateSession(authCode: string): Promise<BrokerSession> {
    if (!this.apiSecret) {
      throw new Error('ZerodhaAdapter: apiSecret not configured — cannot exchange request_token for access_token')
    }
    const checksum = createHash('sha256')
      .update(this.creds.apiKey + authCode + this.apiSecret)
      .digest('hex')
    const res = await fetch('https://api.kite.trade/session/token', {
      method: 'POST',
      headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: this.creds.apiKey, request_token: authCode, checksum }),
    })
    const data = await res.json().catch(() => ({} as any))
    const accessToken: string | undefined = data?.data?.access_token
    if (!res.ok || !accessToken) {
      throw new Error(data?.message || data?.error_type || `Kite session/token HTTP ${res.status}`)
    }
    return { accessToken, expiresAt: nextSixAmIST() }
  }

  async refreshSession(_refreshToken: string): Promise<BrokerSession> {
    // Kite Connect has no refresh-token flow — sessions are daily-login only.
    throw new Error('Zerodha Kite Connect does not support session refresh — user must re-authenticate daily (spec §5.9)')
  }

  // ──────── Account ────────

  async getMargins(): Promise<BrokerMargins> {
    const r = await kiteRequest<{ data?: { equity?: { available?: { live_balance?: number; cash?: number }; utilised?: { debits?: number } } } }>(
      '/user/margins', this.creds,
    )
    const available = r.data?.data?.equity?.available?.live_balance
      ?? r.data?.data?.equity?.available?.cash
      ?? 0
    const used = r.data?.data?.equity?.utilised?.debits ?? 0
    return { available, used }
  }

  async getProfile(): Promise<BrokerProfile> {
    const r = await kiteRequest<{ data?: { user_id?: string; user_name?: string; email?: string } }>(
      '/user/profile', this.creds,
    )
    return {
      clientId: r.data?.data?.user_id || '',
      name: r.data?.data?.user_name || '',
      email: r.data?.data?.email || '',
    }
  }

  // ──────── Portfolio ────────

  async getHoldings(): Promise<BrokerHolding[]> {
    const holdings = await kiteGetHoldings(this.creds)
    return holdings.map(h => ({
      symbol: h.tradingsymbol.toUpperCase(),
      quantity: h.quantity,
      t1Quantity: h.t1_quantity || 0,
      averagePrice: h.average_price,
      lastPrice: h.last_price,
      pnl: h.pnl,
      closePrice: h.close_price,
    }))
  }

  async getPositions(): Promise<BrokerPositions> {
    const { net, day } = await kiteGetPositions(this.creds)
    const map = (p: typeof net[number]): BrokerPosition => ({
      symbol: p.tradingsymbol.toUpperCase(),
      quantity: p.quantity,
      averagePrice: p.average_price,
      lastPrice: p.last_price,
      pnl: p.pnl || 0,
      product: fromKiteProduct(p.product),
      buyQuantity: p.buy_quantity,
      sellQuantity: p.sell_quantity,
      dayBuyPrice: p.day_buy_price,
      closePrice: p.close_price,
    })
    return { net: net.map(map), day: day.map(map) }
  }

  async getOrders(): Promise<BrokerOrder[]> {
    const orders = await kiteGetOrders(this.creds)
    return orders.map(o => ({
      orderId: o.order_id,
      symbol: o.tradingsymbol.toUpperCase(),
      side: o.transaction_type,
      quantity: o.quantity,
      filledQuantity: o.filled_quantity,
      averagePrice: o.average_price,
      status: toBrokerOrderStatus(o.status),
      timestamp: o.order_timestamp,
      product: fromKiteProduct(o.product),
      tag: o.tag,
    }))
  }

  // ──────── Market data ────────

  async getQuotes(symbols: string[]): Promise<BrokerQuoteMap> {
    const raw = await kiteGetQuotes(this.creds, symbols)
    const out: BrokerQuoteMap = {}
    for (const [key, q] of Object.entries(raw)) {
      const symbol = key.replace(/^NSE:/, '')
      const close = q.ohlc?.close ?? 0
      const netChange = q.net_change ?? 0
      out[symbol] = {
        symbol,
        lastPrice: q.last_price,
        open: q.ohlc?.open ?? 0,
        high: q.ohlc?.high ?? 0,
        low: q.ohlc?.low ?? 0,
        close,
        volume: q.volume ?? 0,
        netChange,
        netChangePct: close !== 0 ? (netChange / close) * 100 : 0,
      }
    }
    return out
  }

  async getHistoricalCandles(
    symbol: string, from: string, to: string, interval: CandleInterval,
  ): Promise<BrokerCandle[]> {
    const token = await this.resolveInstrumentToken(symbol)
    const candles = await kiteGetHistoricalCandles(this.creds, token, from, to, interval)
    return candles.map(c => ({
      date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    }))
  }

  async resolveInstrumentToken(symbol: string): Promise<number> {
    const token = await getInstrumentToken(this.creds, symbol)
    if (token === null) {
      throw new Error(`instrument token not found for symbol: ${symbol}`)
    }
    return token
  }

  // ──────── Orders ────────

  async placeOrder(input: BrokerOrderInput): Promise<BrokerOrderResult> {
    const tag = input.tag ? input.tag.slice(0, 20) : undefined   // Kite's hard limit
    const r = await placeKiteOrder(this.creds, {
      symbol: input.symbol,
      side: input.side,
      quantity: input.quantity,
      product: toKiteProduct(input.product),
      orderType: input.orderType,
      price: input.price,
      tag,
    })
    const orderId = r.data?.data?.order_id
    if (!r.ok || !orderId) {
      throw new Error(r.data?.message || r.data?.error_type || `Kite place order HTTP ${r.status}`)
    }
    return { orderId, status: 'OPEN' }
  }

  async cancelOrder(orderId: string): Promise<void> {
    const r = await cancelKiteOrder(this.creds, orderId)
    if (!r.ok) {
      throw new Error(r.data?.message || r.data?.error_type || `Kite cancel order HTTP ${r.status}`)
    }
  }
}
