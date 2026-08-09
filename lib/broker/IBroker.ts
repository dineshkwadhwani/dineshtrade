// lib/broker/IBroker.ts
//
// Pure type/interface definitions for broker abstraction (Phase 2).
// No imports, no dependencies — every broker adapter implements IBroker.

export type CandleInterval = 'day' | '5minute' | '15minute' | '60minute'
export type ProductType = 'delivery' | 'intraday'
export type OrderSide = 'BUY' | 'SELL'
export type BrokerOrderStatus = 'COMPLETE' | 'OPEN' | 'CANCELLED' | 'REJECTED' | 'PENDING'

export interface BrokerSession {
  accessToken: string
  refreshToken?: string
  expiresAt: string
}

export interface BrokerMargins { available: number; used: number }

export interface BrokerProfile { clientId: string; name: string; email: string }

export interface BrokerHolding {
  symbol: string
  quantity: number
  t1Quantity: number         // T+1 unsettled — must add to quantity for live qty
  averagePrice: number
  lastPrice: number
  pnl: number
  closePrice?: number
}

export interface BrokerPosition {
  symbol: string; quantity: number; averagePrice: number; lastPrice: number
  pnl: number; product: ProductType; buyQuantity?: number
  sellQuantity?: number; dayBuyPrice?: number; closePrice?: number
}

export interface BrokerPositions { net: BrokerPosition[]; day: BrokerPosition[] }

export interface BrokerOrder {
  orderId: string; symbol: string; side: OrderSide; quantity: number
  filledQuantity: number; averagePrice: number; status: BrokerOrderStatus
  timestamp: string; product: ProductType; tag?: string
}

export interface BrokerQuote {
  symbol: string; lastPrice: number; open: number; high: number
  low: number; close: number; volume: number
  netChange: number; netChangePct: number
}

export type BrokerQuoteMap = Record<string, BrokerQuote>

export interface BrokerCandle {
  date: string; open: number; high: number; low: number; close: number; volume: number
}

export interface BrokerOrderInput {
  symbol: string; side: OrderSide; quantity: number; product: ProductType
  orderType: 'MARKET' | 'LIMIT'; price?: number
  tag?: string               // max 20 chars (Zerodha limit) — adapter enforces via .slice(0, 20)
}

export interface BrokerOrderResult { orderId: string; status: BrokerOrderStatus }

export interface IBroker {
  // Auth
  getLoginUrl(): string
  generateSession(authCode: string): Promise<BrokerSession>
  refreshSession?(refreshToken: string): Promise<BrokerSession>

  // Account
  getMargins(): Promise<BrokerMargins>
  getProfile(): Promise<BrokerProfile>

  // Portfolio
  getHoldings(): Promise<BrokerHolding[]>
  getPositions(): Promise<BrokerPositions>
  getOrders(): Promise<BrokerOrder[]>

  // Market data
  getQuotes(symbols: string[]): Promise<BrokerQuoteMap>
  getHistoricalCandles(symbol: string, from: string, to: string, interval: CandleInterval): Promise<BrokerCandle[]>
  resolveInstrumentToken(symbol: string): Promise<number>

  // Orders
  placeOrder(input: BrokerOrderInput): Promise<BrokerOrderResult>
  cancelOrder(orderId: string): Promise<void>
}
