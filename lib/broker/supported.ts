export const IMPLEMENTED_BROKERS = ['zerodha', 'upstox'] as const
export type ImplementedBroker = typeof IMPLEMENTED_BROKERS[number]

export const DEFAULT_AVAILABLE_BROKERS: ImplementedBroker[] = [...IMPLEMENTED_BROKERS]