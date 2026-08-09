// lib/broker/index.ts
//
// Broker factory — the only place in the codebase that should decide which
// IBroker implementation to construct. Callers import everything they need
// (types + getBroker) from '@/lib/broker'.

import type { IBroker } from './IBroker'
import { ZerodhaAdapter } from './ZerodhaAdapter'
import { AngelOneAdapter } from './AngelOneAdapter'
import { UpstoxAdapter } from './UpstoxAdapter'

export * from './IBroker'

export interface BrokerCustomer {
  brokerName: string
  brokerCredentials: { accessToken: string; apiKey: string }
}

export function getBroker(customer: BrokerCustomer): IBroker {
  switch (customer.brokerName) {
    case 'zerodha':
      return new ZerodhaAdapter(customer.brokerCredentials)
    case 'angelone':
      return new AngelOneAdapter(customer.brokerCredentials)
    case 'upstox':
      return new UpstoxAdapter(customer.brokerCredentials)
    default:
      throw new Error(`Unsupported broker: ${customer.brokerName}`)
  }
}
