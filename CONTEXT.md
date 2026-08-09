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

Built with Claude AI — June 2026, updated August 2026.
