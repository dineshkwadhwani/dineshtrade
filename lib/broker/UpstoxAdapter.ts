// lib/broker/UpstoxAdapter.ts
//
// V2 stub. Upstox API v2 is on the broker roadmap but not built yet —
// every method throws. Constructor shape matches ZerodhaAdapter so the
// factory (lib/broker/index.ts) can construct either uniformly.

import type {
  IBroker,
  BrokerSession,
  BrokerMargins,
  BrokerProfile,
  BrokerHolding,
  BrokerPositions,
  BrokerOrder,
  BrokerQuoteMap,
  BrokerCandle,
  BrokerOrderInput,
  BrokerOrderResult,
  CandleInterval,
} from './IBroker'

export interface UpstoxAdapterConfig {
  apiKey: string
  accessToken: string
  apiSecret?: string
}

const NOT_IMPLEMENTED = 'Upstox adapter not yet implemented — V2'

export class UpstoxAdapter implements IBroker {
  constructor(_config: UpstoxAdapterConfig) {}

  getLoginUrl(): string { throw new Error(NOT_IMPLEMENTED) }
  async generateSession(_authCode: string): Promise<BrokerSession> { throw new Error(NOT_IMPLEMENTED) }
  async refreshSession(_refreshToken: string): Promise<BrokerSession> { throw new Error(NOT_IMPLEMENTED) }

  async getMargins(): Promise<BrokerMargins> { throw new Error(NOT_IMPLEMENTED) }
  async getProfile(): Promise<BrokerProfile> { throw new Error(NOT_IMPLEMENTED) }

  async getHoldings(): Promise<BrokerHolding[]> { throw new Error(NOT_IMPLEMENTED) }
  async getPositions(): Promise<BrokerPositions> { throw new Error(NOT_IMPLEMENTED) }
  async getOrders(): Promise<BrokerOrder[]> { throw new Error(NOT_IMPLEMENTED) }

  async getQuotes(_symbols: string[]): Promise<BrokerQuoteMap> { throw new Error(NOT_IMPLEMENTED) }
  async getHistoricalCandles(
    _symbol: string, _from: string, _to: string, _interval: CandleInterval,
  ): Promise<BrokerCandle[]> { throw new Error(NOT_IMPLEMENTED) }
  async resolveInstrumentToken(_symbol: string): Promise<number> { throw new Error(NOT_IMPLEMENTED) }

  async placeOrder(_input: BrokerOrderInput): Promise<BrokerOrderResult> { throw new Error(NOT_IMPLEMENTED) }
  async cancelOrder(_orderId: string): Promise<void> { throw new Error(NOT_IMPLEMENTED) }
}
