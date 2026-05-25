// NSE equity metadata helpers — sector lookup + keyword mapping.
//
// NOTE: NSE blocks direct API calls from outside India (403 response). These
// functions will silently return null/undefined when called from localhost.
// They are designed to run on EC2 (India region) where NSE access works.

export type Sector =
  | 'banking_finance'
  | 'it_technology'
  | 'metals_mining'
  | 'energy'
  | 'auto'
  | 'pharma'
  | 'consumer'
  | 'industrials'
  | 'telecom'
  | 'commodities'
  | 'others'

export const SECTOR_LABELS: Record<Sector, string> = {
  banking_finance: 'Banking & Finance',
  it_technology:   'IT & Technology',
  metals_mining:   'Metals & Mining',
  energy:          'Energy',
  auto:            'Auto',
  pharma:          'Pharma & Healthcare',
  consumer:        'Consumer',
  industrials:     'Industrials',
  telecom:         'Telecom & Media',
  commodities:     'Commodities',
  others:          'Others',
}

export function mapIndustryToSector(industry: string): Sector {
  const i = industry.toLowerCase()
  if (/bank|financ|nbfc|insurance|lending|microfinance|hous.*financ|asset manag/.test(i)) return 'banking_finance'
  if (/software|it |information tech|computer|technology|tech park|data.*service/.test(i)) return 'it_technology'
  if (/steel|metal|alumin|mining|copper|zinc|iron|mineral/.test(i)) return 'metals_mining'
  if (/oil|gas|petro|power|energy|solar|coal|electricity|refin/.test(i)) return 'energy'
  if (/auto|vehicle|tyre|two.wheel|four.wheel|truck|commer.*vehic/.test(i)) return 'auto'
  if (/pharma|drug|healthcare|hospital|medical|diagnostic|life.science/.test(i)) return 'pharma'
  if (/fmcg|consumer|retail|cement|paint|textile|food|beverage|tobacco|cigarette|soap|household/.test(i)) return 'consumer'
  if (/engineer|capital goods|infrastructure|construction|defence|shipbuild|industrial/.test(i)) return 'industrials'
  if (/telecom|media|broadcast|publishing|entertainment/.test(i)) return 'telecom'
  if (/commodity|agri|sugar|chemical|fertiliser|pesticide|plastic/.test(i)) return 'commodities'
  return 'others'
}

// Fetches the NSE industry string for a symbol and maps it to a Sector key.
// Returns null on any failure (API down, symbol not found, outside India).
// Callers should treat null as "sector unknown" and skip sector-based gates.
export async function fetchSymbolSector(symbol: string): Promise<Sector | null> {
  try {
    const { NseIndia } = await import('stock-nse-india')
    const nse = new NseIndia()
    const data = await nse.getEquityDetails(symbol.toUpperCase()) as any
    const industry: string = data?.info?.industry || data?.metadata?.industry || ''
    if (!industry) return null
    return mapIndustryToSector(industry)
  } catch (err) {
    console.warn(`[nse] fetchSymbolSector(${symbol}) failed:`, String(err).slice(0, 120))
    return null
  }
}
