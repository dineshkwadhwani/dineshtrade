# DineshTrade v2 — VS Code Claude Handoff Document

**Version:** 2.0  
**Date:** June 2026  
**Purpose:** Briefing document for VS Code Claude starting the v2 SaaS rebuild  
**Read this first before writing any code**

---

## What You Are Building

You are building **DineshTrade v2** — a SaaS-ready algorithmic trading platform.

The existing v1 codebase (`dineshtrade-copy/`) is your starting point. You will create a new repository that starts from this code and evolves it into a multi-tenant SaaS application. **Do not modify the v1 application.** It remains live and operational.

The three major changes from v1 to v2:

1. **Broker:** Zerodha Kite Connect → Angel One SmartAPI
2. **Database:** JSON files on disk → Supabase PostgreSQL
3. **Architecture:** Single user → Multi-tenant SaaS

Everything else — all strategy logic, all trading rules, all entry/exit conditions — stays identical.

---

## The v1 Codebase — What Exists

### Repository Structure

```text
dineshtrade-copy/
├── app/                    Next.js 14 App Router pages + API routes
│   ├── (app)/              Authenticated app pages
│   │   ├── settings/       Strategy + capital configuration UI
│   │   ├── manage-lists/   Watchlist management
│   │   ├── backtest/       Backtesting UI
│   │   └── ...
│   ├── api/                API route handlers
│   │   ├── strategy/       Strategy scan, monitor, backtest endpoints
│   │   ├── orders/         Order placement endpoints
│   │   ├── watchlist/      Watchlist CRUD
│   │   └── ...
│   └── login/              Login page (token paste UI)
├── lib/                    Core business logic
│   ├── kite.ts             Zerodha Kite Connect API wrapper ← REPLACE WITH ANGEL ONE
│   ├── strategyConfig.ts   Strategy type definitions + config accessors
│   ├── strategyConfigStore.ts  Runtime strategy config (reads data/strategy.json)
│   ├── strategyEngine.ts   Main buy scan engine (dip + momentum)
│   ├── strategy1.ts        Accumulator (dip) sell monitor
│   ├── strategy2.ts        Catalyst/Momentum sell monitor
│   ├── strategy2Positions.ts  Momentum position helpers
│   ├── pivotal.ts          Pivotal strategy scanner + sell monitor
│   ├── pivotalListStore.ts Pivotal list CRUD (reads config/pivotalLists.json)
│   ├── preflight.ts        Pre-flight gates (no-loss, idempotency, etc.)
│   ├── positions.ts        Position state management (reads/writes data/positions.json)
│   ├── journal.ts          Trade journal (reads/writes data/journal/*.json)
│   ├── state.ts            App state (mode, tokens, counters — reads/writes data/state.json)
│   ├── accounts.ts         Account config (reads config/accounts.json + env vars)
│   ├── watchlistStore.ts   Watchlist CRUD (reads/writes config/watchlist.json)
│   ├── cron.ts             Cron job scheduler (node-cron)
│   ├── cronBuy.ts          Buy scan orchestration
│   ├── cronEOD.ts          EOD square-off + daily retrospective
│   ├── cronReconcile.ts    Manual sell reconciliation
│   ├── cronState.ts        Cron state helpers (roll day, executed/failed log)
│   ├── backtest.ts         Backtesting engine
│   ├── backtestHistory.ts  Backtest history store
│   ├── ema.ts              EMA calculation
│   ├── dailyCloses.ts      Daily close price cache
│   ├── instruments.ts      NSE instrument token lookup
│   ├── intradayCircuit.ts  Intraday circuit breaker
│   ├── panicSell.ts        Panic sell detection
│   ├── retrospective.ts    Daily/monthly report builder
│   ├── tradeReport.ts      Trade report generation
│   ├── email.ts            Email notifications (Nodemailer + Gmail SMTP)
│   ├── auth.ts             Session auth (simple cookie-based)
│   ├── ai.ts               Claude API integration for analysis
│   └── market.ts           Market hours + holiday check
├── config/                 Static configuration files (v1 — replaced by DB in v2)
│   ├── strategy.json       Strategy definitions + capital config
│   ├── watchlist.json      Watchlists (listA, listB, etc.)
│   ├── pivotalLists.json   Pivotal list entries
│   ├── accounts.json       Account display names (credentials in env)
│   └── holidays.json       NSE holiday calendar
├── data/                   Runtime state files (v1 — replaced by DB in v2)
│   ├── state.json          Mode, tokens, idempotency ledger, buy history
│   ├── positions.json      Open positions
│   ├── strategy.json       Runtime strategy overlay (edits from Settings UI)
│   ├── journal/            Daily journal files (YYYY-MM-DD.json)
│   └── backtest-history.json
├── components/             Shared React components
├── scripts/                Build scripts
├── server.js               Custom Next.js server (wraps Next + starts cron)
├── docs/
│   ├── functional-specification.md  (v1 spec — superseded by FUNCTIONAL_SPEC.md)
│   ├── technical-specification.md   (v1 tech spec)
│   ├── TradingEngine.md             Engine flow diagram
│   └── context.md                   Development context log
├── CONTEXT.md              Quick context for Claude (keep updated)
└── COPILOT.md              GitHub Copilot instructions
```

### Tech Stack (v1)

```text
Framework:      Next.js 14, App Router, TypeScript
Styling:        Tailwind CSS
Server:         Custom Node.js server (server.js) wraps Next.js + starts node-cron
Cron:           node-cron (runs in the same process as Next.js)
Broker:         Zerodha Kite Connect (kiteconnect npm package + direct REST calls)
Auth:           Simple JWT cookie (lib/auth.ts using jose library)
State:          JSON files on disk (config/ and data/ directories)
Email:          Nodemailer + Gmail SMTP
AI:             Anthropic Claude API (lib/ai.ts)
Deployment:     AWS EC2, Ubuntu, PM2 process manager
```

### Key Patterns to Understand

**1. Runtime Strategy Overlay**
Strategy config exists in two places:

- `config/strategy.json` — bundled defaults (on disk, in repo)
- `data/strategy.json` — runtime overlay (user edits via Settings UI, NOT in repo)

`lib/strategyConfigStore.ts` reads the overlay first, falls back to bundled config. In v2, both become the `strategies` table in Supabase with the user's saved config.

**2. Idempotency**
Prevents double-buying. Stored in `state.json` as `idempotencyLedger[account][symbol]`. Key expires at start of next IST day. In v2, moves to `account_state.idempotency_ledger` in Supabase.

**3. Position Lots**
Each position has a `lots` array tracking individual BUY entries. Pyramid BUYs add lots without changing `firstBuyPrice` (the exit anchor). The Accumulator strategy exits based on `firstBuyPrice`, not average price.

**4. Strategy Tags**
Every order is tagged (e.g. `dt-s1`, `dt-catalyst`, `dt-eod-market_boom`). Tags link orders to strategies in the journal and Kite order book.

Current attribution policy (27 Jul 2026):

- Primary ownership source: `data/positions.json` (`account:symbol` -> `strategyId`).
- Positions API strategy resolution order:
  1. tracked strategy from positions store
  2. latest completed BUY tag for the symbol (today)
  3. latest completed order tag (BUY/SELL) for the symbol (today)
  4. fallback to `accumulator` for manual/untagged/non-`dt-*` tags
- Tag normalization:
  - `dt-manual` / `manual` -> `accumulator`
  - `dt-s1` -> `accumulator`
  - `dt-s2` -> `catalyst`
- Manual SELL attribution keeps `source: 'manual'` while preserving the owning strategy from the tracked position.

**5. Reconciliation**
`cronReconcile.ts` runs at 15:35 to detect positions that were sold manually in Kite (outside the app). It closes them in the local positions store and journals the manual sell.

**6. Account Credentials**
In v1, credentials are in environment variables:

```text
DW_API_KEY=xxx        (Zerodha API key for account DW)
DW_API_SECRET=xxx     (Zerodha API secret for account DW)
```

Access tokens are pasted daily via Settings UI and stored in `data/state.json`.

In v2, credentials move to Supabase `accounts` table (encrypted).

---

## The v1 → v2 Migration Plan

### What Changes

| Component | v1 | v2 |
| --- | --- | --- |
| `lib/kite.ts` | Zerodha Kite Connect | Angel One SmartAPI adapter |
| `lib/accounts.ts` | Reads env vars + accounts.json | Reads from Supabase |
| `lib/state.ts` | Reads/writes state.json | Reads/writes Supabase account_state |
| `lib/positions.ts` | Reads/writes positions.json | Reads/writes Supabase positions |
| `lib/journal.ts` | Reads/writes journal/*.json files | Reads/writes Supabase journal |
| `lib/watchlistStore.ts` | Reads/writes config/watchlist.json | Reads/writes Supabase watchlists |
| `lib/pivotalListStore.ts` | Reads/writes config/pivotalLists.json | Reads/writes Supabase pivotal_lists |
| `lib/strategyConfigStore.ts` | Reads config/strategy.json + data/strategy.json | Reads Supabase strategies + capital_config |
| `lib/auth.ts` | Simple cookie session | Supabase Auth (JWT + RLS) |
| `lib/backtestHistory.ts` | Reads/writes backtest-history.json | Reads/writes Supabase backtest_runs |
| Token refresh | Manual daily paste | Automatic nightly refresh token cron |
| Cron | Single-user | Multi-tenant (loops all users) |

### What Does NOT Change

- `lib/strategyEngine.ts` — buy scan logic (untouched)
- `lib/strategy1.ts` — Accumulator sell monitor (untouched)
- `lib/strategy2.ts` — Momentum sell monitor (untouched)
- `lib/pivotal.ts` — Pivotal scanner + monitor (untouched)
- `lib/preflight.ts` — Pre-flight gates (untouched except broker API calls)
- `lib/cronEOD.ts` — EOD square-off logic (untouched)
- `lib/backtest.ts` — Backtesting engine (untouched)
- `lib/ema.ts` — EMA calculations (untouched)
- `lib/retrospective.ts` — Report builder (untouched)
- All strategy logic, all trading rules, all entry/exit conditions

---

## The Broker Adapter Pattern

**This is the most important architectural decision in v2.**

Create an `IBroker` interface. All strategy engine code calls the interface. Never call Angel One directly from strategy code.

```typescript
// lib/broker/IBroker.ts
export interface IBroker {
  getMargins(): Promise<{ available: number }>
  getPositions(): Promise<{ net: BrokerPosition[]; day: BrokerPosition[] }>
  getHoldings(): Promise<BrokerHolding[]>
  getOrders(): Promise<BrokerOrder[]>
  getQuotes(symbols: string[]): Promise<Record<string, BrokerQuote>>
  getHistoricalCandles(
    instrumentToken: number, from: string, to: string,
    interval: 'day' | '5minute' | '15minute'
  ): Promise<HistoricalCandle[]>
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>
  cancelOrder(orderId: string): Promise<void>
  resolveInstrumentToken(symbol: string): Promise<number>
}

// lib/broker/AngelOneAdapter.ts — implements IBroker for Angel One SmartAPI
// lib/broker/ZerodhaAdapter.ts  — implements IBroker for Zerodha (kept for reference)

// lib/broker/index.ts — returns the right adapter based on account.broker field
export function getBrokerAdapter(account: AccountRecord): IBroker {
  if (account.broker === 'angelone') return new AngelOneAdapter(account)
  if (account.broker === 'zerodha') return new ZerodhaAdapter(account)
  throw new Error(`Unknown broker: ${account.broker}`)
}
```

Replace all `resolveAccountCreds()` + `kiteRequest()` calls in preflight and strategy files with `getBrokerAdapter(account).method()` calls.

---

## Angel One SmartAPI — Key Differences from Kite

| Feature | Zerodha Kite | Angel One SmartAPI |
| --- | --- | --- |
| Base URL | `https://api.kite.trade` | `https://apiconnect.angelone.in` |
| Auth header | `Authorization: token {apiKey}:{accessToken}` | `Authorization: Bearer {jwtToken}` + `X-PrivateKey: {apiKey}` |
| Session endpoint | `POST /session/token` | `POST /rest/auth/angelbroking/user/v1/loginByPassword` |
| Token refresh | None (manual daily) | `POST /rest/auth/angelbroking/jwt/v1/generateTokens` |
| Token expiry | 6 AM IST | Midnight IST |
| Orders endpoint | `POST /orders/regular` | `POST /rest/secure/angelbroking/order/v1/placeOrder` |
| Positions | `GET /portfolio/positions` | `GET /rest/secure/angelbroking/order/v1/getPosition` |
| Holdings | `GET /portfolio/holdings` | `GET /rest/secure/angelbroking/portfolio/v1/getHolding` |
| Quotes | `GET /quote?i=NSE:SYM` | `POST /rest/secure/angelbroking/market/v1/getMarketData` |
| Historical | `GET /instruments/historical/{token}/{interval}` | `POST /rest/secure/angelbroking/historical/v1/getCandleData` |
| Margins | `GET /user/margins` | `GET /rest/secure/angelbroking/user/v1/getRMS` |
| Product type (CNC) | `CNC` | `DELIVERY` |
| Order type (MARKET) | `MARKET` | `MARKET` |
| Exchange | `NSE` | `NSE` |

**Important:** Angel One uses `DELIVERY` not `CNC` for delivery orders. Map this in the adapter.

---

## Angel One Token Refresh Implementation

```typescript
// lib/broker/angelTokenRefresh.ts

export async function refreshAngelOneToken(account: AccountRecord): Promise<string> {
  const refreshToken = decrypt(account.refresh_token_enc)
  
  const response = await fetch(
    'https://apiconnect.angelone.in/rest/auth/angelbroking/jwt/v1/generateTokens',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': process.env.SERVER_IP || '',
        'X-ClientPublicIP': process.env.SERVER_IP || '',
        'X-MACAddress': process.env.SERVER_MAC || '',
        'X-PrivateKey': account.api_key,
        'Authorization': `Bearer ${decrypt(account.access_token_enc)}`,
      },
      body: JSON.stringify({ refreshToken })
    }
  )
  
  const data = await response.json()
  
  // Store new tokens
  await supabase.from('accounts').update({
    access_token_enc: encrypt(data.data.jwtToken),
    refresh_token_enc: encrypt(data.data.refreshToken),
    token_expiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }).eq('id', account.id)
  
  return data.data.jwtToken
}

// Nightly cron at 23:50 IST
export async function nightlyTokenRefreshAll(): Promise<void> {
  const { data: accounts } = await supabase
    .from('accounts')
    .select('*')
    .eq('broker', 'angelone')
    .eq('active', true)
  
  for (const account of accounts || []) {
    try {
      await refreshAngelOneToken(account)
      console.log(`[token refresh] ${account.nickname} refreshed OK`)
    } catch (err) {
      console.error(`[token refresh] ${account.nickname} FAILED:`, err)
      await sendTokenRefreshFailureEmail(account)
      await supabase.from('accounts').update({ active: false }).eq('id', account.id)
    }
  }
}
```

---

## Supabase Setup

### Environment Variables

```bash
# .env.local (development)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx  # server-side only, never expose to client
DATABASE_URL=postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres

# Encryption key for credentials
DINESHTRADE_CRYPT_KEY=xxx  # 32-byte hex string, never in code

# Angel One
SERVER_IP=xxx.xxx.xxx.xxx  # EC2 elastic IP (registered with Angel One)
SERVER_MAC=xx:xx:xx:xx:xx:xx  # EC2 network interface MAC

# Email (unchanged from v1)
SMTP_HOST=smtp.gmail.com
SMTP_USER=xxx@gmail.com
SMTP_PASS=xxx  # Gmail app password

# Anthropic (unchanged)
ANTHROPIC_API_KEY=xxx
```

### Supabase Client Setup

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

// Server-side client (full access, service role)
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Client-side client (respects RLS)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

---

## Multi-Tenant Cron Pattern

In v2, every cron job loops all active users. Here's the pattern:

```typescript
// lib/cronBuy.ts (v2 pattern)
export async function runBuyScans(): Promise<void> {
  // Load all active users with active accounts
  const { data: activeAccounts } = await supabaseAdmin
    .from('accounts')
    .select('*, users(id, plan)')
    .eq('active', true)
    .not('access_token_enc', 'is', null)
  
  for (const account of activeAccounts || []) {
    try {
      // Load this user's strategies
      const { data: strategies } = await supabaseAdmin
        .from('strategies')
        .select('*')
        .eq('user_id', account.user_id)
        .eq('active', true)
      
      // Load this user's capital config
      const { data: capitalConfig } = await supabaseAdmin
        .from('capital_config')
        .select('*')
        .eq('user_id', account.user_id)
        .single()
      
      // Get broker adapter for this account
      const broker = getBrokerAdapter(account)
      
      // Run scans — passing user-specific config
      for (const strategy of strategies || []) {
        await runStrategyBuyScan(strategy, account, capitalConfig, broker)
      }
    } catch (err) {
      console.error(`[cron buy] account ${account.id} failed:`, err)
      // One account failure does NOT stop other accounts
    }
  }
}
```

---

## Phase-by-Phase Build Plan

### Phase 1 — Foundation (Week 1–2)

**Goal:** Database + auth working, no trading yet

1. Setup Supabase project (dev + prod)
2. Create schema (all tables from FUNCTIONAL_SPEC.md §10)
3. Implement Supabase Auth (replace lib/auth.ts)
4. Implement Row Level Security policies
5. Create Supabase client helpers (lib/supabase.ts)
6. Seed your own account data into Supabase
7. Verify RLS: user A cannot see user B's data

**Deliverable:** Login with Supabase Auth, see your own strategies and positions from DB.

---

### Phase 2 — Angel One Adapter (Week 2–3)

**Goal:** Angel One trading working for your personal account

1. Build `IBroker` interface (lib/broker/IBroker.ts)
2. Build Angel One adapter (lib/broker/AngelOneAdapter.ts)
3. Build token refresh logic (lib/broker/angelTokenRefresh.ts)
4. Build nightly refresh cron (23:50 IST)
5. Replace `resolveAccountCreds()` in preflight.ts with adapter pattern
6. Replace `kiteRequest()` calls with adapter methods
7. Test: place a manual order via Angel One

**Deliverable:** Manual orders working via Angel One. Token auto-refreshes nightly.

---

### Phase 3 — Strategy Engine Migration (Week 3–4)

**Goal:** All automated trading working via Supabase + Angel One

1. Replace lib/state.ts file I/O with Supabase account_state
2. Replace lib/positions.ts file I/O with Supabase positions
3. Replace lib/journal.ts file I/O with Supabase journal
4. Replace lib/watchlistStore.ts file I/O with Supabase watchlists
5. Replace lib/strategyConfigStore.ts file I/O with Supabase strategies
6. Make all cron jobs tenant-aware (loop all active accounts)
7. Test all strategies: Accumulator, Catalyst, Market Boom, Pivotal

**Deliverable:** Full automated trading running from Supabase data.

---

### Phase 4 — SaaS Layer (Week 5–6)

**Goal:** Second user can register and run their own strategies

1. User registration + onboarding flow
2. Account connection wizard (Angel One OAuth)
3. Strategy management per user
4. Capital config per user
5. Watchlist management per user
6. Dashboard: account overview, positions, journal

**Deliverable:** A second user can sign up, connect Angel One, and run strategies independently.

---

### Phase 5 — Broker Manager Role (Week 7–8)

**Goal:** Manager can manage multiple client accounts

1. Manager role implementation
2. Manager-client relationship table
3. Manager dashboard: all accounts, all positions
4. Client onboarding via email invite
5. Billing via Razorpay subscriptions

**Deliverable:** A manager can add client accounts and run strategies for them.

---

## Known Issues to Fix in v2

These bugs exist in v1 and must be fixed during v2 build:

1. **Market Boom squareOffEOD = false** — Should be `true`. Market Boom positions are accidentally going to delivery. Fix in strategy config defaults.

2. **Market Boom deliveryHandoffDays = 15** — Should be `0` since squareOffEOD = true. Fix alongside #1.

3. **Catalyst scanStartHHMM = 09:15** — Opening 15 minutes too noisy. Should be `09:30`. Fix in defaults.

4. **Pivotal minVolumeSurgeRatio = 1.2** — Too low for real breakout confirmation. Should be `1.5`. Fix in defaults.

5. **Panic-Sell Drop = 10%** — Too late to be useful. Should be `4–5%`. Fix in defaults.

---

## Session Start Instructions

Every time you start a new VS Code Claude session on this project:

1. Read `FUNCTIONAL_SPEC.md` in the project root — this is the authoritative specification
2. Read `HANDOFF.md` (this document) — understand the codebase
3. Read `CONTEXT.md` — check for recent updates and decisions
4. Ask: "What phase are we on and what is the next task?"

Do not write code before reading these three documents.

---

## How to Update Context

After completing each significant task, update `CONTEXT.md` with:

- What was built
- Key decisions made
- Any deviations from the spec and why
- What comes next

This maintains continuity across sessions.

---

## End of Handoff Document
