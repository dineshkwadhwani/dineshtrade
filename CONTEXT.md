# DineshTrade — Project Context

**Last Updated:** 11 Jun 2026
**Version:** 2.4
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

- Internal id: `catalyst`
- **Signal:** Day gain +0.5–1.5%, 3+ rising 5-min candles, volume > 10-day avg, LTP within ±3% of EMA
- **Scan window:** 09:30–14:30 IST, every configured `scanIntervalMin` (default 3 min via per-strategy cron task)
- **Exit T1 = +1.5%, T2 = +2.0%** per open lot, anchored to that lot's own entry price
- **Live exit monitor:** checks both current LTP and the latest completed 5-minute candle high so cron ticks do not miss valid intraday target touches; quote day-high is not used for exits
- **No-loss rider stays in force:** a touched-then-retraced exit stays blocked if the current sell price is below that lot's own entry
- **EOD behaviour** (added 28 May): `exitSameDayOnPositive` and `squareOffEOD` flags control what happens from `exitSameDayTime` onward (default 15:10)
- **Handoff:** after `deliveryHandoffDays` (default 15) → Accumulator takes over

### Strategy 3 — Pivotal (Breakout)

- Type: `pivotal`
- Uses a dedicated Pivotal list store, not the generic watchlist store
- Each script carries `breakoutTriggerPrice`, `t1Pct`, `t2Pct`, `executionMode` (`normal` or `dayEnd`), optional `stopLossPrice`, and notes
- Strategy params add consolidation, volume-surge, confirmation-candle, close-time, and handoff controls
- `normal` mode buys on confirmed intraday breakout; `dayEnd` mode buys only if the breakout sustains into the configured close window
- Exits respect script stop-loss, then T1/T2, then hand off to `accumulator`

### Market Boom (example third strategy)

- `squareOffEOD=true`, `exitSameDayOnPositive=true`, `deliveryHandoffDays=0`
- Always squares off at 15:10 — never takes delivery

### Market Mode

| GIFT Nifty | Mode | Action |
| --- | --- | --- |
| Positive/flat | Catalyst | Strategy 2 |
| Gap-down < −0.5% | Dip | Strategy 1 |
| −5% or worse | Circuit | No trades |

---

## 5. HARD STOP RULES

- Total corpus: ₹1,00,002 (current Dinesh account funded base)
- Max per trade: ₹5,000
- Max open positions: 10
- Max buys per day: 5, max sells: 10
- No short selling; No F&O; Delivery only (CNC), NSE
- Cash check before every order
- Circuit breaker: Nifty −5%+ intraday → stop all trades

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

### Journal Strategy Fallback (01 Jun 2026)

- `/api/positions` and `/api/strategy/positions` both fall back to `getJournalStrategyFallback()` in `lib/journal.ts` when a symbol is not found in the positions store
- `getJournalStrategyFallback(account)` reads last 30 days of journal auto-BUY records and returns a `Map<SYMBOL, strategyId>` for use as a read-only fallback tag source
- Prevents OOS false positives after positions store cleanup (e.g. after Settings Reset or between re-buys)

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

## 8. PREFLIGHT GATES (10 total)

1. Token connected
1. Market open (9:15–15:30, weekday, non-holiday)
1. Intraday circuit (live NIFTY 50 hysteresis)
1. Per-trade cap (auto only)
1. Idempotency (auto BUY only)
1. Panic-sell (auto BUY only)
1. Pyramid (auto BUY only — maxBuysPerSymbol, minDropBetweenBuysPct)
1. Sector concentration (auto BUY with strategyId — maxPerSector)
1. Day quota (auto only)
1. Position cap (BUY)
1. Funds available (BUY)
1. No-short guard (SELL — clamps to held qty; auto: no-loss-sell rider, bypassable via `bypassNoLossSell`)

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
npm install
npm run build
pm2 reload dineshtrade

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

---

## 12. OPEN ISSUES / KNOWN BUGS (as of 11 Jun 2026)

- **Login with Kite button**: clicking navigates to `/api/zerodha/login` which should redirect to Kite OAuth. If it "refreshes" instead, check `ZERODHA_ENVIRONMENT` and `PROD_ZERODHA_API_KEY_DINESH` env vars on EC2.
- **Light mode**: attribute selector overrides apply after React hydration. SSR-rendered pages may flash before light mode applies.

---

## 13. HOW TO USE THIS FILE

Start any new Claude conversation:

1. Upload this `CONTEXT.md`
2. Say: "This is context for DineshTrade. [Your question]"

Also upload `docs/functional-specification.md` + `docs/technical-specification.md` for deep implementation questions.

For GitHub Copilot or Cursor: see `COPILOT.md` in the repo root for the full technical handoff document.

---

Built with Claude AI — June 2026.
