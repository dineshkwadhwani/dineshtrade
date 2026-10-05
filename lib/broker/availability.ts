import { getSupabaseAdmin } from '@/lib/supabase'
import { DEFAULT_AVAILABLE_BROKERS, IMPLEMENTED_BROKERS, type ImplementedBroker } from './supported'

export { DEFAULT_AVAILABLE_BROKERS, IMPLEMENTED_BROKERS }
export type { ImplementedBroker }

export function parseAvailableBrokers(value: unknown): ImplementedBroker[] {
  if (typeof value !== 'string') return [...DEFAULT_AVAILABLE_BROKERS]
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return [...DEFAULT_AVAILABLE_BROKERS]
    return IMPLEMENTED_BROKERS.filter(broker => parsed.includes(broker))
  } catch {
    return [...DEFAULT_AVAILABLE_BROKERS]
  }
}

export async function getAvailableBrokers(): Promise<ImplementedBroker[]> {
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('platform_config')
      .select('value')
      .eq('key', 'AVAILABLE_BROKERS')
      .maybeSingle()
    if (error) throw error
    return data ? parseAvailableBrokers(data.value) : [...DEFAULT_AVAILABLE_BROKERS]
  } catch (err) {
    console.warn('[broker availability] config lookup failed; using implemented brokers:', String(err).slice(0, 160))
    return [...DEFAULT_AVAILABLE_BROKERS]
  }
}