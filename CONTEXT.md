# DineshTrade — Project Context

**Last Updated:** 09 Aug 2026
**Version:** 2.8 — capital/gate/strategy numbers below re-verified directly against live `data/strategy.json` and `lib/preflight.ts` on 09 Aug 2026; see `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/MULTI_TENANCY_CURRENT_STATE.md` for the full code-verified picture (docs/ was reorganized the same day — speculative and superseded docs moved to `docs/archive/`).
**Purpose:** This file gives Claude (or any AI assistant) full context of everything discussed so far about this project. Start any new conversation by uploading this file.

---

## 1. WHO IS DINESH

**Dinesh Wadhwani** — Founder & CEO
**Location:** Pune, Maharashtra, India
**Email:** <dinesh.k.wadhwani@gmail.com>
**This project (DineshTrade) has nothing to do with StudioVerse.**

---

## 2. TRADING BACKGROUND

Dinesh has been trading Indian equities since **FY2020** across **4 family accounts** plus managing trades for ~10 other people (friends/family).

### Family Accounts

| Name | Relation | Broker | Account No | Status |
| --- | --- | --- | --- | --- |
| Dinesh Wadhwani | Self | Zerodha | DINESH | Primary (in app) |
| Kiran Wadhwani | Wife | Motilal Oswal | 4180283 | Active |
| Sheela Wadhwani | Mother | Motilal Oswal | 4432333 | Active |
| Sonia Wadhwani | Daughter | Zerodha | CJD607 | Active |

### Verified P&L (from official broker reports)

| Account | Net Realised P&L (FY2020–2026) | Best Year ROC |
| --- | --- | --- |
| Dinesh | ₹7,28,820 | 17.5% (FY23-24) |
| Kiran | ₹27,68,752 | 20.8% (FY23-24) |
| Sheela | ₹19,35,215 | 11.1% (FY23-24) |
| Sonia | ₹4,96,373 | 2.2% (FY24-26) |
| **TOTAL** | **₹59,28,726** | **FY23-24: ₹26.56L in one year** |

- Win rate: 94–100% in peak years
- Total brokerage paid over 6 years: ₹4,89,748 (7.6% of gross profit)
- Sheela is the gold standard — 96.6% win rate, 87-day avg hold

---

## 3. TRADING PHILOSOPHY

- Never short sell; Never trade F&O
- Never sell at a loss — wait for recovery
- Buy blue chips on dips, they always come back
- LIFO approach — ensure last trade on each script is always profitable
- List A is config-locked — cannot add stocks impulsively via UI

---

## 4. STRATEGIES

### Strategy 1 — Accumulator (Mean Reversion)

- Internal id: `accumulator`. Universal parking lot — all momentum strategies hand off here.
- **Trigger:** Stock 5–8% below 20-day EMA + 3+ consecutive down days
- **Reactive scan:** Also fires every 30 min between 09:15–14:00 when any List A stock drops ≥3% intraday
- **Exit T1:** SELL 50% at EMA recovery
- **Exit T2:** SELL remaining when LTP ≥ EMA × 1.03 (EMA + 3%, no time stop)
- **Cannot be deactivated or deleted** — structural keeper

### Strategy 2 — Catalyst (Intraday Momentum)

*Live params below re-verified against `data/strategy.json` 09 Aug 2026 — several have drifted from the values documented here historically.*

- Internal id: `catalyst`
- **Signal:** Day gain +0.5–0.75%, 3+ rising 5-min candles, volume > 10-day avg, LTP within ±3% of EMA, plus a ceiling filter (must sit below a 2% buffer under the 20-day high)
- **Scan window:** 09:15–15:00 IST, every 5 min (live `scanIntervalMin`)
- **Exit T1 = +1.5%, T2 = +2.0%** per open lot, anchored to that lot's own entry price
- **Live exit monitor:** checks both current LTP and the latest completed 5-minute candle high so cron ticks do not miss valid intraday target touches; quote day-high is not used for exits
- **No-loss rider stays in force:** a touched-then-retraced exit stays blocked if the current sell price is below that lot's own entry
- **EOD behaviour:** `exitSameDayOnPositive=true`, `squareOffEOD=false` from `exitSameDayTime` (live: **15:15**) onward
- **Handoff:** after `deliveryHandoffDays` (live: **30**) → Accumulator takes over

### Strategy 3 — New Pivotal Strategy (Breakout)

- Internal id: `new_pivotal`. Type: `pivotal`
- Uses a dedicated Pivotal list store, not the generic watchlist store — currently points at list `pivotalA`, which is **active but has zero symbols configured** (both the checked-in seed and the live runtime list are empty)
- Each script carries `breakoutTriggerPrice`, `t1Pct`, `t2Pct`, `executionMode` (`normal` or `dayEnd`), optional `stopLossPrice`, and notes
- Strategy params add consolidation, volume-surge, confirmation-candle, close-time, and handoff controls
- `normal` mode buys on confirmed intraday breakout; `dayEnd` mode buys only if the breakout sustains into the configured close window
- Exits respect script stop-loss, then T1/T2, then hand off to `accumulator` after 15 calendar days

### Market Boom (`market_boom`, momentum type — active in live config)

*Corrected 09 Aug 2026 — live values differ from what was documented here previously.*

- Live: `squareOffEOD=false`, `exitSameDayOnPositive=true`, `deliveryHandoffDays=30`
- Same EOD mechanism as Catalyst (sell only if net-of-charges P&L is still positive, re-checked every 5-min tick from `exitSameDayTime`=15:10 onward) — does **not** force-close at EOD regardless of P&L
- Entry is tighter/earlier than Catalyst: day gain 0.25–0.5%, scans every 3 min, 09:15–15:15 window

### Market Mode

| GIFT Nifty | Mode | Action |
| --- | --- | --- |
| Positive/flat | Catalyst | Strategy 2 |
| Gap-down < −0.5% | Dip | Strategy 1 |
| −5% or worse | Circuit | No trades |

---

## 5. HARD STOP RULES

*(Live values from `data/strategy.json`'s `capital` block — this is the shared config every account trades under, re-verified 09 Aug 2026. It has drifted from the checked-in `config/strategy.json` seed; see `docs/DATA_MODEL.md` for the diff.)*

- Total corpus / funded base: ₹1,00,002 (Dinesh account `reconciliationBase`, from `config/accounts.json`)
- Max per trade: ₹20,000 (`capital.perTrade`)
- Max open positions: 35 (`capital.maxPositions`)
- Max buys per day: 6, max sells per day: 20 (`capital.maxBuysPerDay` / `maxSellsPerDay`)
- Max deployable: 100% of total capital (`capital.maxDeployPct`)
- No short selling; No F&O; Delivery only (CNC), NSE
- Cash check before every order
- Circuit breaker: GIFT Nifty −5%+ pre-market → stop all trades (`circuitBreakerPct`); live intraday NIFTY circuit also enabled at −3% trip / −2% resume (`intradayCircuitTripPct`/`intradayCircuitResumePct`)
- Panic-sell gate also enabled: 10% drop-from-peak within a 10-min window (`panicDropPct`/`panicWindowMin`)

---

## 6. APPLICATION — CURRENT STATE (07 Jun 2026)

### Deployed at

- **Production:** `https://dineshtrade.online` (EC2 ap-south-1, Elastic IP 3.111.255.172)
- **Process:** PM2 `dineshtrade`, Node 20 LTS, Caddy reverse proxy

### Tech Stack

- Framework: Next.js 14 (App Router), TypeScript
- Styling: Tailwind CSS + custom CSS class system (`dt-*` classes)
- Theme: Obsidian Gold dark (default, high contrast) + Light mode toggle
- Fonts: Cormorant Garamond (serif), Outfit (body), JetBrains Mono (numbers)
- Deployment: AWS EC2 ap-south-1 (Mumbai), PM2 + Caddy

### Pages

| Page | Path | Purpose |
| --- | --- | --- |
| Login | `/login` | Time-based password auth |
| Dashboard | `/dashboard` | Morning briefing, global indices, GIFT Nifty |
| Watchlist | `/watchlist` | Read-only dynamic tabs per list, live LTP colour coding |
| Manage Lists | `/manage-lists` | Create/rename/delete watchlists |
| Pivotal Lists | `/pivotal-lists` | Create/rename/delete Pivotal script lists and edit trigger/target/SL fields |
| Trading Engine | `/engine` | Recommendations, scan tiles, Execute, pending orders |
| Current Holdings | `/holdings` | Holdings + T0 positions merged, Buy/Sell (B/S) buttons |
| Today's Positions | `/positions` | Broker-style open positions for today, live P&L, Square Off |
| Today's Orders | `/trades` | Order log + Retrospective tab |
| Trade Report | `/trade-report` | Date-range P&L from journal |
| Settings | `/settings` | Accounts, accordion-based strategies editor, backtest, Reset |

### Authentication

- Password: `ddmmyyyyhh` in IST — changes every hour
- Session: JWT cookie, expires midnight IST

---

## 7. KEY FEATURES BUILT (as of 11 Jun 2026)

### Cron Architecture

- **Core 5-min tick** (`*/5 9-15 * * 1-5`): SELL monitors (S1 + S2 + Pivotal), EOD square-off, manual-sell reconciliation, reactive dip scan
- **Per-strategy BUY scan tasks**: each active strategy gets its own cron at `scanIntervalMin` — independent of the 5-min tick
- **15:35 IST**: daily retrospective email
- **Settings → Strategies UI**: fixed rules moved out of General into the Strategies tab as a read-only accordion; Shared Capital is now its own accordion; each strategy remains its own collapsible card; top-level `Export to CSV` downloads the current draft as `Strategy name, Parameter, Parameter description, Value`

### EOD Square-Off (added 28 May 2026)

- Momentum strategy params: `exitSameDayTime` (default "15:10"), `exitSameDayOnPositive`, `squareOffEOD`
- Visible and editable in Settings → Strategies → "End of Day Behaviour" section
- `squareOffEOD=true` bypasses the no-loss sell gate (via `bypassNoLossSell` in preflight)
- `exitSameDayOnPositive=true` now sells only when the estimated net P&L remains positive after Zerodha-style charges, and re-checks on every later 5-minute tick until exit or market close
- Configurable per-strategy, not global

### Position Tracking — Holdings Bug Fix (28 May 2026)

- CNC positions carried forward overnight were dropping to OOS because Kite moves them from `/portfolio/positions` to `/portfolio/holdings`
- Fix: `strategy2.ts` now includes holdings in `liveQtyBySymbol`
- Journal-based Seed 2 reseeding: on each monitor tick, reads last 30 days of journal BUY records and reseeds any momentum positions that fell out of the store but are still held in Kite

### Manual Sell Reconciliation (updated 01 Jun 2026)

- `reconcileManualSells()` runs every 5-min tick + at 15:35 EOD
- Detects positions closed manually in Kite (Kite qty = 0 but position still in store)
- Today's sell: journals at actual fill price from Kite order book
- Prior-day sell: journals synthetic SELL at current LTP (or entry price if market closed)
- After journaling, the closed open-position row is removed from the positions store so stale anchors do not leak into a later re-buy of the same symbol
- SELL journal entry is written with `strategyId` = the buying strategy (from positions store) + `source: 'manual'` — ensures trade reports attribute P&L to the correct strategy

### Momentum Re-Buy Anchor Fix (03–07 Jun 2026)

- Root cause found from a BAJFINANCE Catalyst miss: a manually closed momentum position could leave an old `firstBuyPrice` in `positions.json`
- A later re-buy of the same symbol was then treated as a pyramid add, so Catalyst exits used the stale anchor instead of the fresh entry
- Fix: manual-sell reconciliation now removes the closed tracked row after journaling, and EOD positive exits compare against net-after-charges profitability
- Follow-up hardening: Catalyst target-touch exits now use only live LTP plus the latest completed 5-minute candle high for the same lot window, and retracement exits no longer bypass no-loss when the current sell price is below that lot's entry

### UI + Execution Refinements (10–11 Jun 2026)

- Watchlist is now strictly read-only. It remains a monitoring and list-management surface; it never originates Buy or Sell orders.
- Today's Positions is now intentionally broker-simple: only still-open day positions are shown, with live LTP/P&L and Square Off. Lot/tranche detail stays internal.
- Engine-page BUY actions continue to preserve the owning strategy via `dt-${strategy.id}` tags, while generic manual BUYs are absorbed into `accumulator` ownership.

### T+1 Settlement Fix (01 Jun 2026)

- `KiteHolding` now includes a `t1_quantity` field
- `buildLiveQtyBySymbol()` in `lib/kite.ts` computes live quantity as `quantity + t1_quantity`
- Prevents day-1 CNC positions from appearing OOS: on T+0 they appear in `/portfolio/positions`; on T+1 they move to `/portfolio/holdings` with `t1_quantity > 0` before settling to `quantity` on T+2
- Without this fix, T+1 positions showed as OOS because `t1_quantity` was not included in the live qty calculation

### Journal Attribution Fix (01 Jun 2026)

- `reconcileManualSells()` now journals SELL entries with the buying `strategyId` + `source: 'manual'`
- Settings → Journal Maintenance → **"Fix Journal Attribution"** button calls `POST /api/journal/fix-attribution`
- Retroactively patches old `dt-manual` SELL entries that are missing `strategyId` — looks up each entry's symbol in the positions store and backfills the correct strategy tag

### Holdings Avg Fix (01 Jun 2026)

- T0 rows with `qty = 0` (sold today) now display `average_price` sourced from `holdingAvgBySymbol` — the buy cost from the Kite holdings endpoint
- Previously showed Kite's `position.average_price` which is the sell execution price (confusing and incorrect for P&L display)
- `holdingAvgBySymbol` is built from ALL `rawHoldings` including `quantity = 0` entries to ensure no closed position falls through

### Strategy Tagging Policy (updated 27 Jul 2026)

- `positions.json` is the primary source of strategy ownership for open symbols.
- `/api/positions` resolves row strategy in this order:
  1. tracked strategy from `positions.json` for `account:symbol`
  2. latest completed BUY order tag for the symbol (today)
  3. latest completed order tag (BUY/SELL) for the symbol (today)
  4. default to `accumulator` when tag is manual/untagged/non-`dt-`
- Tag normalization rules:
  - `dt-manual` / `manual` -> `accumulator`
  - `dt-s1` -> `accumulator`
  - `dt-s2` -> `catalyst`
- Positions UI now shows the full strategy name badge (not CNC, not MANUAL fallback labels).

### Codebase Refactor (01 Jun 2026)

- `cron.ts` split into four files to eliminate circular dependencies:
  - `cronState.ts` — module-level mutable state + record helpers (no imports from other cron files)
  - `cronBuy.ts` — auto-buy engine
  - `cronEOD.ts` — EOD square-off + retrospective emails
  - `cronReconcile.ts` — manual sell detection (zero circular deps)
  - `cron.ts` — pure orchestrator (tick, task lifecycle, start/stop/reload)
- `lib/strategyTag.ts` — new file centralising `resolvePositionTag()` used across all API routes
- `buildLiveQtyBySymbol()` extracted to `lib/kite.ts` (handles `quantity + t1_quantity`)
- `getJournalStrategyFallback()` added to `lib/journal.ts`
- `StrategyParams` typed as `DipParams | MomentumParams` union; `asDipParams()` / `asMomentumParams()` helpers enforce correct access — eliminates all `params as any` casts

### Account Reset (added 28 May 2026)

- Settings page → Danger Zone → "Reset Account Data"
- Per-account reset: wipes journal records, positions store, idempotency/buy-history cron state
- Re-seeds all current Kite holdings as Accumulator positions at Kite avg price
- Requires typing "RESET" to confirm
- Entry date = reset date (no historical dates available from Kite)

### Sync Positions Now Button (added 28 May 2026)

- Settings → Accounts & Trading → "Sync Positions Now" button
- Calls `POST /api/strategy/monitor` — same as the 5-min cron tick
- Safe to run when market is closed (preflight blocks actual SELLs; seeding still works)

### Cancel Pending Orders (added 29 May 2026)

- Engine page shows "Pending Orders" section when any order has status OPEN/TRIGGER PENDING
- × button per row calls `POST /api/orders/cancel` → Kite DELETE `/orders/regular/{orderId}`
- Section disappears when all pending orders are resolved

### Capital Bar (redesigned 29 May 2026)

- **Row 1 (Cash):** Available · Deployed · Reserve · Remaining
- **Row 2 (P&L):** Realized P&L · Unrealized MTM · Net MTM · Live Capital
- Funded Base + Ledger Adjustment moved to hover tooltip on Live Capital
- All cells use CSS variables (respond to light/dark mode)

### Light/Dark Mode (added 29 May 2026)

- **Default:** Dark, high-contrast (obsidian + gold)
- **Toggle:** Light mode (warm off-white `#f5f4f2` + near-black text)
- Toggle in nav dropdown (sun/moon emoji), persists to `localStorage`
- Implemented via:
  1. CSS custom properties (`--dt-bg`, `--dt-text-primary`, etc.) with `html.light` overrides
  2. Semantic CSS classes (`dt-card`, `dt-table-head`, `dt-banner-*`, etc.) for theme-aware components
  3. CSS attribute selectors with `!important` for inline styles: `html.light main * { color: dark !important }` + semantic color restores

### B/S Button Labels

- All Buy/Sell action buttons use "B" and "S" universally across Holdings, Positions, Engine

---

## 8. PREFLIGHT GATES (13 named checkpoints — re-verified against `lib/preflight.ts` 09 Aug 2026)

1. Token connected (all orders)
2. Market open — 9:15–15:30 IST, weekday, non-holiday (all orders)
2b. Intraday circuit — live NIFTY 50 hysteresis, currently enabled (auto BUY only)
3. Per-trade cap — auto only
4. Idempotency — one BUY/account/day/symbol (auto BUY only)
4b. Panic-sell — currently enabled, 10%/10min (auto BUY only)
4c. Pyramid — `maxBuysPerSymbol`, `minDropBetweenBuysPct` (auto BUY only)
4d. Sector concentration — `maxPerSector`, dip-type strategies only (auto BUY only)
5. Day quota — `maxBuysPerDay`/`maxSellsPerDay` (auto only)
6. Position cap — `maxPositions` (auto BUY only)
7. Funds available (all BUY)
8. No-short guard — clamps SELL qty to live held qty, rejects if held = 0 (all SELL)
9. No-loss-sell rider — auto SELLs reject if LTP < entry after modeled charges; bypassable via `bypassNoLossSell`/`bypassNoLossSellReason` (auto SELL only)

`manual: true` orders skip 3, 4, 4b, 4c, 4d, 5, 6, 9 — only token/market/funds/no-short still apply. See `docs/ARCHITECTURE.md` §5 for the full detail.

---

## 9. ENVIRONMENT VARIABLES

```bash

# Auth
SESSION_SECRET=                        # 32+ random chars

# State backend (EC2 only — LEAVE UNSET on local dev)
STATE_FILE_PATH=/home/ubuntu/dineshtrade/data/state.json

# Cron
CRON_ENABLED=true

# Zerodha (multi-account)
ZERODHA_ENVIRONMENT=PROD
ZERODHA_ACCOUNT1=DINESH
PROD_ZERODHA_API_KEY_DINESH=
PROD_ZERODHA_API_SECRET_DINESH=

# AI provider
AI_PROVIDER=GEMINI
AI_GEMINI_API_KEY=
AI_MODEL=gemini-2.5-flash

# Email
SMTP_USER=dinesh.k.wadhwani@gmail.com
SMTP_PASS=                             # 16-char Google App Password
NOTIFY_TO=dinesh.k.wadhwani@gmail.com

```

---

## 10. DATA FILES (~/dineshtrade/data/)

| File | Purpose |
| --- | --- |
| `state.json` | mode, tokens, idempotency, buy history, panic skip list |
| `strategy.json` | runtime overlay of bundled strategy config |
| `watchlist.json` | runtime named-list overlay |
| `positions.json` | unified position store (strategyId per row) |
| `daily-closes.json` | rolling 60-day close cache |
| `journal-YYYY-MM.jsonl` | append-only trade journal |
| `backtest-history.json` | saved backtest runs |

**CRITICAL:** `~/dineshtrade/data/` must NEVER be touched by any deploy step.

---

## 11. DEPLOY RUNBOOK

```bash
cd ~/dineshtrade
git pull
rm -rf .next
npm ci
NODE_OPTIONS="--max-old-space-size=2048" npm run build
pm2 restart dineshtrade --update-env

```

Type check only (no build): `npx tsc --noEmit`

---

### Phase 7 — built 29–30 May 2026

#### Strategy tag on Today's Orders

- Orders table (Today's Orders tab) now shows a coloured strategy badge inline next to the symbol name (same style as Holdings/Positions pages) — derived from the Kite order `tag` field via `tagToStrategy()` helper.

#### Holdings page — separate lots for same symbol

- When a stock is bought today on a DIFFERENT strategy than an existing settled holding (e.g. COALINDIA already in Accumulator from reset, then re-bought today on Catalyst), both rows now appear separately: the settled holding keeps its Accumulator tag, the T0 position shows its own tag.
- De-duplication only drops a holding if its avg price exactly matches the T0 position (same-day-only buy appearing in both Kite endpoints).

#### Strategy attribution consistency

- **Positions store is the single source of truth** for strategy tags across ALL pages (Holdings, Positions, Today's Orders). Reverted earlier T0 override that used Kite order tags — it created inconsistency between pages.
- Any T0 position whose strategy was merged into a different strategy by `recordBuy()` will show that merged strategy on all pages uniformly.

#### Reset bug fix — pyramid gate bypassing

- `POST /api/settings/reset` now calls `recordBuyHistory(account, symbol, avgPrice)` for each re-seeded position. This seeds the pyramid gate's buy history so the next auto-buy for that symbol requires a ≥10% price drop below the seeded avg price. Previously, empty buy history allowed buys at the same or higher price immediately after reset.

#### Quota + positions race condition fix

- **`inProcessBuyCounts`**: shared in-process counter across all per-strategy cron tasks. Prevents the race where two concurrent tasks both pass Gate 5 (day quota) before either's order shows as COMPLETE in Kite's `/orders`.
- **`inProcessNewSymbols`**: shared set of new symbols committed today. Prevents the race where two concurrent tasks both pass Gate 6 (positions cap) before either's order appears in Kite's `/portfolio/positions`. Before placing each buy, the cron checks `existingStorePositions + inProcessNewPositionCount` vs `maxPositions`. Both counters reset at midnight IST via `maybeRollDay()`.

#### Auto-mode banner — dynamic scan intervals

- Engine page auto-mode banner now reads active strategy scan intervals from the strategies config (not hardcoded "5 min"). Shows: `BUY scans: Accumulator every 30 min, Catalyst (Momentum) every 3 min. SELL monitors every 5 min.`
- Full Scan subtitle also updated from "auto-refreshes every 5 min" to "sell monitor every 5 min · buy scans per strategy interval".

#### Engine empty state — compact

- Replaced the large centered `py-20` empty state (big icon + two lines + dead space) with a single inline row: spark icon + message + Refresh & Scan button on the same line.

#### LiveTicker — extended indices + better visibility

- **Mobile** (`< sm`): NIFTY 50 + SENSEX only
- **Desktop** (`≥ sm`): NIFTY 50, SENSEX, INDIA VIX, NIFTY BANK, NIFTY AUTO, NIFTY FIN SVC, NIFTY IT, NIFTY 100, NIFTY INFRA
- Values: bold `font-weight: 700`, `font-size: 12px`
- Positive → green `#52b788`, Negative → red `#e05a5e`
- API (`/api/market/indices`) now fetches all 9 symbols from Kite in a single `/quote` call

### Phase 8 — built 22 Jun 2026

#### Momentum ceiling filter (new params + runtime behavior)

- Added Momentum params:
  - `recentHighDays` (default `20`)
  - `ceilingBufferPct` (default `2.0`)
- Config wiring:
  - schema/defaults/descriptions updated in `lib/strategyConfig.ts`
  - production snapshot updated in `config/strategy.json` for momentum strategies
- Daily bars extended to support ceiling math:
  - `DailyClose` now supports `open`, `high`, `low` (optional for backward compatibility)
  - fetch + cache now persist OHLC fields in `lib/dailyCloses.ts`
  - fallback uses `high ?? close` when high is unavailable
- Shared evaluator added in `lib/strategyEngine.ts`:
  - `evaluateMomentumCeiling()` computes N-day high and threshold
  - pass condition: `ltp < nDayHigh × (1 - ceilingBufferPct/100)`
  - ramp-up grace: check is skipped until enough bars exist (70% of configured lookback)
- Ceiling logic is now reused by both:
  - momentum BUY scan path
  - momentum tile/rule rendering path

#### Strategy tiles and rule visibility improvements

- Momentum tiles now include explicit rules for:
  - scan window
  - strategy GIFT gate (when enabled)
  - day gain min/max
  - rising candles
  - volume condition
  - EMA proximity
  - ceiling filter (`Below X% buffer from N-day high`) with ramp-up skip display
  - per-trade cap purchasability (`₹cap -> qty`)

#### Settings page and CSV export hardening

- Settings section headers (CORE, PARAMS, CEILING FILTERS, etc.) rendered bold for readability.
- Momentum settings include a dedicated `Ceiling Filter` section with:
  - `Recent High Days`
  - `Ceiling Buffer %`
- CSV export upgraded for strategy auditability:
  - new column: `Section`
  - header now: `Strategy name, Section, Parameter, Parameter description, Value`
  - export now guarantees canonical parameter coverage across strategy types
  - includes defaults/fallbacks for missing runtime keys
  - includes GIFT gate fields consistently

#### Lot handling decision (important behavioral clarification)

- Investigated NTPC sell confusion (multiple lots with different entry prices).
- Confirmed intended lot behavior:
  - lots are evaluated independently against their own T1/T2 targets
  - system sells only the quantity for the lot that meets condition
  - FIFO is not forcibly applied as an override to independent lot exits

#### Holdings price display + lot transparency

- Holdings now refresh weighted average from currently open lots when positions are read.
- Weighted display reflects remaining quantity basis, not stale anchor.
- API now includes lot detail in strategy positions response so UI can show per-lot breakdown.
- UI now shows:
  - weighted average for current holding
  - per-lot price/qty breakdown when multiple lots are open

#### Strategy tag consistency and external broker tag handling

- Fixed tag drift where changed strategy ownership could be overridden by fallback behavior.
- Added duplicate/fallback safeguards in strategy positions tag assembly.
- Outside-Zerodha orders can carry raw tags like `quick`; these are not DineshTrade strategies.
- Normalization and UI now treat unknown non-`dt-` tags as `EXTERNAL`.
- Current semantics:
  - `dt-*` -> DineshTrade strategy context
  - `dt-manual`/manual -> MANUAL
  - non-`dt-` unknown broker tags -> EXTERNAL

#### Universal footer (post-login and global layout)

- Added universal footer component and wired in root layout.
- Footer content:
  - Created by: Dinesh Wadhwani
  - email: dinesh.k.wadhwani@gmail.com
  - Phone: 9767676738
  - Version: server startup timestamp
- Added `/api/version` endpoint returning process/module start time for footer version display.

### Phase 9 — built 04 Aug 2026

#### Sold-today lots vanishing / misrepresented on Holdings + Today's Positions

- Root cause: `/api/positions` built "today's positions" purely from Kite's Positions/Orders API, which doesn't reliably represent a SELL of a CNC holding bought on a *prior* day (row missing entirely, or shows ₹0 entry/realized and the wrong strategy tag — `positions.json`'s top-level `strategyId` is frozen to whichever lot was bought first, not the lot actually sold).
- Fix: `/api/positions` now reconciles every "today" row against the bot's own `trade` journal records (ground truth for what actually executed). Drops any Kite-derived row a journal trade's order id touches and rebuilds one row per trade from the journal — handles a symbol having multiple distinct closed-today trades under different strategies, which Kite nets into a single row that can't represent any of them correctly. A second pass walks the position store directly for any lot bought today not yet visibly represented (handles "sold an old lot + bought a new one, same symbol, same day").
- Row semantics differ by page on purpose: Holdings clamps to qty 0 for any sold-today lot (`Math.max(0, qty)`); Today's Positions preserves Kite's real signed semantics — a pure sell out of settled holdings shows as **negative quantity** (matches the real Kite Positions tab), a genuine same-day round trip shows qty 0/closed.
- Today's Positions headline P&L for a reconciled sold-today row now shows the **re-entry-relative** figure (`exitPrice − current LTP`) × sold qty — "if I bought this back right now, where do I stand" — not the realized gain vs entry (that stays in the "realized" line below, unchanged). The page's total "Day P&L" tile was fixed to sum this same per-row figure (was silently summing realized+unrealized instead, drifting from what the rows actually showed).

#### Position store race condition (lost buys/sells)

- Root cause: `lib/positions.ts`'s `normalizePosition()` unconditionally reported "changed" for any tracked position, so `migrateIfNeeded()` rewrote `positions.json` on *every read* (every page load, every cron tick) — a plain read racing a concurrent `recordBuy`/`applyLotSell` write could silently clobber the write with a stale snapshot. Concretely lost a same-day Market Boom BUY lot for BSE this way.
- Fix: `normalizePosition()` now only reports "changed" if it actually mutated the position (before/after snapshot compare) — plain reads stop writing.
- Residual risk closed too: `cron.ts` runs the 5-min SELL tick plus a separate cron task per active strategy, all in one process, and their schedules periodically land on the same minute — two genuine writes could still interleave. Added an in-process async mutex (`withLock`) wrapping all 13 exported read-modify-write functions in `lib/positions.ts`. Sufficient since the whole app is one long-lived Node process (PM2, not clustered); verified no nested lock calls (no deadlock risk).
- Manually repaired the lost BSE lot and a since-discovered stale SAIL lot directly in `data/positions.json` this session (documented recovery pattern: read the journal's order/trade records for true qty/price/timestamp, append a matching lot, recompute derived fields the same way `summarizeMomentumPosition` would).

#### Trade Report understates real P&L — journal has corrupted phantom trades (NOT YET FIXED)

- Zerodha Console shows Net Realized P&L +₹11.67k / Gross +₹16.07k for 2026-05-19 to 08-04. The in-app Trade Report (`/trade-report`, `lib/tradeReport.ts`) showed only +₹5,548 net for the same window.
- Cross-referenced our journal's `order` records against the real Zerodha tradebook CSV (per-symbol buy/sell qty totals) — ~15 symbols mismatch, worst case TATASTEEL: our journal records a SELL of **28,700 shares** on 2026-07-01 against a lifetime total of 165 shares actually bought.
- Root cause traced to `reconcileManualSells()` in `lib/cronReconcile.ts`: its "absorb untracked live position" path (phantom BUY, no order ID) and "Case 2 synthetic close" path (synthetic SELL using `pos.remainingQty` at that instant, then `removePosition`) can cycle — phantom BUY → synthetic SELL → phantom re-BUY of the same physical holding — and somewhere in that cycle a lot's `remainingQty` got corrupted before being captured verbatim into a permanent journal record. Confirmed same fingerprint (phantom no-order-ID BUY / synthetic `dt-manual` SELL / phantom no-order-ID re-BUY) on BSOFT, CAMS, and others.
- **Decision:** don't hand-patch months of corrupted journal entries. Full account reset planned for **2026-08-05, 7:30 AM IST** (right after Zerodha's overnight reconciliation window closes, so the reset seeds from a fully-settled snapshot) via the existing Settings → Reset flow: wipes journal + position store, re-seeds one lot per symbol at Zerodha's real current avg price/qty (JINDALSTEL collapses from its current multi-lot state to one lot — confirmed fine). Every position resets `firstBuyAt` to reset-day (age-based exit rules restart) and comes back tagged Accumulator (needs manual re-tag to real strategy per symbol afterward). Zerodha Console remains the source of truth for anything before the reset; the in-app Trade Report becomes trustworthy only from reset-day forward.
- **Still outstanding:** the root-cause fix in `reconcileManualSells()`'s Case 2 + untracked-position-absorb logic, so this can't recur. Deferred on purpose to the same conversation as the broker-abstraction/account-scoping refactor below, since it's the same subsystem.
- Also surfaced: Kite Connect's `/orders` and `/trades` endpoints are strictly scoped to the current trading day — there is no API path for historical multi-day trade data. Console's Tradebook CSV / P&L reports (manual download or scheduled email) are Zerodha's only historical source; going forward, "Today's Positions" pulling straight from live Kite orders instead of trusting our own journal is worth doing precisely because it sidesteps this exact class of journal-corruption bug.

#### Major refactor discussed, not started — planned for a weekend

Three changes requested together; recommended as two sequenced projects plus a cross-cutting architectural requirement:

1. **Account-scoped strategies** — strategies are currently applied universally across all accounts. Each strategy becomes an "out of the box" template; each account creates its own copy to customize/run independently. Cron needs to run each strategy per-account.
2. **Broker abstraction layer** — plug out Zerodha, plug in Upstox or another broker's API; only Zerodha supported for now, but the refactor must not paint the architecture into a corner. **Note:** `docs/archive/v2-unbuilt-angelone-supabase-plan/HANDOFF.md` (moved to archive 09 Aug 2026 — that whole plan was never built, see that folder's README) already sketches an `IBroker` interface pattern for exactly this (targeting Angel One specifically, not Upstox) — read that doc's "Broker Adapter Pattern" section first when this work starts; the interface shape likely needs only the target adapter swapped. Confirmed via code audit: no `IBroker`/adapter layer exists today — `lib/kite.ts` is called directly everywhere.
3. **JSON → Supabase migration** — motivation is broader than thread-safety (already mitigated by the mutex fix above) — also scaling, queryability, backups, and the relational structure the account-scoped model needs.

Recommended sequencing: account-scoping first (on the existing JSON store, proven live for a few days), broker abstraction folded into that same pass (both touch the credential-resolution layer), Supabase schema designed around the now-settled account-scoped + broker-scoped shape last, not a straight port of the old flat JSON. Recommended timing: build/dry-run anytime including market hours (logging-only validation), but do the actual cutover (cron switch, or the Supabase point-of-no-return) off-market with a tested rollback ready.

---

## 12. OPEN ISSUES / KNOWN BUGS (as of 09 Aug 2026)

- **Open, root cause known, fix deferred:** `reconcileManualSells()` in `lib/cronReconcile.ts` can create phantom sell/rebuy cycles that corrupt `positions.json` and the journal (see Phase 9 above). Worked around via a full account reset (2026-08-05 7:30 AM); underlying fix not yet built. Recommend prioritizing in next session.
- **Resolved (Phase 10, 09 Aug 2026):** Holdings/Today's Positions sold-today-lot visibility, attribution, and P&L display bugs (see Phase 9 & 10).
- **Resolved (Phase 10, 09 Aug 2026):** position store read-triggered and concurrent-write race conditions (see Phase 9).
- **Resolved (Phase 10, 09 Aug 2026):** Trade Report P&L calculation and reconciliation logic (see Phase 9 & 10).

- **Resolved:** holdings display now derives weighted average from currently open lots and exposes per-lot price/qty breakdown for UI rendering.
- **Resolved:** mixed-root positions (e.g. BSE) now preserve lot-level `strategyId` and evaluate per-lot exits by that lot's own strategy instead of the row-level fallback.
- **Resolved:** no-loss preflight now accepts `buyPricePerShare` and evaluates SELL gate 8 against each lot's own entry price when exiting a single lot.
- **Login with Kite button**: clicking navigates to `/api/zerodha/login` which should redirect to Kite OAuth. If it "refreshes" instead, check `ZERODHA_ENVIRONMENT` and `PROD_ZERODHA_API_KEY_DINESH` env vars on EC2.
- **Light mode**: attribute selector overrides apply after React hydration. SSR-rendered pages may flash before light mode applies.

### Phase 10 — verified live 09 Aug 2026

#### Trade Report defect fix — verified

- Trade report P&L calculation now correctly uses incurred charges for closed legs and excludes projected charges for still-open positions.
- Updated in `lib/tradeReport.ts` to reconcile when `toDate` is today: report open trades are validated against live tracked positions plus broker live qty to prevent positions from appearing as fully closed due to journal pairing gaps.
- `mergeTodayOrders()` now uses both orderId matching and shape-based fallback to prevent duplicate rows when real SELLs have divergent IDs.
- `closeStaleOpenTrades()` now no-ops when `openQtyByKey` is empty (historical/non-today runs), preventing synthetic force-closure at `toDate` from inflating closed trades.
- Stale synthetic no-id BUY rows are pruned when they occur at/after same-day earliest real SELL for account+symbol, preventing duplicate closed trades on later runs with `toDate=today`.

#### Current Holdings & Today's Positions — multiple-row display fixed

- Holdings and Today's Positions now correctly render when a stock is bought/sold multiple times in a single day or across strategies.
- Per-lot handling ensures each lot tracks its own source `strategyId`, so multi-strategy positions display with correct strategy badges.
- Holdings uses weighted average from currently open lots and shows correct current strategy (most recent lot).
- Today's Positions correctly handles:
  - Multiple distinct closed-today trades under different strategies (rebuilt from journal, not Kite net)
  - Same-day round trips (sell old lot + buy new lot, same symbol)
  - Negative quantity display for pure sells out of settled holdings (matches real Kite Positions tab)
  - Re-entry-relative P&L display for sold-today rows (`exitPrice − current LTP` vs entry-to-current)

#### Retrace exit behavior — strategy parameter support confirmed live

- `retraceAfterHit` (boolean, default `true`): allows exits if T1/T2 was hit intraday and then price retraced below trigger but remains above entry.
- `retractPercentAllowed` (number, percentage points): max allowed retracement below target that still permits retrace-after-hit exit.
  - Example: `T1=1.5` and `retractPercentAllowed=0.25` means sell only if current gain `≥ 1.25`.
  - If absent, behavior falls back to legacy logic (full retrace allowed while still above entry).
- Implemented for **all three strategy types:**
  - `DipParams` (Accumulator)
  - `MomentumParams` (Catalyst)
  - `PivotalParams` (Breakout)
- Documented in `lib/strategyConfig.ts` (lines 97–108 for Dip, 133–145 for Momentum, 158–170 for Pivotal).
- Fields are editable per-strategy in Settings → Strategies accordion.

#### Summary

- All defects identified in Phase 9 (Holdings/Positions display, Trade Report P&L, position store races) are now fully resolved and live.
- Strategy parameter support for retrace control is confirmed functional across all strategy types.
- Next session: complete the deferred `reconcileManualSells()` root-cause fix to prevent phantom sell/rebuy cycles from recurring.

---

## 13. HOW TO USE THIS FILE

Start any new Claude conversation:

1. Upload this `CONTEXT.md`
2. Say: "This is context for DineshTrade. [Your question]"

For deep implementation questions, upload from `docs/` (reorganized 09 Aug 2026 —
these are code-verified against the actual app, not historical planning docs):

- `docs/ARCHITECTURE.md` — stack, runtime model, preflight gates, all 4 live strategies
- `docs/MULTI_TENANCY_CURRENT_STATE.md` — precisely how multi-tenant the app is today
- `docs/APP_MAP.md` — every page, API route, and component
- `docs/DATA_MODEL.md` — exact file shapes + the config-vs-live drift that exists today
- `docs/TRADING_ENGINE_CORE.md` / `docs/TradingEngine.md` — strategy/exit rule reference

Older docs (`docs/archive/v1-historical-2026-06/`,
`docs/archive/v2-unbuilt-angelone-supabase-plan/`) are historical/speculative only —
see `docs/README.md` for why they were archived and what's wrong with trusting them
as current state.

For GitHub Copilot or Cursor: see `COPILOT.md` in the repo root for the full technical handoff document.

---

## 14. DALGO MULTI-TENANT REFACTOR — PROGRESS (branch `multitanent_refactor`)

**Full spec:** `docs/DALGO_REFACTOR_SPEC_v2.md` — read completely before continuing this work; this section is a status summary, not a replacement for it.
**Schema:** `docs/DALGO_SUPABASE_SCHEMA_v2.sql`
**Branch:** `multitanent_refactor` — `main` stays untouched/live production per spec §17 rule 4.

This is a separate, parallel effort from the V1 app documented in sections 1–13 above. V1 (`dineshtrade.online`) keeps running unchanged until cutover (spec §16 Phase 8) — don't conflate the two. V1's `lib/kite.ts`, positions/journal JSON files, etc. are untouched by this refactor except where explicitly noted below.

### Phase 1 — Foundation — ✅ complete (commit `860d418`)

- `lib/supabase.ts` (admin + anon clients), `lib/encryption.ts`, `lib/dalgoAuth.ts` (login/session/SSO token gen), `middleware.ts` role-based routing, DAlgo-themed `/login`, `scripts/migrate-to-supabase.ts`, skeleton `/admin` and `/manager` pages.
- Verified: login works end-to-end against Supabase Auth + `profiles` table.

### Phase 2 — Broker Abstraction — ✅ complete (commit `1b92ee3`)

- `lib/broker/IBroker.ts` — full interface, zero imports, matches spec §6.2 exactly.
- `lib/broker/ZerodhaAdapter.ts` — wraps `lib/kite.ts` (not deleted — V1 still uses it directly). Constructor takes `{ apiKey, accessToken, apiSecret? }` — `apiSecret` was added beyond the spec's literal shape because `generateSession()` needs it for Kite's login checksum; throws a clear error if omitted and called.
- `lib/broker/AngelOneAdapter.ts` / `UpstoxAdapter.ts` — stub classes, every method throws `'... not yet implemented — V2'`. Deviates from spec §6.3's factory (which throws directly without instantiating) — the factory instead does `new AngelOneAdapter(...)` etc., a deliberate choice for interface uniformity, not a spec bug.
- `lib/broker/index.ts` — `getBroker()` factory + re-exports all `IBroker.ts` types.
- `lib/preflight.ts` — private `kiteGet()` DELETED. `runPreflight(input, broker: IBroker)` now takes a broker instance; all 6 gates that read Kite data go through it. All 7 call sites (`app/api/zerodha/route.ts`, `cronEOD.ts`, `cronBuy.ts`, `strategy1.ts` ×3, `strategy2.ts`, `pivotal.ts`) construct `getBroker({ brokerName: 'zerodha', ... })` from the existing `resolveAccountCreds()` and pass it in.
- **Known gap, deliberate:** only `runPreflight()`'s Kite calls were migrated. `cronBuy.ts`, `cronEOD.ts`, `strategy1.ts`, `strategy2.ts`, `pivotal.ts` still call `lib/kite.ts` directly for `getQuotes`/`placeKiteOrder`/`getHistoricalCandles`/`resolveAccountCreds` outside of preflight — spec §16 Phase 2 item 6 ("Replace ALL direct Kite calls in strategy monitors with IBroker") was NOT done. Worth finishing before/during Phase 5 (multi-tenant cron), since that's when broker credentials stop being env-var-resolved.
- `resolveInstrumentToken()` reuses the existing live-fetch/cache in `lib/instruments.ts` — not a static `config/instruments.json` (that file doesn't exist in this repo).

### Phase 3 — Registration and Onboarding — ⚠️ PARTIAL (commit `6a01a80`)

Per spec §16 Phase 3's own 12-item list, only items 1–4 are done. Items 5–12 (SuperAdmin `/admin/registrations`, AM `/manager/registrations`, Step 1 approval flow, Step 2 broker/strategy setup screens, activation flow) are **not built yet** — see "What's next" below.

**Built:**

- `scripts/setup-storage.ts` — creates the private `kyc-documents` Supabase Storage bucket (MIME allowlist, 5MB cap). The "service-role only" storage policy can't be created via the JS SDK (no API for `storage.objects` RLS) — the SQL is printed by the script and appended to `docs/DALGO_SUPABASE_SCHEMA_v2.sql`; already run manually in the Supabase SQL editor.
- `lib/storage.ts` — `generateUploadUrl()` (returns `{uploadUrl, path}`, not just a string — forced by the uuid being generated inside the function) and `getFileUrl()` (60-min signed read URL).
- `app/api/dalgo/register/route.ts` — customer + broking_company registration. Uses `supabaseAnon.auth.signUp()`, NOT `admin.createUser()` — the admin API doesn't send Supabase's confirmation email at all; `signUp()` does. Duplicate-email detection: checks `user.identities.length === 0` (Supabase's anti-enumeration "fake success" signal) first, falls back to a `profiles` insert unique-violation (`23505`) catch as a second layer. Best-effort rollback (deletes the auth user / profiles row) on any downstream insert failure so a half-registered email isn't permanently stuck.
- `app/api/dalgo/upload-url/route.ts` — public route, signed upload URL for Aadhar images. Security boundary is the UUID-scoped path + private bucket, not auth.
- `app/register/page.tsx` + `RegisterClient.tsx` — full customer/broking-company form, DAlgo light theme, drag-drop Aadhar upload with live status, masked Aadhar number display.
- `app/pending/page.tsx` — status holding page; redirects to `/login` if already active.
- `lib/email.ts` — **rewritten from nodemailer/Gmail SMTP to Resend** (explicit mid-task instruction, not in the original spec text). Structural points for whoever touches this next:
  - `deliver(to, subject, text): Promise<void>` — fire-and-forget, never throws, used only by the 5 new Phase 3 functions below.
  - A private `sendViaResend(to, subject, text, html?): Promise<EmailResult>` does the actual API call and checks Resend's `{error}` response shape (Resend does NOT throw for API-level failures) — `sendEmail()` (the old V1 dispatcher) calls this directly so `EmailResult` reporting is preserved for its 3 real consumers (`app/api/health/route.ts`, `app/api/email/test/route.ts`, `lib/cronEOD.ts`).
  - Resend client is lazily constructed (`getResendClient()`) — not `const resend = new Resend(...)` at module scope, because the constructor throws immediately if `RESEND_API_KEY` is missing, which would crash every module importing `lib/email.ts` (most of the order-placement pipeline) in any environment missing that one env var.
  - Env: `RESEND_API_KEY`, `FROM_EMAIL=contact@dalgo.online`, `FROM_NAME=DAlgo Trade` (already in `.env.local`), `NOTIFY_TO` (optional, V1 emails only).
  - 5 new functions added: `sendRegistrationConfirmation`, `sendRegistrationAssigned`, `sendIdentityApproved`, `sendIdentityRejected`, `sendAccountActivated` — **only the first is actually wired up** (fire-and-forget in the register route). The other 4 exist but have no caller yet — they're for the Step 1/Step 2 approval flow (spec §4.5) that isn't built.
- `middleware.ts` — `/api/dalgo/register` and `/api/dalgo/upload-url` added to `PUBLIC_EXACT` (`/register` and `/pending` pages were already public from Phase 1).
- `lib/dalgoAuth.ts` — `createEphemeralAnonClient()` changed from private to exported (needed by the register route's `signUp()` call, for the same "don't reuse the shared client's mutable auth state" reason `login()` already used it for).

**Verified end-to-end (09 Aug 2026):** browser-driven registration test (customer type, dummy Aadhar images) → both uploads succeeded → submit → redirected to `/pending` → confirmed `profiles` row (`status=pending`) and full `registrations` row in Supabase. Confirmation email fired without error but was not independently inbox-verified (no email access available).

### Phase 4 — Store Porting (JSON files → Supabase) — ✅ complete (09 Aug 2026, not yet committed — user commits manually via GitHub Desktop)

Ported all 8 V1 JSON-file stores to Supabase, customer-scoped via `getCustomerId()` (new helper in `lib/supabase.ts`, reads `process.env.CUSTOMER_ID`, throws if unset). Per spec §16 Phase 4 items 1–8 — items 9–10 (customer pages, SSO flow) are **not built yet**.

| File | Table(s) |
|---|---|
| `lib/positions.ts` | `customer_positions` |
| `lib/state.ts` | `customer_state` |
| `lib/journal.ts` | `orders` / `trades` / `signals_skipped` / `strategy_scans` |
| `lib/watchlistStore.ts` | `customer_watchlists` |
| `lib/strategyConfigStore.ts` | `customer_strategies` + `customer_capital_config` |
| `lib/dailyCloses.ts` | `daily_closes` (shared — **no** `customer_id` filter, NSE data identical for every customer) |
| `lib/backtestHistory.ts` | `backtest_runs` |
| `lib/pivotalListStore.ts` | `customer_pivotal_lists` |

**Ground rule for the whole phase:** preserve every real exported function signature and all business logic exactly — only the storage backend changes. The task brief's own function-name lists for `state.ts`/`strategyConfigStore.ts`/`pivotalListStore.ts`/`backtestHistory.ts` turned out to be an approximate gloss that didn't match the actual code (e.g. `state.ts`'s real exports are `getState`/`saveState`/`recordIdempotency`/`recordBuyHistory`/`addPanicSkip`/etc, not the `getMode`/`addIdempotencyEntry`/`maybeRollDay` names the brief listed) — in every case, the *real* existing signatures were kept, not the brief's names.

**Schema extensions required** (`scripts/migrations/2026-08-09-phase4-schema-extensions.sql`, already run manually in the Supabase SQL editor; also folded into `docs/DALGO_SUPABASE_SCHEMA_v2.sql` for fresh installs). The v2 schema's tables didn't have columns for several fields the existing (unchanged) business logic still carries:
- `customer_state.session_meta` (jsonb) — legacy multi-account `kiteTokens`/`selectedAccounts` (V1 DINESH/KIRAN/SHEELA/SONIA concept), still read directly by ~12 live trading files this phase didn't touch (`cronBuy.ts`, `cronEOD.ts`, `strategy1.ts`, `strategy2.ts`, `pivotal.ts`, `cronReconcile.ts`, `kite.ts`, `intradayCircuit.ts`, `panicSell.ts`, `retrospective.ts`, `tradeReport.ts`, + API routes). Retiring these in favour of `broker_accounts.access_token_enc` is real work for a later phase — **not done here**.
- `customer_positions.account` / `.strategy_tag` — `account` because the table's unique key is `(customer_id, symbol)` with no account dimension, but every `lib/positions.ts` function still takes `account: string`; `strategy_tag` carries the string strategy id (`'accumulator'`, etc.) since `strategy_id` is a uuid FK that stays null until Phase 5's strategy-registry wiring.
- `orders`/`signals_skipped`/`strategy_scans` all gained `.account` (+ `.strategy_tag` on `orders`/`strategy_scans`, + `.strategy_name` on `strategy_scans`) for the same reasons.
- `trades` also gained `.day_high_after_entry`/`.day_low_after_entry`/`.left_on_table`/`.notes` (report fields read by `lib/retrospective.ts`, `lib/email.ts`, the trades page) and `.buy_order_broker_id`/`.sell_order_broker_id` (Kite's own order-id strings — distinct from the uuid `buy_order_id`/`sell_order_id` FKs, which point at this app's own `orders` rows, Phase 5 work).
- `customer_strategies.strategy_key` (text) + a unique index on `(customer_id, strategy_key)` — business logic keys every strategy off a stable string id used everywhere (`positions.strategyId`, `journal` strategy_tag, `getStrategyById(id)`), which is neither `name` (user-editable display label) nor `platform_strategy_id` (not unique per customer — a customer can copy the same template twice). This is the upsert conflict target, so renaming a strategy updates its row instead of inserting a duplicate.

**Notable per-file design decisions:**
- `state.ts`: user chose (from 3 options) to add the `session_meta` column rather than leave `kiteTokens`/`selectedAccounts` on the old file backend or do a bigger migration to `broker_accounts` — zero call-site changes anywhere.
- `journal.ts`: `readJournalDay/Month/Range` still return the full mixed record type (order/trade/signal_skipped, + strategy_scan when `STRATEGY_SCAN_DB_ENABLED`), reassembled from 3–4 tables — `retrospective.ts`/`tradeReport.ts` depend on that mix, not just orders. `exit_monitor` is dropped (written by `strategy2.ts`, confirmed nothing reads it back anywhere) — same treatment as `monitor_heartbeat`, which the spec explicitly drops.
- `strategyConfigStore.ts`: `getRuntimeStrategyConfig()` stays **synchronous** — `lib/strategyConfig.ts` (unchanged per spec) calls it sync from dozens of sites across the engine/cron/preflight. Backed by an in-memory cache that's eagerly hydrated from Supabase on module load (fire-and-forget), serving the bundled `config/strategy.json` seed as a fallback until that resolves. `saveRuntimeStrategyConfig()` writes through to Supabase and updates the cache synchronously, so a save is visible on the very next read with no restart.
- `backtestHistory.ts` / `dailyCloses.ts`: no schema extension needed — `backtest_runs`' `params`/`results` jsonb columns absorbed the rich `BacktestHistoryEntry` shape losslessly; `daily_closes` enforces its 60-row rolling window per symbol by pruning after every upsert (same bound the old file backend's array-slice enforced).
- Dropped only confirmed-dead cosmetic fields after checking every reader first: `watchlist.generated`/`pivotalLists.generated` (UI footer text only) and `capital.sharedPool` (computed but never branched on anywhere — `strategyConfig.ts`'s own default already produces the same value when it's absent).

**Data fix applied:** the test customer's 4 `customer_strategies` rows (seeded in Phase 1, before `strategy_key` existed) all had `strategy_key = null`. Backfilled via the admin client (`strategy_key = platform_strategy_id`, a safe 1:1 mapping — `migrate-to-supabase.ts` always sets `platform_strategy_id` to the template's string id) after a live smoke test caught the gap (hydration was silently falling back to the 3-strategy bundled seed instead of the customer's real 4 strategies).

**Environment:** `CUSTOMER_ID=95f45bd0-1d1d-407f-88dc-35892ced8c86` (the `wadhwani_dinesh@hotmail.com` test customer from Phase 1's seed) added to `.env.local` — this instance represents Dinesh's own customer account. `.env.local` is gitignored, so this value isn't committed; **every other customer instance needs its own `CUSTOMER_ID` set to its own `profiles.id`** per spec §5.4. Also added `tsconfig-paths` as a devDependency (resolves the `@/*` path alias for one-off `ts-node` verification scripts — harmless, doesn't affect the app bundle).

**Verified (09 Aug 2026):**
- `npx tsc --noEmit` — clean.
- `npm run build` — clean, exit 0 (dev server stopped first per [[feedback_dev_build_conflict]]): all 40 routes generated, middleware bundled at 82 kB (confirms none of the 8 ported files leak into the Edge bundle — they're all server-only, consistent with `getSupabaseAdmin()`'s own browser-context guard).
- Live smoke test against the real Supabase DB (temporary `ts-node` script, deleted after use) — all 8 stores read correctly with the real `CUSTOMER_ID`: `customer_state` (mode=manual), `customer_positions` (0 open), `orders`/`trades`/`signals_skipped` (0 today), `customer_watchlists` (listA/listB/list3), `customer_strategies`+`customer_capital_config` (all 4 strategies, perTrade=₹20,000, after the backfill above), `daily_closes` (50 symbols cached), `backtest_runs` (0 runs), `customer_pivotal_lists` (pivotalA).
- No `fs` imports or `STATE_FILE_PATH` remain in any of the 8 ported files (grep-verified).

**Known gaps carried forward (explicitly out of scope for Phase 4):**
- The ~12 files listed under `session_meta` above still call `lib/kite.ts` directly and read `state.kiteTokens`/`selectedAccounts` — unchanged V1 multi-account logic, now transitively running against Supabase (since `getState()`/`appendJournal()`/etc. underneath them changed backend) but not re-architected for one-broker-account-per-customer.
- `cronReconcile.ts`'s root-cause bug (spec §10.1 — phantom BUY/SELL cycles from the "absorb untracked position" path) is **not fixed**. It already calls the now-Supabase-backed `getState()`/`setBuyHistoryForSymbol()`/`readJournalRange()`/`journalOrder()` unchanged, but the spec is explicit: fix this bug *before* porting/relying on reconciliation logic in production — don't let Phase 5 build on top of it as-is.

### Phase 5 — Multi-Tenant Cron — ✅ complete (09 Aug 2026, not yet committed — user commits manually via GitHub Desktop)

**`cronReconcile.ts` root-cause fix (Task 5.1, highest priority per spec §10.1)** — the phantom BUY/SELL cycle is fixed. Root cause confirmed: the "absorb untracked live position" path journaled a no-order-ID BUY for any live Kite holding not in the positions store; if a later read ever saw zero live qty for that symbol (a transient broker-snapshot miss), Case 2 journaled a synthetic SELL + removed the position — but no real Kite sell ever happened, so the next tick's absorb path saw the same physical holding as "untracked" again and re-absorbed it, restarting the cycle every 5 minutes. Fix (four parts, all required together):
1. The absorb path never journals a BUY with no order ID. If a completed BUY order exists in today's Kite order book, its real order ID is used (or, if already journaled, the position is silently re-synced with no duplicate entry). If no order exists today, the symbol is tracked (`recordBuy`) but **not journaled at all** — there's no real "BUY event" to record, so none is fabricated. This is the change that makes the cycle non-corrupting even in the worst case.
2. Today's Kite order book (`getOrders()`) is checked before deciding a position is genuinely untracked vs. a same-tick race with the BUY engine.
3. Case 2 (synthetic SELL for a prior-day manual close) was split into its own function, `reconcileManualSellsEOD()`, called ONLY from the 15:35 IST daily retrospective task (`lib/cronEOD.ts`) — never from the 5-min tick. `reconcileManualSells()` (the tick-invoked function) now only does Case 1 (today's actual completed sells) + the hardened absorb path.
4. An in-process, day-scoped `absorbedToday` map prevents re-processing the same symbol twice in one day.
See `lib/cronReconcile.ts`'s file-header comment for the full design writeup.

**Task 5.2 — CUSTOMER_ID scoping** — `startCron()` (now `async`, reads Fixed Rules before scheduling) throws `[cron] CUSTOMER_ID env var is required when CRON_ENABLED=true` immediately if `CRON_ENABLED=true` and `CUSTOMER_ID` is unset. `server.js` now `await`s `startCron()` so this fails before the HTTP server starts accepting requests; `ensureCronStarted()`'s fire-and-forget callers let the rejection surface as a process crash (Node 20's default unhandled-rejection behavior) rather than a silent log line. All cron data operations were already customer-scoped via Phase 4's `getCustomerId()`-wired stores — verified, not re-plumbed.

**Tasks 5.3/5.4 — heartbeat + token status** — new `lib/instanceStatus.ts`: `isHeartbeatDbEnabled()` (60s-cached `platform_config.HEARTBEAT_DB_ENABLED` read, default off), `checkKiteTokenStatus()` (cheap live probe — no token → `missing`; token + a working `getPositions()` call → `connected`; call throws → `expired`), and `updateInstanceStatus(fields)` — one combined `customer_instances` upsert per tick for both heartbeat and token-status fields, entirely skipped (no Supabase call, no extra Kite call) when the flag is off. `lib/cron.ts`'s `tick()` calls this via `reportInstanceStatus()` **before** any of its early-returns (market closed / manual mode / no token), so the dashboard's "last cron tick" + `cron_mode` stay current even when trading itself is paused.

**Task 5.5 — 9:00 AM IST token alert** — new `lib/tokenAlert.ts` + `sendTokenMissingAlert()` in `lib/email.ts` (supports CC). Registered as its own per-customer cron task (`0 9 * * 1-5` Asia/Kolkata) in `lib/cron.ts`. **Deliberate scoping decision:** the full spec (§5.9) describes a MAIN-instance cron looping over all customers; the Phase 5 task brief instead described a per-customer check gated by `CRON_ENABLED=true` (which is only ever true on a customer instance, never main, per spec §5.4) — followed the task brief literally, documented in `lib/tokenAlert.ts`'s header comment. A true main-instance sweep is Phase 6 SuperAdmin territory. **Also:** the alert's send/skip decision does NOT trust `customer_instances.kite_token_status` (that column is stale-by-default since heartbeat writes default off) — it runs its own live `checkKiteTokenStatus()` probe as the source of truth, then opportunistically write-throughs the result (a no-op unless heartbeat is on).

**Task 5.6 — Fixed Rules from Supabase** — new `lib/fixedRules.ts`: `getFixedRules()` reads all 6 `platform_fixed_rules` rows, cached 5 minutes, falls back to safe hardcoded defaults (matching current hardcoded values) and logs a warning on any DB failure — trading never stops on a config read failure. `lib/preflight.ts` Gate 8 (no-short-sell) and Gate 9 (no-loss-sell-auto) now read `noShortSelling`/`noLossSellAuto` from it; all other gate logic unchanged. `lib/cron.ts`'s core tick cron expression is now built from `sellMonitorCadenceMin` (`buildTickExpr()`), with a 5-min watcher (`checkSellCadence()`) that stops+recreates the tick task in place if the value changes — no process restart needed.

**Task 5.7 — verified** `STRATEGY_SCAN_DB_ENABLED` in `lib/journal.ts` was already correctly gating `strategy_scan` writes/reads, but its cache never expired (set once, served forever) — fixed to a 60s TTL matching the task brief and the same pattern now used in `lib/fixedRules.ts`/`lib/instanceStatus.ts`.

**Task 5.10 — reset scoping** — `app/api/settings/reset/route.ts`: every underlying store call was already hard-scoped to this process's single `CUSTOMER_ID` (Phase 4's `getCustomerId()` wiring) — `account` is only the legacy V1 multi-account label *within* that one customer's data, never a cross-tenant selector. Added: (1) cron must be in Manual mode before a reset is allowed (`state.mode !== 'manual'` → 400), preventing a reset from racing the live Auto engine over the same rows; (2) `customer_instances.last_reset_at` is stamped after a successful reset via new `recordResetTimestamp()` in `lib/instanceStatus.ts` — deliberately NOT gated by `HEARTBEAT_DB_ENABLED` (a reset is a rare, real audit event, not a frequent heartbeat metric).

**Schema changes** (`scripts/migrations/2026-08-09-phase5-schema-extensions.sql` — **not yet run against the live DB**, needs manual execution in the Supabase SQL editor; also folded into `docs/DALGO_SUPABASE_SCHEMA_v2.sql` for fresh installs):
- `customer_instances.subdomain` / `.instance_url` — dropped `NOT NULL`. The heartbeat/token-status/reset-timestamp writers upsert this row directly from the customer EC2 cron process and must be able to create it before the manual provisioning runbook (spec §5.7) has necessarily recorded these.
- `customer_instances.last_reset_at timestamptz` — new column (Task 5.10).

**Verified (09 Aug 2026, Sunday 21:05 IST — market closed, weekend, safe to exercise live code paths with zero real-order risk):**
- `npx tsc --noEmit` — clean. `npm run build` — clean, exit 0 (dev server was not running; `dist/cron-runtime.cjs` rebuilt at 305 kB, confirms the new files bundle standalone for `server.js`; middleware still 82 kB, confirms nothing server-only leaked into the Edge bundle).
- Live smoke test (temporary `ts-node` scripts, deleted after use, per the Phase 4 precedent) against the real Supabase DB with the real `CUSTOMER_ID`: `getFixedRules()` correctly read the 6 live `platform_fixed_rules` rows (values matched the seeded defaults — no silent-fallback warning printed); `getState()`/`listPositions()` correctly customer-scoped (mode=manual, 0 positions, 0 kiteTokens); `isMarketOpen()` correctly reported closed (weekend); toggling `platform_config.HEARTBEAT_DB_ENABLED` true → `isHeartbeatDbEnabled()` picked it up immediately → `updateInstanceStatus()` attempted the real upsert and failed exactly as expected (NOT NULL on `subdomain` — the still-unapplied migration) **without throwing**, confirming the "never let a status-write failure touch trading" contract → flag reset to false.
- **Known gap, carried forward on purpose:** the Phase 4 "known gap" (cron files still reading `state.kiteTokens`/multi-account concept instead of a full `IBroker`/`broker_accounts` rewrite of `cronBuy.ts`/`cronEOD.ts`/`strategy1.ts`/`strategy2.ts`/`pivotal.ts`) was **not** closed this phase — the Phase 5 task brief scoped this session to cronReconcile fix + CUSTOMER_ID guard + heartbeat/token-status/alert + Fixed Rules + reset scoping, none of which required it. Since every Supabase-backed store underneath those files is already `getCustomerId()`-scoped (Phase 4), there is no cross-tenant risk from leaving this as-is — the `kiteTokens` map just holds this one customer's own token(s) inside their own process. Retiring it in favour of `broker_accounts.access_token_enc` remains real work for a later phase.

### Phase 6 — Admin and Manager Dashboards — ✅ complete (09 Aug 2026, not yet committed — user commits manually via GitHub Desktop)

Built every SuperAdmin (`/admin/*`) and Account Manager (`/manager/*`) page from spec §16 Phase 6 / the Phase 6 task brief's Tasks 6.1–6.15, plus the Step 1/Step 2 registration approval flow that Phase 3 had left unbuilt (spec §16 Phase 3 items 5–12 — now closed out as part of this phase, since the registrations queue/detail/approve/reject UI is exactly the same surface).

**Layout deviation, deliberate:** the task brief's literal paths (`app/(admin)/layout.tsx`, `app/(manager)/layout.tsx`) are Next.js route-group syntax, which doesn't add a URL segment — wrapping the existing `app/admin/page.tsx`/`app/manager/page.tsx` (built Phase 1, no route group) would have required moving every page to `app/(admin)/admin/...`, a pointless rename. Built as plain nested `app/admin/layout.tsx` / `app/manager/layout.tsx` instead — same "shared layout for every `/admin/*` or `/manager/*` route" outcome, zero URL disruption. Documented inline in both files.

**Shared building blocks (new):**
- `components/dalgo/theme.ts` + `components/dalgo/ui.tsx` — design-system color tokens and presentational primitives (Card/SectionCard/StatCard/Badge/StatusDot/Table/etc.), inline-style-based to match the pattern `app/login/LoginClient.tsx` already established (this app has no Tailwind theme-color/component convention — Tailwind is used only for a few responsive utility classes like `hidden md:block`).
- `components/dalgo/DalgoShell.tsx` — one client component for both roles' top bar (logo/user/role badge/logout) + side nav (desktop) / bottom nav (mobile), parameterised by `navItems`/`logoHref`.
- `lib/dalgoAdmin.ts` — server-only read layer every admin/manager page shares (dashboard stats, customer health rows, registrations/customers/managers lists with joins, reports aggregation). Column names verified against the actual migration script and store files, not just the spec's SQL — notably `platform_strategies` keys off `id` (not `strategy_key`, which is what `customer_strategies` uses instead), and watchlist symbol entries are `{nse, name, sector?}` (not `{symbol, name, sector}`).
- `lib/audit.ts` — `writeAuditLog()`, called from every mutation route below.
- `lib/email.ts` — added `sendAccountManagerWelcome`, `sendStrategyUpdated`, `sendCustomerReassigned` (the last needs a CC recipient, so it goes through `sendViaResend()` directly like `sendTokenMissingAlert` already did).

**Pages + API routes built** (one Next.js route each unless noted): `/admin` dashboard (4 stat cards, customer health table reading `customer_instances`, recent registrations), `/admin/registrations` (+ `[id]` detail with signed Aadhar URLs via `lib/storage.ts`'s `getFileUrl()`) with assign/approve/reject, `/admin/customers` (+ `[id]` detail: Profile/Instance Health/Strategies/Capital Config sections) with reassign/activate/capital-edit, `/admin/managers` with create-AM (`supabase.auth.admin.createUser()` + temp password `DAlgo@2026!`), `/admin/fixed-rules` (warning + "I UNDERSTAND" + immediate UI update, no reload), `/admin/config` (toggle/text inputs for the 6 spec-named keys), `/admin/strategies` (publish toggle + JSON param editor that pushes to active customer copies + emails them), `/admin/watchlists` (add/remove symbols), `/admin/audit` (paginated 50/page, filterable), `/admin/reports` + CSV export. Manager side reuses the same client components with role-scoped props/data rather than duplicating markup: `/manager` dashboard, `/manager/customers` (+ `[id]`, no reassign control), `/manager/registrations` (+ `[id]`, no assign control), `/manager/reports`. `POST /api/dalgo/auth/logout` clears the session cookie.

**Scoping rule applied everywhere an AM can act:** SuperAdmin acts on anything; an Account Manager may only approve/reject/activate/edit-capital a registration or customer actually assigned to them (`assigned_to`/`assigned_account_manager_id` checked server-side in every route, not just hidden client-side) — reassignment itself stays SuperAdmin-only per spec §3.5.

**Verified (09 Aug 2026):**
- `npx tsc --noEmit` — clean.
- `npm run build` — clean, exit 0 (dev server stopped first per [[feedback_dev_build_conflict]]): all new admin/manager pages and their API routes appear in the route manifest; `/api/dalgo/admin/reports/export` correctly renders dynamic (ƒ) since it reads the session cookie — the "Dynamic server usage" line printed during the build's static-generation probe is Next.js's own detection mechanism, not a build failure.
- Started `npm run dev`, curl-verified every new `/admin/*` and `/manager/*` page 307-redirects to `/login` with no session cookie (middleware.ts's existing role-based routing needed zero changes — the new pages all fall under its existing `/admin`/`/manager` prefix rules), and that mutating POST routes (`/api/dalgo/admin/managers`, `/api/dalgo/auth/logout`) are equally blocked unauthenticated. Dev server stopped afterward.
- **Not independently verified this session:** the task brief's interactive steps 4–9 (log in as `dinesh.k.wadhwani@gmail.com` / `dinesh_wadhwani@yahoo.com` and click through every page). This environment has no browser tool, and the seeded accounts' real passwords were set at first login by the user in an earlier session — not something available here to log in with. Also deliberately did NOT exercise any mutating endpoint (create-AM, approve/reject, reassign, etc.) against the live Supabase project, since several of them send real emails via Resend and mutate real rows with no test/staging environment to isolate that in. **Recommend the user click through both role's page lists manually before treating this phase as fully verified end-to-end.**

### What's next

1. **Run `scripts/migrations/2026-08-09-phase5-schema-extensions.sql`** in the Supabase SQL editor — required before heartbeat/token-status/reset-timestamp writes will actually succeed (confirmed via the live smoke test above, still outstanding as of Phase 6).
2. **Manually click through Phase 6's pages logged in as both seeded accounts** (see "Not independently verified this session" above) — this is the one thing this session couldn't do itself.
3. **Phase 7 — Landing Page and Legal Pages** (spec §16): `landing.html` → Next.js root page, the 6 legal pages, About/Contact, SEO meta tags.
4. Step 2 (broker setup + strategy setup screens) for the customer-facing registration flow is still not built — Phase 6 only closed the Step 1 (identity) approval loop on the admin/manager side. A registered, identity-verified customer still has no self-service path to connect a broker or enable a strategy before an AM can activate them.

---

Built with Claude AI — June 2026, updated August 2026.
