# DineshTrade — Technical Specification

**Version:** 1.4 · **Last Updated:** 23 May 2026

This document covers the *how* — architecture, stack choices, infrastructure, and the build & deploy runbook. For the *what*, see `functional-specification.md`.

---

## 1. Technology Stack

### 1.1 Application layer
| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | Next.js | 14.2.3 (App Router) | File-based routing, edge middleware, instrumentation.ts hook for cron registration |
| Language | TypeScript | 5.x | Trade-side bugs are too expensive to debug at runtime |
| UI | React | 18 | Default with Next |
| Styling | Tailwind CSS | 3.4 | Inline utility classes — no extra build step, mobile-first |
| Fonts | Cormorant Garamond + Outfit + JetBrains Mono | Google Fonts | Serif headings, sans body, mono for numbers |
| JWT | `jose` | 5.x | Edge-runtime compatible (middleware can verify) |

### 1.2 Integrations
| Integration | Library | Purpose |
|---|---|---|
| Zerodha Kite | `kiteconnect` 5.x + direct HTTP via `axios` | OAuth, orders, positions, holdings, quotes, historical candles |
| Email | `nodemailer` 6.x | SMTP send via Gmail App Password |
| Cron | `node-cron` 3.x | In-process scheduler with Asia/Kolkata timezone support |
| AI | Multi-provider via `lib/ai.ts` | Anthropic / Gemini / Groq / OpenAI for market briefing |

### 1.3 Why these choices
- **Next.js over Express:** the app needs a UI *and* server logic. App Router gives both in one project; instrumentation.ts is the cleanest way to register cron jobs that survive HMR in dev and PM2 restarts in prod.
- **Cookie + file state, no DB:** trade state is small (<100 KB), single-writer, and benefits more from append-only durability than from query power. Adding Postgres would 10× the deploy complexity for zero new capability today. Migrate when query needs justify it.
- **node-cron, not external schedulers:** the cron must trade against the same authenticated session. An external scheduler would either need to call an HTTP endpoint (extra surface area) or hold its own Kite token (duplicate state).
- **Multi-provider AI:** Anthropic was burning cost during dev; Gemini's free tier covers the morning briefing comfortably. Provider switch is one env var change.

---

## 2. Repository Layout

```
.
├── app/                            # Next.js App Router
│   ├── (app)/                      # Authenticated layout group
│   │   ├── dashboard/page.tsx
│   │   ├── watchlist/page.tsx
│   │   ├── engine/page.tsx
│   │   ├── holdings/page.tsx
│   │   ├── positions/page.tsx      # NEW — 19 May
│   │   ├── trades/page.tsx         # Today's Orders + Retrospective tabs
│   │   ├── trade-report/page.tsx   # Date-range real trade report
│   │   └── settings/page.tsx
│   ├── api/
│   │   ├── auth/route.ts
│   │   ├── accounts/route.ts
│   │   ├── email/test/route.ts
│   │   ├── journal/dates/route.ts          # NEW
│   │   ├── journal/[date]/route.ts         # NEW
│   │   ├── market/route.ts
│   │   ├── positions/route.ts              # NEW — joined positions
│   │   ├── state/route.ts
│   │   ├── strategy/backtest/history/route.ts          # Backtest history list + reset
│   │   ├── strategy/backtest/history/analyze/route.ts  # Backtest history analysis
│   │   ├── trade-report/route.ts           # NEW — real trade report
│   │   ├── strategy/route.ts
│   │   ├── strategy/monitor/route.ts
│   │   ├── strategy/positions/route.ts
│   │   └── zerodha/{route,callback,login,token}.ts
│   ├── login/page.tsx
│   └── layout.tsx
├── components/
│   ├── OrderModal.tsx              # Universal Buy/Sell modal
│   └── layout/AppShell.tsx         # Top + bottom nav
├── config/
│   ├── accounts.json
│   ├── holidays.json
│   ├── strategy.json
│   └── watchlist.json
├── lib/
│   ├── accounts.ts                 # Env-prefix account enumeration
│   ├── ai.ts                       # Multi-provider AI dispatcher
│   ├── auth.ts                     # ddmmyyyyhh password + JWT
│   ├── backtestHistory.ts          # Persistent backtest-history store + configured-AI analysis helper
│   ├── cron.ts                     # Tick + retrospective registration
│   ├── ema.ts                      # EMA computation
│   ├── email.ts                    # nodemailer + HTML templates
│   ├── dailyCloses.ts              # Rolling 60-day daily-close cache (incremental fetch each morning)
│   ├── instruments.ts              # NSE instrument-token cache
│   ├── intradayCircuit.ts          # Live NIFTY 50 hysteresis trip/resume (preflight gate 2b)
│   ├── journal.ts                  # JSONL append/read — trade, signal_skipped, strategy_scan, order
│   ├── kite.ts                     # Shared Kite API helpers
│   ├── market.ts                   # Market hours, holidays (client-safe)
│   ├── marketBriefing.ts           # Cached morning briefing (IST-day cache + in-flight dedup)
│   ├── marketMock.ts               # USE_MOCK_MARKET fixtures for dev
│   ├── panicSell.ts                # Per-symbol drop-from-peak gate (preflight gate 4b)
│   ├── positions.ts                # Unified position store — strategyId-tagged rows
│   ├── preflight.ts                # 10 gates (incl. intraday circuit, panic-sell, pyramid)
│   ├── retrospective.ts            # buildDailyReport + buildMonthlyReport + buildLiveSnapshot + buildStrategyHealth
│   ├── state.ts                    # Cookie + file state backends (persistent ledger, buy history, panic skip)
│   ├── strategy.ts                 # Mode resolver
│   ├── strategy1.ts                # Accumulator (dip / EMA two-tranche) monitor
│   ├── strategy2.ts                # Catalyst (momentum) monitor
│   ├── tradeReport.ts              # Date-range real-trade replay from journaled order legs + estimated net-after-charges metrics
│   ├── strategyConfig.ts           # Strategy schema + reader (DipParams, MomentumParams, CapitalConfig)
│   ├── strategyConfigStore.ts      # Runtime overlay at data/strategy.json + legacy id migration
│   ├── strategy2Positions.ts       # Thin facade over positions.ts (back-compat)
│   ├── strategyEngine.ts           # Dispatcher (universe deduped across N selected lists)
│   ├── backtest.ts                 # Historical Strategy 1 replay + equity curve
│   └── watchlistStore.ts           # Named-list store: { meta, lists } with stable keys
├── instrumentation.ts              # Cron registration entry point
├── middleware.ts                   # Edge auth check
├── next.config.js
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── docs/
    ├── context.md
    ├── functional-specification.md
    └── technical-specification.md  ← this file
```

---

## 3. Runtime Architecture

### 3.1 Process model (production)
Single Node.js process managed by PM2. Inside:

```
┌────────────────────────────────────────────────────────────────┐
│  Next.js server (PM2: dineshtrade)                             │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  HTTP handlers (App Router)                              │  │
│  │   /login   /dashboard   /watchlist   /engine            │  │
│  │   /holdings   /positions   /trades   /settings           │  │
│  │   /api/*                                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  node-cron (registered in instrumentation.ts)            │  │
│  │   tick     */5 9-15 * * 1-5  (Asia/Kolkata)             │  │
│  │   retro    35 15    * * 1-5                              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  In-memory caches                                         │  │
│  │   - market briefing (5 min TTL)                          │  │
│  │   - market mode (per-tick)                                │  │
│  │   - idempotency ledger (resets at midnight IST)          │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                              │
                              │  reads/writes
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  ~/dineshtrade/data/                                            │
│   state.json              — runtime state (tokens, mode,        │
│                             idempotency ledger, buyHistory,     │
│                             panicSkipList)                      │
│   strategy.json           — runtime strategy config overlay     │
│   watchlist.json          — runtime named-list overlay          │
│   positions.json          — unified open positions (strategyId) │
│   daily-closes.json       — rolling 60-day close cache          │
│   journal-2026-05.jsonl   — trade / signal_skipped /            │
│                             strategy_scan / order records       │
│   strategy1.json.migrated, strategy2_positions.json.migrated    │
│                           — legacy stores (post-migration)      │
└────────────────────────────────────────────────────────────────┘

                              │
                              │  HTTPS
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  External services                                              │
│   - Kite Connect API (api.kite.trade)                          │
│   - Gmail SMTP (smtp.gmail.com:587)                            │
│   - AI provider (Anthropic / Gemini / Groq / OpenAI)           │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 Request lifecycle (page request)
1. Browser → CloudFront / direct
2. **Edge middleware** (`middleware.ts`) checks `dt_session` JWT. Public paths (`/login`, `/api/auth`, OAuth callbacks) bypass.
3. App Router resolves to a Server Component → renders HTML
4. Client Component hydrates → fires `/api/*` for live data (positions, quotes, etc.)
5. API routes verify session via `verifySession()` server-side (defence in depth — don't rely on middleware alone)

### 3.3 Cron tick lifecycle
1. node-cron fires at `*/5` minute
2. `tick()` reads fresh state from disk (no cache — cron must pick up Manual → Auto toggles instantly)
3. If `state.mode !== 'auto'` or market closed: short-circuit
4. **Strategy 2 monitor** runs for all connected accounts (parallel `Promise.all`)
5. **Strategy 1 monitor** runs for all connected accounts (parallel)
6. **BUY scan** runs once per day in dip mode, every tick in catalyst mode
7. Each placed order writes to journal + fires email

---

## 4. Data Model

### 4.1 Persistent files

#### `data/state.json`
```jsonc
{
  "mode": "auto",
  "selectedAccounts": ["DINESH", "SONIA"],
  "kiteTokens": {
    "DINESH": { "apiKey": "...", "accessToken": "...", "capturedAt": "2026-05-19T03:35:00.000Z" },
    "SONIA":  { "apiKey": "...", "accessToken": "...", "capturedAt": "2026-05-19T03:35:00.000Z" }
  },
  "lastBriefingDate": "2026-05-19"
}
```

#### `data/strategy1.json`
```jsonc
[
  {
    "account": "DINESH",
    "symbol": "BAJFINANCE",
    "qty": 3,
    "entryPrice": 6850.25,
    "entryDate": "2026-05-15",
    "tranche1Done": false
  }
]
```

#### `data/journal-YYYY-MM.jsonl`
One JSON object per line. Three record shapes:

- `type: 'trade'` — closed BUY+SELL pair with verdict + day high/low + left-on-table
- `type: 'signal_skipped'` — preflight-rejected auto BUY with gate + reason
- `type: 'strategy_scan'` — every strategy scan tick: `{ strategyId, recs, executed, symbols?, skipReason? }`. Powers per-strategy health analytics in the daily retrospective (e.g. "this strategy hasn't produced a signal in 15 days").

See Epic 7 in the functional spec for full field definitions.

#### `data/watchlist.json`

Runtime override for the seed at `config/watchlist.json`. Shape:

```jsonc
{
  "generated": "2026-05-20",
  "meta": {
    "listA": { "name": "Top Volume" },
    "listB": { "name": "Penny Stocks" },
    "list3": { "name": "Dip Candidates" }
  },
  "lists": {
    "listA": [ { "nse": "BAJFINANCE", "name": "Bajaj Finance" }, … ],
    "listB": [ … ],
    "list3": [ … ]
  }
}
```

Keys (`listA`, `listB`, `list3` …) are **stable** — strategies reference them via `strategy.watchlist: string[]` and they never change on rename. Display names live in `meta[key].name` and are freely editable. `listA` and `listB` are always present (Manage Lists UX guarantees them); custom lists may be created and deleted.

### 4.2 In-memory (process-scoped)
- **Idempotency ledger** — `Map<string, true>` keyed by `${account}:${date}:${symbol}`, BUY only. Resets when `${date}` changes.
- **Market briefing cache** — single object, 5 min TTL.
- **Day stats** — counts for the EOD summary (deprecated by retrospective but still updated for telemetry).

### 4.3 Config (static, version-controlled)
- `config/watchlist.json` — List A + List B with NSE symbols. Edit + redeploy.
- `config/strategy.json` — All thresholds. Edit + redeploy.
- `config/accounts.json` — Display metadata. Edit + redeploy.
- `config/holidays.json` — NSE holiday calendar. Edit + redeploy.

---

## 5. Key Module Contracts

### 5.1 `lib/preflight.ts`
```ts
runPreflight(input: PreflightInput): Promise<PreflightResult>

interface PreflightInput {
  account: string
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  pricePerShare: number
  manual?: boolean          // true → bypass rate-limit gates
  isAutoSell?: boolean      // true → also apply no-loss-sell rider
}

type PreflightResult =
  | { ok: true; adjustedQty?: number }  // adjustedQty present iff clamp happened
  | { ok: false; gate: string; reason: string }
```

Gate order is fixed and short-circuits on first failure. The full chain (see Epic 5 in functional spec for semantics):

1. `token` · 2. `market` · **2b. `intradayCircuit`** *(auto-BUY only)* · 3. `perTrade` *(auto-BUY only)* · 4. `idempotency` *(auto-BUY only)* · **4b. `panicSell`** *(auto-BUY only)* · **4c. `pyramid`** *(auto-BUY only)* · 5. `quota` *(auto)* · 6. `positions` *(BUY)* · 7. `funds` *(BUY)* · 8. `noShort` *(SELL — clamps to held qty; auto SELLs also no-loss-sell)*.

Three gates added 20–21 May 2026:

- `intradayCircuit` — live NIFTY 50 hysteresis trip/resume from `lib/intradayCircuit.ts` (see §5.6)
- `panicSell` — per-symbol drop-from-peak detector from `lib/panicSell.ts` (see §5.7), backed by `state.panicSkipList`
- `pyramid` — per-symbol BUY-stack cap + min-drop-between-BUYs check, backed by `state.buyHistory`

### 5.2 `lib/kite.ts`
Centralised wrappers — every caller goes through these. Never make raw HTTP calls to Kite from anywhere else.
- `resolveAccountCreds(account)` — looks up token in state + env-secret in process.env
- `getPositions(creds)` — `{ net, day }`
- `getOrders(creds)` — today's order book
- `getQuotes(creds, symbols[])` — batched LTPs
- `getHistoricalCandles(creds, instrumentToken, from, to, interval)`
- `placeKiteOrder(creds, { symbol, side, quantity, tag, product?, orderType?, limitPrice? })`

### 5.3 `lib/journal.ts`
- `appendJournal(record)` — atomic JSONL append, creates dir + file on first write
- `journalOrder({ account, symbol, side, qty, price, tag?, orderId? })` — derives `strategyId` from tag, writes `order` record. Called from every Kite-order success path.
- `readJournalDay(ymd)` / `readJournalMonth(ym)` / `readJournalRange(start, end)`
- `listJournalDates()` — returns the UNION of (trading-day calendar, last 60 days) + (every dated journal record). Today appears even with zero journal records.
- `classifyVerdict(opts)` — produces `correct_exit | early_exit | delivery | manual`
- Record types: `trade`, `signal_skipped`, `strategy_scan`, `order`

### 5.4 `lib/retrospective.ts`

- `buildDailyReport(date?)` → `DailyReport` (Kite-OHLC-enriched). Activity Today reads from journal `order` records when `date !== today`; Kite `/orders` only for today.
- `buildMonthlyReport(date?)` → `MonthlyReportData`
- `isLastWeekdayOfMonth(ymd)` — used by cron to decide monthly fire
- `buildLiveSnapshot(date)` / `buildStrategyHealth(rollingAll, today)` — internal helpers used by `buildDailyReport`

### 5.5 `lib/backtest.ts` *(new 23 May 2026)*

- `runStrategy1Backtest({ days?, initialCapital?, strategyId? })` → `StrategyBacktestResult`
- `runStrategyBacktest({ days?, initialCapital?, strategyId? })` → dispatches by strategy type (`dip` or `momentum`)
- Reuses live strategy inputs: watchlist universe, `strategy.json` dip params, `capital.perTrade`, `maxPositions`, `maxBuysPerSymbol`, and `minDropBetweenBuysPct`
- Uses daily historical candles only; evaluates signals from day-close vs previous day's EMA, enters at the next trading day's open, and exits at the strategy's saved `t1Pct` / `t2Pct` from entry price (matching the live Strategy 1 monitor)
- Momentum replay uses 5-minute candles: scans between `scanStartHHMM` and `scanEndHHMM`, checks day-gain / EMA proximity / prorated volume / rising-candle conditions, exits on 5-minute closes at T1 / T2, and hands off aged positions to accumulator-style targets.
- Returns summary metrics, per-trade outcomes, and an equity curve for the selected lookback window
- Backtest output now includes estimated Zerodha-style equity charges. Same-day trades are classified as `intraday`; multi-day trades are classified as `delivery`. Open positions use the last mark price to estimate remaining exit-side charges for net MTM.
- HTTP surface: `POST /api/strategy/backtest` (authenticated)
- Current frontend surface: Settings → Backtest tab. It fetches saved strategies from `GET /api/strategies`, lets the user pick a strategy + day window, renders summary/trades/equity inline for both dip and momentum strategies, and persists every completed run into server-side Backtest History. The summary hero uses net-after-charges values, the trade table includes a per-row `Charges` column plus net profit display, and the history area is split into a run tab plus a Backtest History tab. The history overview and AI analysis use realized profit / return for comparisons, while unrealized MTM remains a separate exposure metric for open positions.

### 5.6 `lib/tradeReport.ts` *(new 23 May 2026)*

- `buildLiveTradeReport({ fromDate, toDate })` → `StrategyBacktestResult`
- Source of truth is journaled `type: 'order'` records, not Kite's session-scoped `/orders` endpoint.
- Replay model:
  - reads order legs up to `toDate`
  - reconstructs BUY rows plus tranche / final SELL activity per symbol and account
  - carries pre-range open positions forward so exits inside the selected window stay linked correctly
  - filters the final report to rows with actual activity inside the selected range
  - uses daily historical candles to mark open positions and build a daily equity curve
- HTTP surface: `POST /api/trade-report` (authenticated)
- Current frontend surface: top-level `/trade-report` page with From / To date pickers and the same summary / trades / equity layout as Settings → Backtest.

### 5.6 `lib/positions.ts` *(new 21 May 2026)*

Unified position store. Replaces `strategy1.json` + `strategy2_positions.json` with a single file keyed by `(account, symbol)`. Each row carries `strategyId` — that's what makes per-strategy exit profiles work.

```ts
interface Position {
  strategyId: string             // e.g. 'accumulator', 'catalyst', 'quickwin'
  account: string                // uppercase
  symbol: string                 // uppercase
  firstBuyPrice: number          // anchor for T1/T2
  firstBuyAt: string             // ISO; anchors handoff clock for momentum
  totalQty: number               // cumulative across pyramid BUYs
  remainingQty: number
  tranche1At?: string | null
  tranche1SoldQty?: number
}

recordBuy(strategyId, account, symbol, qty, price): Promise<void>   // pyramid-aware
ensureTracked(strategyId, account, symbol, qty, price): Promise<boolean>
markTranche1Sold(account, symbol, soldQty): Promise<void>
removePosition(account, symbol): Promise<void>
getPosition(account, symbol): Promise<Position | null>
listPositions(opts?: { account?, strategyId? }): Promise<Position[]>
setStrategyId(account, symbol, newStrategyId): Promise<boolean>     // single-row re-stamp
migrateStrategyId(fromId, toId): Promise<number>                    // bulk re-stamp (deactivate/delete)
ageInCalendarDays(firstBuyAt): number
```

**One-shot migration on first load:** if `positions.json` doesn't exist, the loader reads legacy `strategy1.json` (stamps `strategyId: 'accumulator'`) + `strategy2_positions.json` (stamps `strategyId: 'catalyst'`), writes the unified file, and renames the legacy files to `.migrated`. Recovery path is mechanical (delete `positions.json` and restore the `.migrated` files).

### 5.6 `lib/intradayCircuit.ts` *(new 20 May 2026)*

Hysteresis-based circuit on the live NIFTY 50 spot. Module-level state machine; 30 s quote cache to absorb burst preflight calls without burning Kite API.

```ts
checkIntradayCircuit(): Promise<IntradayCircuitResult>

interface IntradayCircuitResult {
  enabled: boolean      // false when either threshold is 0
  tripped: boolean
  dropPct: number | null
  tripPct: number
  resumePct: number
  reason?: string
}
```

Disabled when `capital.intradayCircuitTripPct === 0` or `intradayCircuitResumePct === 0`. State resets on new IST day. Holds last-known state on quote-fetch failure (fail-safe held).

### 5.7 `lib/panicSell.ts` *(new 20 May 2026)*

Per-symbol drop-from-peak detector. Reads from the existing 5-min candle stream (`getHistoricalCandles` with `5minute` interval). One retry with 500 ms backoff. Logs warnings on persistent failure.

```ts
checkPanicSell(creds, symbol, ltp): Promise<PanicCheckResult>

interface PanicCheckResult {
  panic: boolean
  reason?: string
  dropPct?: number
  windowHigh?: number
  ltp?: number
}
```

Disabled when `capital.panicDropPct === 0` or `panicWindowMin === 0`. Tripped symbols persist in `state.panicSkipList[YYYY-MM-DD]`; on cache hit returns `panic: true` without re-fetching candles.

### 5.8 `lib/dailyCloses.ts` *(new 20 May 2026)*

Replaces the morning per-symbol 60-day historical re-fetch with an incremental "fetch yesterday's bar only" path. Same Kite call count (Kite's historical endpoint is per-instrument), but each call returns ~1 day of data instead of ~60 — much smaller payloads, much less rate-limit pressure.

```ts
loadAndRefreshCloses(creds, symbols): Promise<Record<string, DailyClose[]>>
readCachedCloses(): Promise<Record<string, DailyClose[]>>
```

Persistent at `~/dineshtrade/data/daily-closes.json` (atomic write, mode 0o600). Trims each symbol's array to the last 60 entries. Cold-start fetches 90 days, incremental fetches `nextDay(lastCachedDate) → yesterday`. Concurrency capped at 2 with single retry.

### 5.5 `lib/watchlistStore.ts`

```ts
interface Watchlist {
  meta: Record<string, { name: string }>     // display names — user-editable
  lists: Record<string, WatchlistEntry[]>    // keys are stable: listA, listB, list3, list4, …
  generated?: string
  rules?: Record<string, unknown>
}

getWatchlist(): Promise<Watchlist>          // reads runtime override or bundled seed
saveWatchlist(next: Watchlist): Promise<void>
nextListKey(existing): string                // returns the next free list key
isListKey(k: string): boolean                // matches /^list[A-Za-z0-9]+$/
```

`normalize()` accepts both the new `{ meta, lists }` shape and the legacy top-level-keys shape (`{ listA: [...], listB: [...] }`), so existing EC2 data needs no migration script. Strategies always read by stable key: `wl.lists[k]` where `k` is from `strategy.watchlist: string[]`.

### 5.6 `lib/email.ts`
Discriminated union dispatcher:
```ts
sendEmail('trade_executed', data: TradeExecutedData)
sendEmail('trade_failed',   data: TradeFailedData)
sendEmail('daily_report',   data: DailyReport)
sendEmail('monthly_report', data: MonthlyReportData)
sendEmail('test')
```
All return `Promise<EmailResult>`. Never throws — fire-and-forget safe.

---

## 6. Security

### 6.1 Authentication
- **App login:** `ddmmyyyyhh` IST password, hourly rotation, hashed comparison
- **Session:** JWT signed with `SESSION_SECRET` (32+ char random), HttpOnly cookie, expires at midnight IST
- **Edge middleware:** validates session on every non-public route
- **API routes:** re-verify session server-side (defence in depth)

### 6.2 Secrets
- Stored only in `.env.local` (gitignored)
- File permissions on `.env.local`: `0o600`
- Per-account Kite secrets use `${ZERODHA_ENVIRONMENT}_ZERODHA_API_KEY_${name}` naming
- `SMTP_PASS` is a Google App Password (revocable per-app), not the user's main password

### 6.3 File permissions
- `data/state.json`, `data/strategy1.json`, `data/journal-*.jsonl` — all `0o600`
- Set explicitly on every write (`fs.appendFile/writeFile` with `mode: 0o600`)

### 6.4 Kite session security
- Access token never logged
- OAuth callback validates the `request_token` against Kite's `/session/token` server-side, never trusts client input
- Per-account isolation: a compromised token for account A can't trade account B

### 6.5 Input validation
- Order placement schema-validated server-side regardless of UI
- Journal date path parameter validated against `^\d{4}-\d{2}-\d{2}$`
- Symbol uppercased + matched against `config/watchlist.json` for auto orders (manual is user-supplied, no whitelist)

---

## 7. Infrastructure

### 7.1 Topology
```
                    DNS: dineshtrade.online
                          (A record)
                              │
                              ▼
                   Elastic IP: 3.111.255.172
                              │
                              ▼
                  AWS EC2 (ap-south-1, Mumbai)
                  ─────────────────────────────
                   t3.small Ubuntu 22.04 LTS
                   Caddy / Nginx (TLS termination)
                          │
                          ▼
                   localhost:3000 (Node + PM2)
                          │
                          ▼
                  ~/dineshtrade/  (app dir)
                  ~/dineshtrade/data/  (state + journal — never wiped)
```

### 7.2 Why EC2 over Vercel (decided mid-Phase 2)
- **Filesystem persistence:** state + journal need disk. Vercel functions are ephemeral.
- **Long-lived cron:** node-cron must run in a persistent process. Vercel Cron triggers HTTP endpoints, but each invocation is a cold container — incompatible with in-memory caches (idempotency ledger, briefing cache).
- **Cost predictability:** small EC2 is ₹500–800/month flat. Vercel functions + cron at this trade frequency would be cheaper *only* until something breaks.

### 7.3 DNS & TLS
- Domain registered separately (e.g. via Namecheap)
- A record: `dineshtrade.online` → `3.111.255.172`
- TLS via Caddy automatic Let's Encrypt or Nginx + certbot

### 7.4 EC2 baseline
- Region: `ap-south-1` (Mumbai) — minimises Kite API latency
- Instance: `t3.small` (2 vCPU, 2 GB) is comfortable; `t3.micro` works but tight
- Storage: 20 GB gp3 — plenty for app + months of journal
- Security group: 80, 443, 22 only. SSH from a fixed IP if possible

---

## 8. Configuration & Environment Variables

### 8.1 Required
```bash
# Auth
SESSION_SECRET=                        # 32+ random chars

# State backend (EC2 only — local dev MUST leave this unset to use cookie state)
# WARNING: if .env.local carries STATE_FILE_PATH from a copy-paste of EC2 config,
# Kite OAuth callback will crash on local with `ENOENT: mkdir '/home/ubuntu'`
# because lib/state.ts:saveState() tries to mkdir the EC2 path on macOS.
STATE_FILE_PATH=/home/ubuntu/dineshtrade/data/state.json

# Cron
CRON_ENABLED=true                      # false / unset in dev

# Zerodha (multi-account)
ZERODHA_ENVIRONMENT=PROD               # or TEST
ZERODHA_ACCOUNT1=DINESH
ZERODHA_ACCOUNT2=SONIA
PROD_ZERODHA_API_KEY_DINESH=
PROD_ZERODHA_API_SECRET_DINESH=
PROD_ZERODHA_API_KEY_SONIA=
PROD_ZERODHA_API_SECRET_SONIA=

# AI provider — set one
AI_PROVIDER=GEMINI                     # ANTHROPIC | GEMINI | GROQ | OPENAI
AI_GEMINI_API_KEY=
# (or AI_ANTHROPIC_API_KEY, AI_GROQ_API_KEY, AI_OPENAI_API_KEY)
AI_MODEL=gemini-2.5-flash              # provider-specific model id

# Email
SMTP_USER=dinesh.k.wadhwani@gmail.com
SMTP_PASS=                             # 16-char Google App Password
NOTIFY_TO=dinesh.k.wadhwani@gmail.com  # optional, defaults to SMTP_USER
```

### 8.2 Optional
```bash
SMTP_HOST=smtp.gmail.com               # default
SMTP_PORT=587                          # default
USE_MOCK_MARKET=true                   # local dev only — skips Kite, returns fixtures
ZERODHA_REDIRECT_URL=                  # override Kite OAuth callback (defaults to https://dineshtrade.online/api/zerodha/callback)
```

---

## 9. Build & Deploy

### 9.1 Local development
```bash
git clone <repo> dineshtrade
cd dineshtrade
npm install
cp .env.example .env.local             # then fill in
# Local dev uses cookie state — leave STATE_FILE_PATH unset
# Leave CRON_ENABLED unset to skip background jobs
npm run dev                            # http://localhost:3000
```

Login with the current IST `ddmmyyyyhh`. Set `USE_MOCK_MARKET=true` to skip Kite during pure-UI work.

### 9.2 Production build
```bash
npm install                            # do NOT skip even if package-lock is fresh
npm run build                          # ~30s
```
`npm run build` runs the Next.js production compile + type-check + lint. Type errors fail the build.

### 9.3 EC2 first-time deploy
```bash
# As ubuntu user on the EC2 box

# 1. Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. PM2 global
sudo npm install -g pm2

# 3. App
git clone <repo> ~/dineshtrade
cd ~/dineshtrade
mkdir -p ~/dineshtrade/data            # CRITICAL — never delete this dir
chmod 700 ~/dineshtrade/data
npm install
cp .env.example .env.local
nano .env.local                        # fill in all required vars
chmod 600 .env.local
npm run build

# 4. Start under PM2
pm2 start npm --name dineshtrade -- start
pm2 save
pm2 startup                            # follow the printed command to enable on-boot

# 5. Reverse proxy (Caddy example — auto-TLS)
sudo apt-get install -y caddy
sudo tee /etc/caddy/Caddyfile <<EOF
dineshtrade.online {
    reverse_proxy localhost:3000
}
EOF
sudo systemctl restart caddy
```

### 9.4 Subsequent deploys
```bash
cd ~/dineshtrade
git pull
npm install                            # only re-runs if package-lock changed
npm run build
pm2 reload dineshtrade                 # graceful restart
```

**Critical:** `~/dineshtrade/data/` must NOT be touched by any deploy step. If you ever script a deploy, hard-code an exclusion.

### 9.5 Health check
- `pm2 list` → `dineshtrade` should show `online`
- `pm2 logs dineshtrade` → look for `[cron] starting — tick every 5 min during 9:15–15:30 IST`
- `curl https://dineshtrade.online/login` → 200
- `ls -la ~/dineshtrade/data/` → state.json + journal-* present with mode `-rw-------`

---

## 10. Observability

### 10.1 Logs
- All app + cron logs go to PM2's log files (`~/.pm2/logs/dineshtrade-out.log` + `-error.log`)
- Convention: prefixed by subsystem — `[cron tick]`, `[strategy1]`, `[strategy2]`, `[preflight]`, `[journal]`, `[email]`
- `pm2 logs dineshtrade --lines 200` for tail

### 10.2 What to watch
- **Cron tick visibility log:** `[cron tick] HH:MM IST — scan #N · mode=auto · accounts=DINESH,SONIA`
- **Strategy 2 monitor:** `[strategy2 monitor] DINESH: tracking 2 dt-s2 BUY(s) — BAJFINANCE, RELIANCE`
- **Preflight rejection:** `[preflight] gate=funds reason=Available cash ₹1,200 < trade value ₹2,400`
- **Journal write:** silent on success; `[strategy2] journal write failed:` on error

### 10.3 No metrics platform yet
Single-user, single-process. PM2 logs + email reports are enough at current scale. Add Prometheus / Grafana when multi-user or when on-call rotation begins.

---

## 11. Failure Modes & Recovery

| Scenario | Detection | Recovery |
|---|---|---|
| Kite token expired mid-day | Preflight `gate=token` on next order | User re-logs in via Settings → Login with Kite |
| Kite API down | Cron tick logs `[strategy2 monitor] failed:` | Auto retries next tick (5 min); no manual intervention |
| Email send fails | `[email] send failed: ...` in PM2 logs | Trades still complete; user checks Kite Console directly |
| PM2 process crashes | `pm2 list` shows stopped/errored | PM2 restarts automatically (default unlimited restart); check logs |
| EC2 box rebooted | App restarts via PM2 on-boot hook | State + journal restored from disk; user re-connects Kite tokens once |
| Disk fills up | Journal append fails | Rotate / archive old journal months; tiny files (< 1 MB / month at current volume) |
| Stale state.json on bad shutdown | Tokens missing on restart | User re-logs in via Settings; strategy1.json + journal unaffected (append-only) |

### 11.1 Backup recommendation
- **Daily:** `tar -czf /backup/dineshtrade-data-$(date +%F).tar.gz ~/dineshtrade/data/`
- Retain 30 days. Lightweight (< 50 MB even after a year).
- Critical files: `state.json`, `strategy1.json`, all `journal-*.jsonl`

---

## 12. Performance Targets (current)

| Metric | Current | Headroom |
|---|---|---|
| Cron tick wall time | < 2 s per account | 5 min budget — 150× over |
| BUY scan wall time | 3–8 s (depends on AI provider) | First-of-day only |
| `/api/positions` p95 | < 1.5 s | Two parallel Kite calls + join |
| Daily report build | 1–3 s | Once per day |
| EC2 RAM | ~250 MB resident | t3.small has 2 GB |

No load testing because there's one user. If usage profile changes (e.g. open to other family members), revisit.

---

## 13. Architectural Decisions Worth Re-Examining

These were the right call **for now**. They will start to creak as scope grows:

| Decision | Trigger to revisit |
|---|---|
| File-backed state, no DB | Multi-writer (more than one user can modify state simultaneously) |
| In-process node-cron | Multi-server (any HA story) |
| JSONL journal | Need to query across months frequently, or need joins |
| No telemetry pipeline | First on-call rotation, or paying customer |
| Single-user auth | Adding any other user |
| Manual deploy (git pull + pm2 reload) | More than 1 deploy / week becomes friction |
| Edit-config-redeploy for watchlist / thresholds | User wants to A/B thresholds without a deploy |

---

## 14. Open Technical Debt

- `lib/cron.ts` still tracks `dayStats.executed / failed / skipped / delivery` for the old EOD text email path. The new daily retrospective doesn't need these; can be removed once we're sure no legacy email path is referenced.
- `EODSummaryData` + `eodSubject` / `eodBody` are dead code from before retrospective. Removable once verified.
- TS target is es5 with `--downlevelIteration` implicit — would benefit from bumping `tsconfig.json` target to es2017+ to clean up `Array.from(set)` workarounds.
- No CI: every push is built manually. Adding GitHub Actions for `npm run build` + `tsc --noEmit` on PR is a 10-line workflow.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **S1 / Strategy 1 / Oscillator** | Mean-reversion strategy on EMA-deviated stocks |
| **S2 / Strategy 2 / Catalyst** | Intraday momentum strategy |
| **T1 / T2** | Intraday profit targets (+1.5% / +2.0%) |
| **OOS** | Out Of System — a holding the app didn't initiate, so it's never auto-managed |
| **Tranche 1 / Tranche 2** | The two halves of a Strategy 1 exit (50% at EMA recovery, 50% at EMA+3%) |
| **Catalyst day** | GIFT Nifty positive/flat — Strategy 2 mode |
| **Dip day** | GIFT Nifty < −0.5% — Strategy 1 mode |
| **Circuit day** | GIFT Nifty < −5% — no trades |
| **CNC / MIS** | Kite product types: Cash & Carry (delivery) / Margin Intraday Squareoff |
| **Preflight gate** | One of 8 rules every order is checked against before sending to Kite |
| **Idempotency ledger** | In-memory map preventing duplicate auto BUYs in a single trading day |
| **Square Off** | Manual close of an open position via the Positions page |

---

*End of technical spec. Pair with `functional-specification.md` for behavioural detail and `context.md` for project history.*
