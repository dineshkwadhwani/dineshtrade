import { getSupabaseAdmin } from './supabase'

export interface BrokerSource {
  id: string
  name: string
  url: string
  active: boolean
  display_order: number
  notes: string | null
}

export interface BrokerSourceLite {
  name: string
  url: string
}

export const DEFAULT_BROKER_SOURCES: BrokerSourceLite[] = [
  { name: 'ICICI Direct', url: 'https://www.icicidirect.com/research/equity/stock-picks' },
  { name: 'HDFC Securities', url: 'https://www.hdfcsec.com/research/equity-research' },
  { name: 'Moneycontrol', url: 'https://www.moneycontrol.com/stocks/marketstats/recos/' },
  { name: 'Motilal Oswal', url: 'https://www.motilaloswal.com/markets/equity' },
]

function canonicalName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function sanitizeSourceLabel(source: string, approvedNames: string[]): string {
  const input = canonicalName(source)
  if (!input) return 'Unknown'
  const exact = approvedNames.find(n => canonicalName(n) === input)
  if (exact) return exact
  const fuzzy = approvedNames.find(n => {
    const c = canonicalName(n)
    return c.includes(input) || input.includes(c)
  })
  return fuzzy ?? 'Unknown'
}

export async function getActiveBrokerSources(): Promise<BrokerSourceLite[]> {
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('platform_broker_sources')
      .select('name,url')
      .eq('active', true)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw error
    const rows = (data ?? []).filter(r => !!r.name && !!r.url)
    if (rows.length === 0) return DEFAULT_BROKER_SOURCES
    return rows.map(r => ({ name: r.name, url: r.url }))
  } catch {
    return DEFAULT_BROKER_SOURCES
  }
}
