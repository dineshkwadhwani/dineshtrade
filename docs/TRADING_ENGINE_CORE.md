# DineshTrade — Trading Engine Core Reference
**Version:** 2.0 | **Date:** June 2026  
**Purpose:** Authoritative reference for all trading rules, strategy logic, and engine behaviour  
**Keep this alongside code — update when rules change**

---

## The Five Laws (Never Violate)

```
1. Never sell at a loss (auto mode)
   → GATE 9 in preflight.ts
   → Only two exceptions: squareOffEOD and pivotalStopLoss

2. Never short sell
   → GATE 8 in preflight.ts
   → Blocked for all orders (auto and manual)

3. Never trade F&O or intraday MIS
   → All orders: CNC product type, NSE cash segment only
   → Angel One: DELIVERY product type

4. Never deploy more than one signal per symbol per day
   → GATE 4 (idempotency) in preflight.ts
   → Resets at IST midnight

5. Never exceed position or capital limits
   → GATE 3 (per-trade cap), GATE 5 (day quota), GATE 6 (max positions), GATE 7 (funds)
```

---

## Strategy Decision Tree

```
New price data arrives for a symbol
        │
        ▼
Is symbol in an active watchlist?
  NO → skip
  YES ↓
        ▼
Which strategy types are active?
        │
   ┌────┴────────────┐
   ▼                 ▼
DIP (Accumulator)  MOMENTUM (Catalyst / Market Boom)
   │                 │
   ▼                 ▼
Price ≥ 5% below   Price up 0.5–1% today?
20-day EMA?        + 3 rising candles?
   │               + within EMA proximity?
   ▼                 │
3+ down days?       ▼
   │              All conditions YES?
   ▼                 │
Below capitulation   ▼
floor (12%)?    → Place BUY (preflight gates)
NO ↓
   ▼
→ Place BUY (preflight gates)
```

---

## Complete Preflight Gate Sequence

```
Input: { account, symbol, side, quantity, price, strategyId, manual }

GATE 1: Token connected?
  FAIL → "not connected — connect in Settings"

GATE 2: Market open + not holiday?
  FAIL → "Market closed: [status]"

GATE 2b: [BUY auto only] Intraday circuit not tripped?
  FAIL → "Intraday circuit tripped"

GATE 3: [BUY auto only] tradeValue ≤ perTrade?
  FAIL → "Trade value exceeds per-trade cap"

GATE 4: [BUY auto only] Not already bought today?
  FAIL → "already bought [symbol] earlier today"

GATE 4b: [BUY auto only] No panic-sell detected?
  FAIL → "[symbol]: panic-sell detected"

GATE 4c: [BUY auto only] Pyramid limits OK?
  FAIL → "already N BUYs of [symbol] (cap M)"
  FAIL → "[symbol] at ₹X — must be ≤ ₹Y (10% below previous)"

GATE 4d: [BUY auto dip only] Sector concentration OK?
  FAIL → "already N/M positions in sector [sector]"

GATE 5: [auto only] Day quota not exceeded?
  FAIL → "net buys today N/M" or "already N/M sells today"

GATE 6: [BUY auto only] Open positions < maxPositions?
  FAIL → "N/M positions already open"

GATE 7: [BUY] Funds available ≥ tradeValue?
  FAIL → "₹X available, need ₹Y"

GATE 8: [SELL] Holding qty > 0?
  FAIL → "not holding [symbol] — short selling blocked"
  CLAMP → adjustedQty = heldQty (if holding < requested)

GATE 9: [SELL auto only] LTP ≥ average_price?
  FAIL → "[symbol] at ₹X vs avg ₹Y — Auto mode never sells at a loss"
  BYPASS if bypassNoLossSellReason = 'squareOffEOD' | 'pivotalStopLoss'

PASS → Place order
```

---

## Accumulator (Dip Strategy) — Complete Rules

### Entry Rules (ALL must pass)
```
1. LTP ≤ EMA20 × (1 - entryBelowPct/100)
   Current: entryBelowPct = 5 → LTP ≤ EMA × 0.95

2. Consecutive down days ≥ minDownDays
   Current: minDownDays = 3

3. NOT in capitulation zone:
   LTP > EMA × (1 - capitulationFloorPct/100)
   Current: capitulationFloorPct = 12 → LTP > EMA × 0.88
   If below this → skip (news event, not mean reversion)

4. Strong buy tier (same entry, higher confidence signal):
   LTP ≤ EMA × (1 - strongBuyBelowPct/100)
   Current: strongBuyBelowPct = 8

5. GIFT Nifty gate:
   Current: enabled, maxPct = -0.5
   → Only fires when GIFT Nifty ≤ -0.5% (flat or negative days)
   → Accumulator is a dip buyer — buys on weak market days

6. Sector concentration:
   Current: maxPerSector = 3
   → Block if 3+ open positions already in same sector

7. All preflight gates pass
```

### Exit Rules
```
Anchor: firstBuyPrice (set at first BUY, never changes)
Pyramid buys add qty to remainingQty but do NOT change firstBuyPrice

TRANCHE 1: LTP ≥ firstBuyPrice × (1 + t1Pct/100)
  Current: t1Pct = 3%
  Action: sell 50% of remainingQty
  Record: tranche1At, tranche1SoldQty

TRANCHE 2: LTP ≥ firstBuyPrice × (1 + t2Pct/100)
  Current: t2Pct = 7%
  Action: sell remaining 50% (all of remainingQty)

JUMP (T2 before T1): LTP crosses T2 without T1 being hit first
  Action: sell entire remainingQty at T2

Note: tranche2AboveEMAPct = 3% is an additional exit condition:
  LTP ≥ EMA × (1 + 3/100) → also fires T2
  Current EMA reference is live 20-day EMA at time of check
```

### Reactive Scan
```
Trigger: any watchlist symbol drops ≥ reactiveDrop% (3%) intraday
Throttle: maximum one reactive scan per reactiveIntervalMin (30) minutes
Mode gate: firesOnAnyMode = true → fires even in momentum market mode
```

### Handoff Receipt (from Momentum)
```
When a momentum position ages past deliveryHandoffDays (15):
  positions.setStrategyId(account, symbol, 'accumulator')
  firstBuyPrice and firstBuyAt preserved from original entry
  Accumulator monitor then manages exits with its own T1/T2
  positionSource = 'handoff' (for future differentiated targets)
```

---

## Catalyst (Momentum) — Complete Rules

### Entry Rules (ALL must pass)
```
1. Day gain between minDayGainPct and maxDayGainPct
   Current: 0.5% ≤ dayGain ≤ 1.0%

2. Last consecutiveCandles 5-min candles all rising
   Current: consecutiveCandles = 3

3. LTP within ±emaProximityPct of 20-day EMA
   Current: emaProximityPct = 3%
   → LTP between EMA×0.97 and EMA×1.03

4. Current time between scanStartHHMM and scanEndHHMM
   Current: 09:15 – 15:00 IST

5. GIFT Nifty gate: disabled → fires any day

6. All preflight gates pass
```

### Exit Rules
```
CANDLE HIGH CHECK (every sell monitor tick):
  Also check HIGH of last completed 5-min candle
  If candleHigh ≥ T1 or T2 trigger but LTP has retreated:
    → Sell at current market price immediately
    → Log: "T1/T2 hit intraday at [candleHigh], retreated to [ltp]"
  This prevents missed exits when price spikes between cron ticks

T1: LTP ≥ firstBuyPrice × (1 + 1.5/100)
  Action: sell 100% of position (momentum = full exit at T1)

T2: LTP ≥ firstBuyPrice × (1 + 2.0/100)
  Action: sell 100% of position

EOD (checked at 15:15 IST):
  exitSameDayOnPositive = true, squareOffEOD = false
  → Calculate estimated net P&L after charges
  → Same-day position (bought today): no DP charge in estimate
  → Multi-day position (bought before today): include DP charge (₹15.34)
  → If estimated net P&L > 0 → sell at market
  → If estimated net P&L ≤ 0 → hold (no-loss gate applies)
  → Philosophy: dead entry thesis; free capital for tomorrow

DELIVERY HANDOFF (after 15 calendar days):
  Re-tag position to 'accumulator'
  Accumulator monitor takes over with 3%/7% targets
```

---

## Market Boom (Momentum) — Complete Rules

### Entry Rules
```
Same as Catalyst with different thresholds:
  minDayGainPct = 0.5%, maxDayGainPct = 1.0%
  consecutiveCandles = 2 (lower bar — boom days have strong momentum)
  emaProximityPct = 5% (wider)
  volumeAvgDays = 5 (shorter lookback)
  scanStartHHMM = 09:30, scanEndHHMM = 15:15

GIFT Nifty gate: enabled, minPct = 1.0%
  → ONLY fires on strong gap-up days (GIFT Nifty ≥ +1%)
```

### Exit Rules
```
T1: 1.0% (lower target — capture quick boom moves)
T2: 2.0%

EOD (checked at 15:10 IST):
  squareOffEOD = true → sell ALL positions regardless of P&L
  Bypasses no-loss gate (bypassNoLossSellReason = 'squareOffEOD')
  Fires ONCE per strategy per day (idempotent)

  exitSameDayOnPositive = true also applies on earlier 5-min ticks

deliveryHandoffDays = 0 → NEVER hand off to Accumulator
  (squareOffEOD ensures all positions close same day)
```

---

## Pivotal (Breakout Strategy) — Complete Rules

### Per-Symbol Configuration (Pivotal List)
```
Each symbol in the Pivotal List has its own:
  breakoutTriggerPrice   The execution price trigger (required)
  t1Pct                 First target % from trigger price
  t2Pct                 Second target % from trigger price
  executionMode          'normal' (intraday) | 'dayEnd' (close)
  stopLossPrice          Optional hard stop (overrides no-loss gate)

Validation:
  breakoutTriggerPrice > 0
  t1Pct > 0, t2Pct > 0, t1Pct ≤ t2Pct
  stopLossPrice (if set) < breakoutTriggerPrice
```

### Normal Mode Entry (intraday)
```
1. Time between 10:00 and 13:00 IST
2. Time ≥ minProjectedVolumeCheckHHMM (10:00)
3. LTP > breakoutTriggerPrice (script-level trigger)
4. Day gain between 1% and 4%
5. Last 2 consecutive 5-min candles rising
6. Consolidation validation:
   Look back 10 trading days
   (highestHigh - lowestLow) / lowestLow ≤ 6%
   → Confirms the stock was range-bound before today
7. Volume confirmation:
   projectedDayVolume = currentVolume / (minutesElapsed / 375)
   projectedDayVolume ≥ avgVolume × 1.2
8. All preflight gates pass
```

### DayEnd Mode Entry (sustain-into-close)
```
1. NO intraday entry — waits until 15:10 IST exactly
2. At 15:10: LTP still > breakoutTriggerPrice
3. Consolidation validation passes
4. Realized day volume ≥ avgVolume × 1.2
   (No projection — use actual accumulated volume)
5. All preflight gates pass
```

### Exit Rules (in priority order)
```
1. STOP LOSS (if configured):
   LTP ≤ stopLossPrice → immediate market sell
   bypassNoLossSellReason = 'pivotalStopLoss'
   This is a hard exit — broken pivot thesis is invalid

2. T2:
   LTP ≥ entryPrice × (1 + t2Pct/100) → sell 100%

3. T1:
   LTP ≥ entryPrice × (1 + t1Pct/100) → sell 100%

4. DELIVERY HANDOFF:
   Position age > deliveryHandoffDays (15) → hand to Accumulator
   Stop loss takes precedence over handoff
```

---

## EOD Behaviour Decision Matrix

| exitSameDayOnPositive | squareOffEOD | Behaviour at exitSameDayTime |
|---|---|---|
| false | false | No EOD action. Hold for T1/T2 or delivery. |
| true | false | Sell if estimated net P&L after charges > 0. Hold if ≤ 0. |
| true | true | Sell ALL positions regardless of P&L. |
| false | true | Sell ALL positions regardless of P&L. (squareOffEOD wins) |

**Current strategy settings:**

| Strategy | exitSameDayOnPositive | squareOffEOD | Result |
|---|---|---|---|
| Catalyst | true | false | Exit if net positive after charges |
| Market Boom | true | false | Exit if net positive (squareOffEOD should be true — known bug) |
| Accumulator | N/A | N/A | No EOD action (dip strategy) |
| Pivotal | N/A | N/A | No EOD action |

---

## Charge Model

### Per ₹10,000 Trade (current trade size)

| Charge | Rate | Same-day | Delivery |
|---|---|---|---|
| Brokerage | ₹0 | ₹0 | ₹0 |
| STT | 0.025% sell | ₹2.50 | ₹2.50 |
| Exchange NSE | 0.00345% both | ₹3.45 | ₹3.45 |
| Stamp duty | 0.003% buy | ₹3.00 | ₹3.00 |
| SEBI | 0.0001% both | ₹0.02 | ₹0.02 |
| IPFT | 0.0001% both | ₹0.02 | ₹0.02 |
| GST | 18% on fees | ₹1.17 | ₹1.17 |
| DP charge | ₹15.34 flat | ₹0 | ₹15.34 |
| **Total** | | **₹10.16** | **₹25.50** |
| **Breakeven** | | **0.10%** | **0.26%** |

### Capital Efficiency

At ₹2,00,000 capital, 5% per trade = ₹10,000/trade:
```
Monthly fixed cost: ₹500 (Angel One API = free, other costs ~₹500 total)
Breakeven trades:   ~8 winning trades to cover monthly fixed costs
T1 target (1.5%):  ₹140.75 net per winning delivery trade
Monthly target:    ~2–3% of capital
```

---

## Position State Machine

```
         AUTO BUY
            │
            ▼
        [OPEN]
       /      \
      /        \
  T1/T2 hit  EOD positive
  intraday     │
     │         ▼
     │    exitSameDayOnPositive
     │         │
     │    (if net P&L > 0)
     │         │
     └────────►│
               │
               ▼
           [CLOSED]
               
  If negative at EOD OR T1 not reached:
  
  [OPEN] ──15 days──► [HANDED_OFF] ──► Accumulator takes over
  
  Accumulator:
  [OPEN] ──T1 (3%)──► 50% sold ──T2 (7%)──► [CLOSED]
  
  Pivotal stop-loss:
  [OPEN] ──SL breach──► [CLOSED] (bypasses no-loss gate)
```

---

## Journal Event Types

Every significant event is journaled with a `strategyId` tag:

| Event Type | Trigger | Key Fields |
|---|---|---|
| `order` | Any order placed | side, qty, price, source, orderId, tag |
| `signal` | Entry signal fired but not bought | reason (which gate failed) |
| `missed_signal` | T1/T2 was hit but position wasn't monitored | symbol, target, ltpAtMiss |
| `handoff` | Momentum → Accumulator | fromStrategyId, toStrategyId |
| `manual_sell_detected` | Reconciliation found outside close | symbol, qty, estimatedPrice |
| `circuit_tripped` | Circuit breaker activated | type (GIFT/intraday), value |
| `eod_squareoff` | squareOffEOD fired | symbol, qty, price, netPnl |
| `eod_positive_exit` | exitSameDayOnPositive fired | symbol, qty, price, netPnl |
| `stop_loss` | Pivotal stop loss hit | symbol, stopLossPrice, ltp |

---

## Cron Schedule Reference

```
Market hours:  09:15 – 15:30 IST (weekdays, non-holiday)

23:50 IST     Angel One token refresh (all accounts)
09:00 IST     Pre-market: fetch GIFT Nifty, check circuit breaker

Every 3 min   Catalyst BUY scan (during 09:15–15:00)
Every 5 min   Market Boom BUY scan (during 09:30–15:15)
Every 5 min   Pivotal BUY scan (during 10:00–13:00)
Every 5 min   Global sell monitor (all strategies)
Every 5 min   EOD checks (after exitSameDayTime for each strategy)
Every 15 min  Accumulator BUY scan
Every 30 min  Accumulator reactive scan (throttle)

15:10 IST     Pivotal dayEnd execution window
15:10–15:15   exitSameDayOnPositive + squareOffEOD checks
15:35 IST     Reconciliation (detect manual sells)
15:35 IST     Daily retrospective report generation + email
Last trading day of month: Monthly rollup report
```

---

## Watchlists Reference

| List | Used By | Character |
|---|---|---|
| listA | Accumulator, Catalyst, Pivotal | Blue-chip, highest conviction, 40+ stocks |
| listB | Market Boom | Opportunistic, higher volatility |
| QuickWins | Future strategy | Quality + fast cycling, exitSameDayOnPositive |

Watchlist entry format:
```json
{
  "nse": "HDFCBANK",
  "name": "HDFC Bank",
  "sector": "Banking"
}
```

Sector field required for Accumulator sector concentration gate.

---

*End of Trading Engine Core Reference*
