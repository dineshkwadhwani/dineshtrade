// Canned market briefing used when USE_MOCK_MARKET=true.
// Shape must match what app/(app)/dashboard/page.tsx expects.

export const MOCK_MARKET_DATA = {
  headline: 'Markets cautiously positive — Asian indices firm on US tech rally',
  globalIndices: [
    { name: 'S&P 500',     value: '7,444.32',  change: '+0.58%', direction: 'up' },
    { name: 'Nasdaq',      value: '26,402.10', change: '+1.20%', direction: 'up' },
    { name: 'Dow Jones',   value: '49,693.85', change: '-0.14%', direction: 'down' },
    { name: 'DAX',         value: '24,162.40', change: '+0.87%', direction: 'up' },
    { name: 'FTSE 100',    value: '10,324.55', change: '+0.58%', direction: 'up' },
    { name: 'Nikkei 225',  value: '63,455.20', change: '+0.29%', direction: 'up' },
    { name: 'Hang Seng',   value: '26,576.80', change: '+0.71%', direction: 'up' },
    { name: 'Kospi',       value: '7,906.15',  change: '+0.79%', direction: 'up' },
    { name: 'Brent Crude', value: '$98.43',    change: '+3.10%', direction: 'up' },
  ],
  giftNifty: {
    value: '24,218',
    change: '-0.26%',
    direction: 'down',
    impliedOpen: 'Gap down ~60 pts vs prior Nifty close',
    signal: 'cautious',
  },
  indiaOutlook: {
    bias: 'cautious-positive',
    expectedRange: '24,180–24,260',
    keyFactors: [
      'S&P 500 at all-time highs',
      'Nasdaq +1.2% on tech rally',
      'Iran ceasefire concerns weighing on crude',
      'INR steady at 86.20',
    ],
    support: '24,100',
    resistance: '24,600',
    strategy: 'Wait for 9:30 AM candle confirmation before entering. Avoid chasing gap-ups.',
  },
  topRecommendations: [
    { symbol: 'BAJFINANCE', name: 'Bajaj Finance',       action: 'BUY', source: 'ICICI Direct',    reason: '20-EMA support holding; strong NBFC sector momentum' },
    { symbol: 'RELIANCE',   name: 'Reliance Industries', action: 'BUY', source: 'HDFC Securities', reason: 'Telecom + retail growth; oil price decline favourable' },
    { symbol: 'TATASTEEL',  name: 'Tata Steel',          action: 'BUY', source: 'Moneycontrol',    reason: 'Metal sector outperforming; China stimulus tailwind' },
  ],
}
