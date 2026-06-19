# DineshTrade v2 — Functional Specification
**Version:** 2.0  
**Date:** June 2026  
**Purpose:** Complete functional specification for DineshTrade v2 — Angel One + Supabase SaaS rebuild  
**Source:** Derived from DineshTrade v1 codebase + strategy configuration + design conversations

---

## 1. Product Overview

DineshTrade is an automated algorithmic trading platform for NSE cash equity. It connects to a stock broker API, scans watchlists for entry signals, places CNC (delivery) orders automatically, monitors positions for exit targets, and manages capital across multiple trading strategies.

### 1.1 Core Philosophy

- **Never sell at a loss** — the no-loss gate is the foundational rule. Every position is held until it is profitable, recovers, or is explicitly overridden by a controlled bypass.
- **Quality stocks only** — only curated watchlist symbols are eligible for auto-trading.
- **Capital velocity** — freeing capital quickly via same-day exits multiplies monthly returns more than holding marginal positions.
- **No F&O, no short selling, no intraday MIS** — CNC delivery orders only, NSE cash segment only.
- **5% per trade** — trade size is always ~5% of deployed capital to limit per-position risk.

### 1.2 v2 Changes from v1

| Dimension | v1 (Current) | v2 (New) |
|---|---|---|
| Broker | Zerodha Kite Connect | Angel One SmartAPI |
| Token refresh | Manual daily login | Automatic via refresh token |
| Database | JSON files on EC2 | Supabase PostgreSQL |
| Auth | Simple session/cookie | Supabase Auth (JWT + RLS) |
| Multi-tenancy | Single user | Multi-user SaaS |
| Static IP | One EC2 IP, Zerodha | One EC2 IP, Angel One |
| API cost | ₹500/month | Free |

### 1.3 User Roles

- **Retail User** — registers, connects their Angel One account, runs their own strategies. Sees only their own data.
- **Broker/Manager** — manages multiple client accounts under one login. Sees all accounts under their management.
- **Platform Admin** — full visibility, billing management, system health.

---

## 2. Fixed Rules (Non-Negotiable Engine Constraints)

These rules are enforced in `lib/preflight.ts` and cannot be overridden by strategy configuration.

| Rule | Description | Bypass |
|---|---|---|
| No short selling | SELL orders blocked if account does not hold the symbol | None |
| No F&O | Only NSE cash equity segment | None |
| No loss sell (auto mode) | Auto SELLs never fire below live average price | squareOffEOD or pivotalStopLoss (explicit audit trail) |
| CNC only | All orders placed as CNC market orders | None |
| NSE only | All symbols must be NSE cash segment | None |
| Sell monitor cadence | Global sell monitor runs every 5 minutes | None |
| Idempotency | Same symbol cannot be auto-bought twice in one day | Manual order bypasses |
| Token gate | Order rejected if access token not connected | None |
| Market hours gate | Orders rejected outside NSE market hours | None |

---

## 3. Shared Capital Configuration

Capital settings apply across all strategies for an account. In multi-tenant v2, each user has their own capital config.

| Parameter | Default | Description |
|---|---|---|
| perTrade | ₹10,000 | Maximum ₹ per auto-mode trade (~5% of ₹2L capital) |
| maxBuysPerDay | 10 | Shared across all active strategies per account |
| maxSellsPerDay | 20 | Shared across all active strategies per account |
| deliveryDpCharge | ₹15.34 | DP charge per delivery SELL day (used in net P&L calculations) |
| circuitBreakerPct | -5% | GIFT Nifty pre-market drop that blocks all auto-BUYs for the day |
| intradayCircuitTripPct | -3% | Live Nifty drop from open that trips intraday circuit |
| intradayCircuitResumePct | -2% | Live Nifty recovery level that resumes auto-BUYs (hysteresis) |
| panicDropPct | 10% | Per-symbol drop from peak within window that flags panic sell |
| panicWindowMin | 10 min | Lookback window for panic sell detection (5-min candle steps) |
| maxDeployPct | 100% | Maximum % of available funds to deploy |
| sharedPool | true | All strategies draw from one capital pool |
| maxOpenPositions | 25 | Maximum simultaneous open positions per account |
| maxBuysPerSymbol | 3 | Pyramid cap — max BUYs stacking into one position |
| minDropBetweenBuysPct | 10% | Each subsequent BUY must be ≥10% below previous BUY price |

### 3.1 Capital Deployment Logic

```
totalCapital = available + deployed
maxDeployable = totalCapital × maxDeployPct / 100
reserve = totalCapital - maxDeployable
remaining = max(0, maxDeployable - deployed)
```

---

## 4. Pre-flight Gates

Every auto order passes through 9 gates in sequence before being placed. Gates are enforced in `lib/preflight.ts`.

```
GATE 1 — Token connected (access token present for account)
GATE 2 — Market open + not NSE holiday
GATE 2b — Intraday circuit not tripped (BUY only, auto only)
GATE 3 — Per-trade cap: tradeValue ≤ perTrade (BUY, auto only)
GATE 4 — Idempotency: not already bought this symbol today (BUY, auto only)
GATE 4b — Panic sell: symbol not in daily panic skip list (BUY, auto only)
GATE 4c — Pyramid: max BUYs per symbol not exceeded, drop % met (BUY, auto only)
GATE 4d — Sector concentration: not at maxPerSector for this sector (BUY, auto, dip only)
GATE 5 — Day quota: maxBuysPerDay / maxSellsPerDay not exceeded (auto only)
GATE 6 — Open positions < maxPositions (BUY, auto only)
GATE 7 — Funds available ≥ tradeValue (BUY)
GATE 8 — No short: held qty > 0 for SELL (qty clamped if held < requested)
GATE 9 — No loss sell: LTP ≥ average_price in auto mode (SELL only)
          Bypassed by: bypassNoLossSellReason = 'squareOffEOD' | 'pivotalStopLoss'
```

Manual orders bypass: GATE 3, 4, 4b, 4c, 4d, 5, 6, 9 (funds and no-short still apply).

---

## 5. Strategy Types

DineshTrade has three strategy types. Each has its own entry logic, exit logic, and parameters.

---

### 5.1 Dip Strategy (Accumulator)

**Philosophy:** Mean-reversion. Buy quality stocks when they dip significantly below their 20-day EMA. Wait for recovery. Exit in two tranches.

**Strategy ID:** `accumulator`  
**Type:** `dip`

#### 5.1.1 Entry Conditions (all must pass)

1. Stock is ≥ `entryBelowPct` (5%) below 20-day EMA
2. Stock has had ≥ `minDownDays` (3) consecutive down days
3. Stock is NOT ≥ `capitulationFloorPct` (12%) below EMA (skip — news/panic event)
4. Strong buy tier: stock ≥ `strongBuyBelowPct` (8%) below EMA — higher conviction, same entry logic
5. GIFT Nifty gate: enabled, maxPct -0.5% — only fires on flat or negative days
6. Sector concentration: fewer than `maxPerSector` (3) open positions in same sector
7. All preflight gates pass

#### 5.1.2 Exit Logic (Two-Tranche)

Exit anchored to `firstBuyPrice` (not average price — pyramid buys don't change the exit anchor):

- **Tranche 1:** LTP ≥ firstBuyPrice × (1 + t1Pct/100) → sell 50% of remaining qty
- **Tranche 2:** LTP ≥ firstBuyPrice × (1 + t2Pct/100) → sell remaining 50%
- **Jump:** If LTP crosses T2 before T1 is hit → sell entire position at T2

Current targets: T1 = 3%, T2 = 7%

#### 5.1.3 Reactive Scan

When any stock in the watchlist drops ≥ `reactiveDrop` (3%) intraday, an off-cycle scan fires immediately (subject to `reactiveIntervalMin` = 30 min throttle). `firesOnAnyMode = true` means this fires even when market mode is Momentum.

#### 5.1.4 Handoff Receipt

Positions handed off from Catalyst/Momentum strategies re-stamp their `strategyId` to `accumulator`. The `firstBuyPrice` and `firstBuyAt` anchors are preserved from the original entry.

---

### 5.2 Momentum Strategy

Two momentum strategies exist: **Catalyst** and **Market Boom**. They share the same engine but with different parameters and EOD behaviour.

**Type:** `momentum`

#### 5.2.1 Entry Conditions (all must pass)

1. Stock's day gain is between `minDayGainPct` and `maxDayGainPct`
2. Last N 5-minute candles are all rising (N = `consecutiveCandles`)
3. LTP is within ±`emaProximityPct` of the 20-day EMA
4. Current time is between `scanStartHHMM` and `scanEndHHMM`
5. GIFT Nifty gate passes (if enabled)
6. All preflight gates pass

#### 5.2.2 Exit Logic

- **T1:** LTP ≥ entryPrice × (1 + t1Pct/100) → sell 100% (momentum = full position exit at T1)
- **T2:** LTP ≥ entryPrice × (1 + t2Pct/100) → sell 100%
- **Candle-high check:** On every sell monitor tick, also check the HIGH of the last completed 5-min candle. If candle high crossed T1 or T2 but LTP has since retreated — sell at current market price immediately. Prevents missed exits when price spikes between cron ticks.

#### 5.2.3 EOD Behaviour (exitSameDayOnPositive + squareOffEOD)

Checked once at `exitSameDayTime` (default 15:15 IST) each trading day.

**squareOffEOD = true:**
- Sell ALL open positions for this strategy at market price, regardless of P&L
- Bypasses no-loss gate (bypassNoLossSellReason = 'squareOffEOD')
- Fires once per strategy per day (idempotent)
- Used by: Market Boom

**exitSameDayOnPositive = true (squareOffEOD = false):**
- For each open position: calculate estimated net P&L after charges
  - Same-day position (bought today): charges = sell-side exchange charges only (~0.106%)
  - Multi-day position (bought before today): charges = sell-side exchange charges + DP charge (₹15.34)
- If estimated net P&L > 0 → sell immediately
- If estimated net P&L ≤ 0 → hold, enter delivery recovery flow
- Philosophy: freeing capital for tomorrow's opportunities outweighs marginal gains; the entry thesis is already dead if it didn't fire same day
- Used by: Catalyst, Market Boom

**Both false:**
- No EOD action
- Position held until T1/T2 or delivery handoff
- Used by: Catalyst (when exitSameDayOnPositive = false)

#### 5.2.4 Delivery Handoff

After `deliveryHandoffDays` calendar days from first BUY, the position is re-tagged from the momentum strategyId to `accumulator`. The Accumulator monitor then manages the exit using its own T1/T2 targets.

Setting `deliveryHandoffDays = 0` disables handoff (position stays with the momentum strategy indefinitely).

#### 5.2.5 Catalyst Parameters (current)

| Parameter | Value |
|---|---|
| minDayGainPct | 0.5% |
| maxDayGainPct | 1.0% |
| consecutiveCandles | 3 |
| emaProximityPct | 3% |
| volumeAvgDays | 10 |
| scanStartHHMM | 09:15 |
| scanEndHHMM | 15:00 |
| deliveryHandoffDays | 15 |
| exitSameDayTime | 15:15 |
| exitSameDayOnPositive | true |
| squareOffEOD | false |
| T1 | 1.5% |
| T2 | 2.0% |
| GIFT Nifty gate | disabled |

#### 5.2.6 Market Boom Parameters (current)

| Parameter | Value |
|---|---|
| minDayGainPct | 0.5% |
| maxDayGainPct | 1.0% |
| consecutiveCandles | 2 |
| emaProximityPct | 5% |
| volumeAvgDays | 5 |
| scanStartHHMM | 09:30 |
| scanEndHHMM | 15:15 |
| deliveryHandoffDays | 15 |
| exitSameDayTime | 15:10 |
| exitSameDayOnPositive | true |
| squareOffEOD | false |
| T1 | 1.0% |
| T2 | 2.0% |
| GIFT Nifty gate | enabled, min +1% (strong gap-up days only) |

---

### 5.3 Pivotal Strategy (Livermore Breakout)

**Philosophy:** Jesse Livermore's Pivotal Point concept. Buy when a stock breaks out of a prior consolidation range with volume confirmation. Each symbol has its own entry trigger, targets, and optional stop-loss.

**Strategy ID:** `new_pivotal`  
**Type:** `pivotal`

#### 5.3.1 Architecture — Per-Symbol Setup (Pivotal List)

Unlike Dip and Momentum, Pivotal uses a dedicated **Pivotal List** for symbol-level configuration. The strategy-level params define scanning behaviour; the Pivotal List defines the trade thesis per symbol.

**Pivotal List entry fields:**
```
symbol              NSE ticker symbol
name                Display name
enabled             Active for scanning
breakoutTriggerPrice  The execution trigger price (required)
t1Pct               First target as % gain from trigger price
t2Pct               Second target as % gain from trigger price
executionMode       'normal' (intraday) | 'dayEnd' (sustain-into-close)
stopLossPrice       Optional. If set, hard exit below this price (overrides no-loss gate)
notes               Optional context notes
```

**Validation rules:**
- `breakoutTriggerPrice` is required and always the execution trigger
- Consolidation high is used for validation/warning only — never controls execution
- `t1Pct` must be ≤ `t2Pct`
- `stopLossPrice` (when present) must be < `breakoutTriggerPrice`
- `stopLossPrice` must be > 0 if provided

#### 5.3.2 Entry Conditions

**Normal mode (intraday):**
1. Time is between `scanStartHHMM` and `scanEndHHMM` (10:00–13:00)
2. Time is ≥ `minProjectedVolumeCheckHHMM` (10:00) for volume check
3. LTP > `breakoutTriggerPrice`
4. Day gain between `minDayGainPct` (1%) and `maxDayGainPct` (4%)
5. Last N 5-min candles rising (N = `breakoutConfirmCandles` = 2)
6. Consolidation validation: last `consolidationDays` (10) days range ≤ `consolidationMaxRangePct` (6%)
7. Volume confirmation: projected day volume ≥ avg volume × `minVolumeSurgeRatio` (1.2)
   - `projectedDayVolume = currentVolume / (minutesElapsed / 375)`
8. All preflight gates pass

**DayEnd mode:**
1. Never buys intraday — waits until `dayEndExecutionTime` (15:10)
2. At `dayEndExecutionTime`: LTP still > `breakoutTriggerPrice`
3. Consolidation validation passes
4. Realized (actual) day volume ≥ avg volume × `minVolumeSurgeRatio` (no projection near close)
5. All preflight gates pass

#### 5.3.3 Exit Logic

Exit precedence (highest to lowest):
1. **Stop-loss:** LTP ≤ `stopLossPrice` → immediate market sell, bypasses no-loss gate (`bypassNoLossSellReason = 'pivotalStopLoss'`)
2. **T2:** LTP ≥ entryPrice × (1 + t2Pct/100) → sell 100%
3. **T1:** LTP ≥ entryPrice × (1 + t1Pct/100) → sell 100%
4. **Delivery handoff:** Position age > `deliveryHandoffDays` (15) → hand off to Accumulator

#### 5.3.4 Strategy-Level Parameters (current)

| Parameter | Value |
|---|---|
| consolidationDays | 10 |
| consolidationMaxRangePct | 6% |
| volumeAvgDays | 10 |
| minVolumeSurgeRatio | 1.2× |
| minDayGainPct | 1% |
| maxDayGainPct | 4% |
| breakoutConfirmCandles | 2 |
| scanStartHHMM | 10:00 |
| scanEndHHMM | 13:00 |
| minProjectedVolumeCheckHHMM | 10:00 |
| dayEndExecutionTime | 15:10 |
| deliveryHandoffDays | 15 |
| T1 (default fallback) | 2% |
| T2 (default fallback) | 3.5% |
| GIFT Nifty gate | disabled |

---

## 6. Exit Rules Hierarchy

When multiple exit conditions could apply simultaneously:

```
Priority 1 (highest): squareOffEOD — overrides everything including no-loss gate
Priority 2:           Stop-loss (Pivotal only) — overrides no-loss gate
Priority 3:           T2 exit — full position sell
Priority 4:           T1 exit — partial (dip: 50%) or full (momentum/pivotal: 100%)
Priority 5:           exitSameDayOnPositive — EOD capital freeing
Priority 6:           Delivery handoff — after N days → Accumulator
Priority 7 (lowest):  No-loss gate — never sell below average cost (default)
```

---

## 7. Cron Architecture

### 7.1 Global Cron Tick (Every 5 Minutes)

Runs during market hours. For each active account:
1. Run sell monitors for all strategy types (strategy1, strategy2, pivotal)
2. Run EOD square-off checks (exitSameDayOnPositive + squareOffEOD)
3. Reconcile manual sells (detect outside-app closes, update positions)

### 7.2 Per-Strategy BUY Scans

Each strategy runs on its own `scanIntervalMin` schedule:
- Accumulator: every 15 minutes + reactive scan on 3% drops
- Catalyst: every 3 minutes
- Market Boom: every 5 minutes
- Pivotal: every 5 minutes

### 7.3 Daily Operations

| Time (IST) | Action |
|---|---|
| 08:15 | Token refresh cron (Angel One refresh token) |
| 09:15 | Market open — scans begin |
| 15:10–15:15 | EOD exitSameDayOnPositive + squareOffEOD checks |
| 15:30 | Market close — scans stop |
| 15:35 | Daily retrospective report generation + email |
| Last trading day of month | Monthly rollup report |

### 7.4 Journal + Position State

Every order (buy or sell) is written to:
- `journal` table — immutable audit log with strategy ID, account, symbol, price, qty, reason, timestamp
- `positions` table — live mutable state: remaining qty, tranche tracking, strategy ID, firstBuyPrice, firstBuyAt

---

## 8. Watchlists

Watchlists are curated lists of NSE symbols. Each symbol entry contains:
```
nse      NSE ticker
name     Display name
sector   NSE sector (used for sector concentration gate)
```

**Current lists:**
- `listA` — Blue-chip, highest conviction. Used by Accumulator, Catalyst, Pivotal.
- `listB` — Opportunistic. Used by Market Boom.
- `QuickWins` — Quality but faster capital cycling. exitSameDayOnPositive = true.

---

## 9. Angel One Integration (v2)

### 9.1 Authentication Flow

**One-time setup per account:**
1. User provides client code + PIN + TOTP in DineshTrade
2. DineshTrade calls Angel One `generateSession(clientCode, pin, totp)`
3. Receives `jwtToken` + `refreshToken` + `feedToken`
4. Stores `refreshToken` encrypted (AES-256) in Supabase accounts table
5. User never needs to login again

**Nightly auto-refresh (11:50 PM IST cron):**
```
For each active Angel One account:
  POST /rest/auth/angelbroking/jwt/v1/generateTokens
  Body: { refreshToken: stored_refresh_token }
  Response: new jwtToken + new refreshToken
  Store updated tokens
  Log: "Token refreshed for [account] at 23:50"

If refresh fails:
  Alert user via email
  Pause auto-trading for that account
  User re-authenticates manually (one-time reset)
```

### 9.2 Broker Adapter Interface

All broker calls go through an `IBroker` interface. Angel One implements this interface. The strategy engine never calls Angel One directly.

```typescript
interface IBroker {
  getMargins(): Promise<{ available: number }>
  getPositions(): Promise<{ net: Position[]; day: Position[] }>
  getHoldings(): Promise<Holding[]>
  getOrders(): Promise<Order[]>
  getQuotes(symbols: string[]): Promise<Record<string, Quote>>
  getHistoricalCandles(token, from, to, interval): Promise<Candle[]>
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>
  cancelOrder(orderId: string): Promise<void>
  getInstrumentToken(symbol: string): Promise<number>
}
```

This enables:
- Zerodha adapter for v1 (preserved, unchanged)
- Angel One adapter for v2
- Future brokers: Upstox, Dhan, Fyers — just add a new adapter

---

## 10. Supabase Database Schema

### 10.1 Core Tables

```sql
-- Managed by Supabase Auth
users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  role text DEFAULT 'retail', -- retail | broker | admin
  plan text DEFAULT 'free',
  created_at timestamptz
)

-- Broker accounts per user
accounts (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  broker text NOT NULL, -- 'angelone' | 'zerodha'
  client_code text,
  api_key text,
  refresh_token_enc text, -- AES-256 encrypted
  access_token_enc text,  -- AES-256 encrypted
  token_expiry timestamptz,
  active boolean DEFAULT true,
  nickname text,
  created_at timestamptz
)

-- Strategies per user
strategies (
  id text, -- e.g. 'accumulator', 'catalyst'
  user_id uuid REFERENCES users,
  name text,
  type text, -- 'dip' | 'momentum' | 'pivotal'
  params jsonb,
  exits jsonb,
  gift_nifty_gate jsonb,
  active boolean,
  color text,
  scan_interval_min integer,
  watchlist text[],
  created_at timestamptz,
  PRIMARY KEY (id, user_id)
)

-- Capital config per user
capital_config (
  user_id uuid PRIMARY KEY REFERENCES users,
  per_trade numeric,
  max_buys_per_day integer,
  max_sells_per_day integer,
  delivery_dp_charge numeric,
  circuit_breaker_pct numeric,
  intraday_circuit_trip_pct numeric,
  intraday_circuit_resume_pct numeric,
  panic_drop_pct numeric,
  panic_window_min integer,
  max_deploy_pct numeric,
  shared_pool boolean,
  max_positions integer,
  max_buys_per_symbol integer,
  min_drop_between_buys_pct numeric
)

-- Watchlists per user
watchlists (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  list_key text, -- 'listA', 'listB', etc.
  name text,
  symbols jsonb -- [{nse, name, sector}]
)

-- Pivotal lists per user
pivotal_lists (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  list_id text, -- 'pivotalA', etc.
  name text,
  entries jsonb -- [{nse, name, enabled, breakoutTriggerPrice, t1Pct, t2Pct, executionMode, stopLossPrice, notes}]
)

-- Live positions
positions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  account_id uuid REFERENCES accounts,
  strategy_id text,
  symbol text,
  total_qty integer,
  remaining_qty integer,
  first_buy_price numeric,
  first_buy_at timestamptz,
  tranche1_at timestamptz,
  tranche1_sold_qty integer,
  position_source text, -- 'dip' | 'handoff' | 'pivotal'
  status text DEFAULT 'open', -- 'open' | 'closed' | 'handed_off'
  lots jsonb -- array of individual buy lots [{qty, price, bought_at}]
)

-- Order log (immutable)
orders (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  account_id uuid REFERENCES accounts,
  strategy_id text,
  symbol text,
  side text, -- 'BUY' | 'SELL'
  qty integer,
  price numeric,
  broker_order_id text,
  tag text,
  status text,
  source text, -- 'auto' | 'manual'
  reason text,
  created_at timestamptz
)

-- Journal (audit trail)
journal (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  account_id uuid REFERENCES accounts,
  strategy_id text,
  event_type text,
  symbol text,
  detail jsonb,
  created_at timestamptz
)

-- Backtest runs
backtest_runs (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  strategy_id text,
  strategy_name text,
  strategy_type text,
  params jsonb,
  results jsonb,
  run_at timestamptz
)

-- State (per account — replaces state.json)
account_state (
  account_id uuid PRIMARY KEY REFERENCES accounts,
  mode text DEFAULT 'manual', -- 'auto' | 'manual'
  idempotency_ledger jsonb DEFAULT '{}',
  buy_history jsonb DEFAULT '{}',
  daily_counters jsonb DEFAULT '{}',
  circuit_state jsonb DEFAULT '{}',
  updated_at timestamptz
)
```

### 10.2 Row Level Security Policies

```sql
-- Users see only their own data
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own accounts" ON accounts
  FOR ALL USING (auth.uid() = user_id);

-- Same pattern for all tables
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own positions" ON positions
  FOR ALL USING (auth.uid() = user_id);

-- Broker/manager can see client accounts they manage
CREATE POLICY "manager access" ON accounts
  FOR SELECT USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM manager_relationships mr
      WHERE mr.manager_id = auth.uid()
      AND mr.client_id = user_id
    )
  );
```

---

## 11. Multi-Tenant Cron Architecture

In v2, all cron jobs are tenant-aware. Every scan loops across all active users and their accounts.

```
Every 5 minutes (global monitor tick):
  Load all active users
  For each user:
    Load their active accounts (with valid tokens)
    For each account:
      Run sell monitors (dip, momentum, pivotal)
      Run EOD checks (if exitSameDayTime reached)
      Run reconciliation
      Use account's own: capital config, positions, counters, circuit state

Per-strategy scans (on strategy scanIntervalMin schedule):
  Load all users who have this strategy type active
  For each user × account:
    Run BUY scan with user's own watchlist, params, capital
    Place orders on their broker account
    Write to their positions + journal
```

---

## 12. SaaS Subscription Model

| Plan | Price | Accounts | Strategies | Notes |
|---|---|---|---|---|
| Starter | ₹499/month | 1 | 3 | Individual retail trader |
| Pro | ₹1,499/month | 3 | Unlimited | Active trader + family |
| Broker | ₹4,999/month | 20 | Unlimited | Manager dashboard |
| Enterprise | Custom | Unlimited | Unlimited | White-label |

Payment via Razorpay subscriptions.

---

## 13. Email Notifications

The following events trigger email notifications:

| Event | Recipient | Content |
|---|---|---|
| Trade executed (BUY) | Account owner | Symbol, qty, price, strategy, order ID |
| Trade executed (SELL) | Account owner | Symbol, qty, price, reason (T1/T2/EOD/SL), net P&L estimate |
| Token refresh failed | Account owner | Account name, instructions to re-authenticate |
| Circuit breaker tripped | Account owner | GIFT Nifty %, reason, auto-trading paused |
| Daily retrospective (15:35) | Account owner | Trades today, missed signals, open positions, capital status |
| Monthly rollup | Account owner | Month's P&L, win rate, top performers, charge summary |

---

## 14. Key Calculations

### 14.1 Charge Estimation (for net P&L)

```
Same-day exit (intraday):
  STT:          0.025% of sell value
  Exchange NSE: 0.00345% of trade value (both sides)
  Stamp duty:   0.003% of buy value
  SEBI:         0.0001% of trade value
  IPFT:         0.0001% of trade value
  GST:          18% on (exchange + brokerage)
  DP charge:    ₹0 (shares never settled)
  Total:        ~0.22% of trade value

Delivery exit (multi-day):
  Same as above +
  DP charge:    ₹15.34 flat per sell transaction
  Total:        ~0.54% of trade value

Breakeven:
  Intraday:     0.22% gain covers charges
  Delivery:     0.54% gain covers charges
```

### 14.2 EOD Net P&L Estimate

```typescript
function estimateExitNetPnl(firstBuyAt, entryPrice, exitPrice, qty) {
  const mode = firstBuyAt.slice(0,10) === today ? 'intraday' : 'delivery'
  const buyValue = entryPrice * qty
  const sellValue = exitPrice * qty
  const charges = estimateCharges(mode, buyValue, sellValue)
  return (sellValue - buyValue) - charges
}
// exitSameDayOnPositive fires when estimateExitNetPnl > 0
```

### 14.3 Projected Volume (Pivotal Normal Mode)

```
projectedDayVolume = currentVolume / (minutesElapsed / 375)
// Only evaluated after minProjectedVolumeCheckHHMM (10:00 IST)
// minutesElapsed = max(1, min(375, currentMinute - 09:15))
```

---

## 15. Outstanding Bugs / Planned Fixes for v2

These are known issues from v1 to be fixed during v2 build:

1. **Market Boom squareOffEOD** — currently set to `false` in config.json but should be `true`. Causes Market Boom positions to accidentally go to delivery.

2. **Market Boom deliveryHandoffDays** — currently 15, should be 0 when squareOffEOD = true. No position should ever hand off from Market Boom.

3. **Catalyst scanStart** — currently 09:15, first 15 minutes are very noisy. Recommend 09:30.

4. **Accumulator T2** — currently 7%, discussions suggest this may need differentiation between fresh dip entries (keep 7%) and Catalyst handoff entries (reduce to 5%). Implement `positionSource` tagging to enable this in v2.

5. **Pivotal minVolumeSurgeRatio** — 1.2× is low. Recommend 1.5× for stronger breakout confirmation.

6. **Panic-Sell Drop** — 10% is very late detection. Recommend 4–5%.

---

## 16. Non-Functional Requirements

| Requirement | Target |
|---|---|
| EC2 region | ap-south-1 (Mumbai) — matches Supabase region |
| Supabase region | ap-south-1 |
| Token refresh | Completes before 08:30 IST daily |
| Order placement latency | < 2 seconds from signal to order |
| Cron reliability | No skipped ticks during market hours |
| Data isolation | Zero cross-tenant data leakage (RLS enforced) |
| Credential storage | AES-256 encrypted, key in environment variable only |
| Backup | Supabase automated daily backups |

---

*End of Functional Specification v2.0*
