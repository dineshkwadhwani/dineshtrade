// DineshTrade Strategy Rules Engine
export const STRATEGY_RULES = {
  capital: {
    total: 50000,
    perTrade: 5000,
    maxPositions: 10,
    pauseBelow: 0, // never pause - trade as long as cash available
  },
  limits: {
    maxBuysPerDay: 3,
    maxSellsPerDay: 3,
    circuitBreakerPct: -5, // if Nifty drops 5%+ intraday, stop all trades
  },
  strategy2: { // Daily Catalyst
    targetPct1: 1.5,  // T1 exit
    targetPct2: 2.0,  // T2 exit
    // if neither hit by cutoff time, take to delivery (Strategy 1)
    intradayCutoffHour: 15, // 3 PM IST
    intradayCutoffMin: 0,
  },
  strategy1: { // Oscillator / Mean Reversion
    emaPeriod: 20,
    entryBelowEMAPct: 5,   // buy when 5%+ below 20 EMA
    strongBuyBelowEMAPct: 8, // strong buy when 8%+ below
    minConsecutiveDownDays: 3,
    tranche1ExitAtEMA: true,  // sell 50% at EMA recovery
    tranche2ExitAboveEMA: true, // sell 50% when holds above EMA 1 day
  },
  modeDetection: {
    // If GIFT Nifty gap-down > this %, switch to Strategy 1 (EMA dip buying)
    // If gap-down < this, run Strategy 2 (catalyst)
    // Either way, NEVER skip a trading day due to market direction
    giftNiftyThresholdPct: -0.5,
  }
}

export type TradeMode = 'auto' | 'manual'
export type MarketMode = 'catalyst' | 'dip' | 'circuit'

export function detectMarketMode(giftNiftyChangePct: number): MarketMode {
  if (giftNiftyChangePct <= -5) return 'circuit'  // severe crash - no trades
  if (giftNiftyChangePct < STRATEGY_RULES.modeDetection.giftNiftyThresholdPct) return 'dip'
  return 'catalyst'
}

export function calculateTarget(entryPrice: number, targetPct: number): number {
  return parseFloat((entryPrice * (1 + targetPct / 100)).toFixed(2))
}

export function calculateEMADeviation(price: number, ema20: number): number {
  return parseFloat(((price - ema20) / ema20 * 100).toFixed(2))
}

export function isEntrySignal(price: number, ema20: number, consecutiveDownDays: number): {
  signal: boolean; strength: 'strong' | 'normal' | 'none'; reason: string
} {
  const dev = calculateEMADeviation(price, ema20)
  if (dev <= -STRATEGY_RULES.strategy1.strongBuyBelowEMAPct && consecutiveDownDays >= 3) {
    return { signal: true, strength: 'strong', reason: `${Math.abs(dev).toFixed(1)}% below 20-EMA, ${consecutiveDownDays} down days` }
  }
  if (dev <= -STRATEGY_RULES.strategy1.entryBelowEMAPct && consecutiveDownDays >= 3) {
    return { signal: true, strength: 'normal', reason: `${Math.abs(dev).toFixed(1)}% below 20-EMA, ${consecutiveDownDays} down days` }
  }
  return { signal: false, strength: 'none', reason: '' }
}
