// EMA computation. Seeded with SMA of the first `period` closes.
// Returns an array aligned with the input — entries before index (period-1) are NaN.

export function computeEMA(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN)
  if (closes.length < period) return out

  // Seed: simple moving average of first `period` closes
  let sma = 0
  for (let i = 0; i < period; i++) sma += closes[i]
  sma = sma / period
  out[period - 1] = sma

  const alpha = 2 / (period + 1)
  for (let i = period; i < closes.length; i++) {
    out[i] = alpha * closes[i] + (1 - alpha) * out[i - 1]
  }
  return out
}

// Count trailing consecutive down days. Day t is "down" iff close[t] < close[t-1].
// Returns the largest k such that the last k days are all down.
export function consecutiveDownDays(closes: number[]): number {
  let count = 0
  for (let i = closes.length - 1; i > 0; i--) {
    if (closes[i] < closes[i - 1]) count++
    else break
  }
  return count
}

// Percent deviation of `price` from `ema`. Negative = below EMA.
export function deviationPct(price: number, ema: number): number {
  if (!ema) return 0
  return ((price - ema) / ema) * 100
}
