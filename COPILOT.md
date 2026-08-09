# DineshTrade — GitHub Copilot / AI Assistant Handoff

**Purpose:** Zero-context onboarding for GitHub Copilot, Cursor, or any AI assistant picking up this codebase for the first time. Read top-to-bottom before touching any file.

**Last Updated:** 07 Jun 2026 (body), corrected 09 Aug 2026 (lib/ file table + preflight gate count, re-verified directly against code)
**Version:** 1.2

> Also read `docs/README.md` first — it points at `docs/ARCHITECTURE.md`,
> `docs/APP_MAP.md`, `docs/DATA_MODEL.md`, and `docs/MULTI_TENANCY_CURRENT_STATE.md`,
> all written/verified 09 Aug 2026 directly against the running code. Two files that
> used to live in `docs/` (`FUNCTIONAL_SPEC.md`, `HANDOFF.md`) described a "v2"
> Angel One + Supabase SaaS rewrite that was **never built** — confirmed via full
> codebase grep, zero trace of either. They're archived under
> `docs/archive/v2-unbuilt-angelone-supabase-plan/`; don't mistake them for current
> state.

---

## 1. Project Overview

**DineshTrade** is a personal algorithmic trading application for Indian equities. It automates BUY/SELL decisions on the NSE using Zerodha Kite Connect, targeting CNC (delivery) trades only — no F&O, no intraday short-selling.

- **Owner:** Dinesh Wadhwani, Pune, Maharashtra, India
- **Production:** <https://dineshtrade.online>
- **Broker:** Zerodha (Kite Connect API)
- **Exchange:** NSE only, CNC/Delivery only
- **Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, node-cron, PM2 on AWS EC2 (ap-south-1)
- **Process manager:** PM2 (`dineshtrade` process), Caddy reverse proxy, Node 20 LTS

This is not a SaaS product. It is a private, single-owner trading system managing 4 family Zerodha accounts.

---

## 2. Repository Structure

### `/lib/` — Core library files

| File | Description |
| --- | --- |
| `accounts.ts` | Account list config — maps account IDs to display names and Kite credentials |
| `auth.ts` | JWT session auth — time-based password (`ddmmyyyyhh` in IST), JWT cookie expiring at midnight IST |
| `backtest.ts` | Historical strategy simulation — replays strategy signals against close price history |
| `backtestHistory.ts` | Saved backtest runs — read/write to `backtest-history.json` |
| `cron.ts` | Pure orchestrator: tick management, node-cron task lifecycle. Imports from cronBuy / cronEOD / cronReconcile / cronState. Exports `startCron`, `reloadCronStrategies`, `stopCron` |
| `cronBuy.ts` | Auto-buy engine: `autoBuyOnAccount()` and `runStrategyTaskBody()`. Calls preflight, strategyEngine, Kite order placement, and cronState record functions |
| `cronEOD.ts` | EOD square-off + daily/monthly retrospective emails. `exitSameDayOnPositive` now uses estimated net P&L after charges. Imports `reconcileManualSells` from cronReconcile for the final 15:35 sweep |
| `cronReconcile.ts` | Detects positions manually closed in Kite, journals SELL entries with buying strategyId, and removes the closed row from the live positions store to prevent stale re-buy anchors |
| `cronState.ts` | Shared mutable day-stats and in-process quota state (`inProcessBuyCounts`, `inProcessNewSymbols`). No imports from other cron files. Exports record helpers (`recordExecuted`, `recordFailed`, etc.) |
| `dailyCloses.ts` | Rolling 60-day close price cache — reads/writes `daily-closes.json` |
| `ema.ts` | EMA calculation utility |
| `email.ts` | nodemailer wrappers for trade_executed, trade_failed, and daily report emails |
| `instruments.ts` | NSE instrument token lookup (maps ticker symbol → Kite instrument token) |
| `intradayCircuit.ts` | Live NIFTY 50 circuit breaker check with hysteresis — blocks all trades when Nifty falls ≥5% |
| `journal.ts` | Append-only JSONL trade journal (one file per month: `journal-YYYY-MM.jsonl`). Exports `journalOrder()`, `getJournalStrategyFallback()` |
| `kite.ts` | Zerodha Kite API wrappers — all HTTP calls go through here. Also exports `buildLiveQtyBySymbol()` |
| `market.ts` | Market hours (9:15–15:30 IST), NSE holidays, weekday check |
| `marketBriefing.ts` | AI-generated morning briefing (calls Gemini API) |
| `marketMock.ts` | Local dev mock data for Kite API responses (used when `USE_MOCK_MARKET=true`) |
| `nse.ts` | Sector classification helpers (Yahoo Finance lookup) — tags watchlist symbols for the sector-concentration gate |
| `panicSell.ts` | Circuit-breaker panic-sell state — when triggered, blocks all auto-BUYs |
| `pivotal.ts` | Pivotal (breakout) strategy engine — `scanPivotalStrategy()`, `monitorPivotalAccount()`, `monitorAllPivotalAccounts()` |
| `pivotalListStore.ts` | Pivotal list CRUD — reads/writes `config/pivotalLists.json` seed + `data/pivotalLists.json` runtime overlay |
| `positions.ts` | Unified position store (`positions.json`) — single source of truth for which strategy owns which holding; all read-modify-write functions wrapped in an in-process async mutex (`withLock`) |
| `preflight.ts` | 13-named-checkpoint order validation gate chain — runs before every order placement (see §8 below — the file's own header comment saying "six gates" is stale) |
| `retrospective.ts` | Builds daily/monthly HTML email reports from journal data |
| `state.ts` | Reads/writes `state.json` (mode, Kite tokens, idempotency keys, buy history, panic list) |
| `strategy.ts` | Legacy strategy helpers (shared utilities used by strategy1/strategy2) |
| `strategy1.ts` | Accumulator (mean-reversion) SELL monitor — checks open Accumulator positions for EMA recovery exit |
| `strategy2.ts` | Catalyst (momentum) SELL monitor — checks open Catalyst positions for profit exits |
| `strategy2Positions.ts` | Thin back-compat facade over `positions.ts`, filtered to the `catalyst` strategyId |
| `strategyConfig.ts` | Strategy schema: `DipParams`, `MomentumParams`, `PivotalParams`, `Strategy` types, `asDipParams()` / `asMomentumParams()` / `asPivotalParams()` helpers |
| `strategyConfigStore.ts` | Runtime overlay persistence for `strategy.json` (bundled seed + `data/strategy.json` live overlay), plus legacy-id migration |
| `strategyEngine.ts` | Generates BUY recommendations: `generateRecommendations()`, `runStrategyScan()`, `runReactiveDipScan()`, `evaluateAllForTiles()` |
| `strategyTag.ts` | `resolvePositionTag()` helpers used by strategy surfaces; positions ownership remains anchored to `positions.json` |
| `tradeReport.ts` | Builds the live date-range trade report (`buildLiveTradeReport()`) from journaled order legs — reuses `backtest.ts`'s charge/equity-curve types but replays real fills, not a simulation |
| `watchlistStore.ts` | Named-list CRUD — reads/writes `config/watchlist.json` seed + `data/watchlist.json` runtime overlay, `{ meta, lists }` shape with stable keys |

### Key `/app/api/` routes

| Route | Method | Description |
| --- | --- | --- |
| `/api/positions` | GET | Today's Kite positions enriched with strategy ownership (positions store first, then order-tag inference, defaulting unknown/manual to accumulator) |
| `/api/strategy/positions` | GET | Unified position store entries + journal fallback for tag resolution |
| `/api/journal/fix-attribution` | POST | Retroactively patches old `dt-manual` SELL entries missing `strategyId` |
| `/api/settings/reset` | POST | Per-account wipe + re-seed from Kite holdings |
| `/api/strategy/monitor` | POST | Manual trigger for the 5-min cron tick (same as auto tick) |

---

## 2b. Settings UI Notes

- `app/(app)/settings/page.tsx` now keeps the non-configurable trading rules out of the General tab. They render inside Settings → Strategies as a read-only `Fixed Rules` accordion.
- Shared capital controls in the same file are wrapped in a separate accordion above the per-strategy cards.
- `Export to CSV` serializes the live draft config from the Strategies tab with four columns: `Strategy name`, `Parameter`, `Parameter description`, `Value`.

---

## 3. Data Layer

All runtime data lives in `~/dineshtrade/data/` on the EC2 server. **This directory is never touched by deploy steps.**

| File | Purpose |
| --- | --- |
| `state.json` | App mode (auto/manual), Kite access tokens, idempotency keys, buy history per symbol, panic skip list |
| `positions.json` | Unified position store: `{ strategyId, account, symbol, firstBuyPrice, firstBuyAt, totalQty, remainingQty }` — one entry per account+symbol |
| `journal-YYYY-MM.jsonl` | Append-only trade journal. One JSON object per line. New file per month. Never mutated, only appended |
| `strategy.json` | User's live strategy config overlay (overrides compiled defaults) |
| `watchlist.json` | Named watchlist config |
| `daily-closes.json` | Rolling 60-day close price cache |
| `backtest-history.json` | Saved backtest runs |

**CRITICAL rules:**

- `~/dineshtrade/data/` must **never** be modified by any deploy, migration, or script step
- `STATE_FILE_PATH` must be **unset on local dev** — if set, it overrides the local file path and crashes with ENOENT because `/home/ubuntu/...` doesn't exist locally

---

## 4. Strategy Tag System

This is the most complex part of the codebase. Read carefully.

### The Single Source of Truth

`positions.json` is the **single source of truth** for which strategy owns a holding. Every auto-BUY writes an entry to this store via `recordBuy()` in `lib/positions.ts`.

### Positions Strategy Attribution (current policy)

```text

1. positions store has entry for account:symbol?
  → YES: use its strategyId
  → NO: continue

2. infer from today's completed orders:
  - latest BUY tag for symbol, else latest completed order tag (BUY/SELL)

3. normalize tag to strategyId:
  - dt-manual / manual / untagged / non-dt tags -> accumulator
  - dt-s1 -> accumulator
  - dt-s2 -> catalyst

4. if still unresolved, default to accumulator (no MANUAL/OOS label on Positions rows)

```

### Key Rule: Manually Closed Positions Are Removed After Reconciliation

When a user manually sells a position in Kite (using the S button in the Holdings page, or directly in Kite's own app), `reconcileManualSells()` detects the closure, journals the SELL, and then removes the open row from `positions.json`.

**Why:** Leaving the row behind can contaminate the next re-buy of the same symbol with a stale `firstBuyPrice`, which in turn breaks momentum exit logic.

Closed-position attribution should come from the journal and broker snapshot, not from a lingering open-position store entry.

### OOS vs Known-By-Journal

- **OOS (Out Of System):** truly unknown — no positions store entry AND no journal auto-BUY fallback. Typically a position bought manually in Kite without DineshTrade.
- **Known-by-journal:** a closed or transitional row can still resolve to its owning strategy through journaled activity even after the open-position store entry has been removed.

---

## 5. Journal Attribution Rule

When `reconcileManualSells()` detects a manually-sold position, it journals the SELL with:

```json

{
  "tag": "dt-manual",
  "strategyId": "<from positions store — the BUYING strategy>",
  "source": "manual"
}

```

**Example:** COALINDIA was bought by Accumulator. User sells it manually in Kite. `reconcileManualSells()` journals the SELL with `strategyId = 'accumulator'`. The trade report correctly attributes the profit/loss to Accumulator.

### `getJournalStrategyFallback()`

Located in `lib/journal.ts`. Reads the last 30 days of journal files and returns a `Map<SYMBOL, strategyId>` of auto-BUY records for a given account.

Used as a **read-only fallback** in:

- `GET /api/positions` — to tag T0 Kite positions whose positions store entry was cleaned up
- `GET /api/strategy/positions` — same purpose

Do **not** use this as the primary tag source. It is a fallback only.

---

## 6. Cron Architecture

The cron system is split across four files to prevent circular dependencies.

### Dependency Graph

```text

cronState  ←  cronBuy
           ←  cronReconcile  ←  cronEOD  ←  cron (orchestrator)

```

### File Responsibilities

**`cronState.ts`**

- Module-level mutable state: `dayStats`, `inProcessBuyCounts`, `inProcessNewSymbols`
- No imports from any other cron file
- Exports record helpers: `recordExecuted()`, `recordFailed()`, `recordBuyHistory()`, etc.
- `maybeRollDay()` resets all counters at midnight IST

**`cronBuy.ts`**

- BUY engine for auto-mode
- `runStrategyTaskBody(account, strategy)` — called by each per-strategy cron task
- `autoBuyOnAccount(account, strategy)` — runs preflight + strategyEngine scan + places Kite order
- Imports from cronState, strategyEngine, kite, preflight

**`cronEOD.ts`**

- Triggered at 15:35 IST daily
- Runs final `reconcileManualSells()` sweep
- Sends daily retrospective email
- Handles momentum EOD square-off (`squareOffEOD`, `exitSameDayOnPositive` flags)
- Sends monthly retrospective on last trading day of month

**`cronReconcile.ts`**

- `reconcileManualSells(account)` — compares positions store vs live Kite qty
- When Kite qty = 0 but store has entry: journals SELL with buying strategyId + `source: 'manual'`
- Zero circular dependencies — only imports cronState + kite/journal/positions utils

**`cron.ts`**

- Pure orchestrator — no business logic
- `tick()` calls all four pieces in correct order
- Manages node-cron task lifecycle (start/stop/reload per strategy)
- Exports: `startCron()`, `reloadCronStrategies()`, `stopCron()`

### Cron Schedule

| Task | Schedule | Action |
| --- | --- | --- |
| Core 5-min tick | `*/5 9-15 * * 1-5` | SELL monitors (S1 + S2), reconciliation, reactive dip scan |
| Per-strategy BUY scan | `scanIntervalMin` per strategy | Independent BUY scan per active strategy |
| EOD sweep | 15:35 IST | Retrospective email, final reconcile, EOD square-off |

---

## 7. Holdings Page Rules

The Holdings page (`/holdings`) merges two Kite data sources.

### Data Sources

- **Holdings rows:** from Kite `/portfolio/holdings` — settled positions (`qty > 0`). Includes `t1_quantity` (T+1 settlement pending).
- **T0 rows:** from `/api/positions` — same-day CNC positions from Kite `/portfolio/positions`.

### T+1 Settlement Summary (01 Jun 2026)

`KiteHolding` now has a `t1_quantity` field. `buildLiveQtyBySymbol()` in `lib/kite.ts` computes live quantity as `quantity + t1_quantity`. This prevents day-1 CNC positions from appearing OOS — on T+0 the holding appears in `/portfolio/positions`, on T+1 it moves to `/portfolio/holdings` with `t1_quantity > 0` before settling to `quantity` on T+2.

### Closed CNC Positions (Sold Today)

When a CNC position is sold today, Kite reports it in `/portfolio/positions` with `qty = -X` (the sold quantity as a negative). These are shown as T0 rows with `qty = 0` displayed.

**Average price displayed:** Uses `holdingAvgBySymbol` (built from ALL raw holdings including `qty = 0` ones) — this is the **buy cost** from the holdings endpoint. NOT Kite's `position.average_price` which is the sell execution price. Showing the buy cost makes P&L math transparent.

### `holdingAvgBySymbol` Map

Built from all `rawHoldings` (even those with `quantity = 0`) to patch the average price of closed T0 rows. This map is constructed before de-duplication so no row falls through.

### S Button Rules

- Disabled when `actionQty === 0` (no shares to sell — never hidden)
- Disabled state includes a tooltip explaining why

### OOS Badge

Shown only when tag resolution returns OOS — i.e., no positions store entry AND no journal auto-BUY fallback AND no `dt-manual` Kite tag. Closed known trades should rely on journal attribution rather than a lingering store row.

---

## 8. Preflight Gates (13 named checkpoints — re-verified against `lib/preflight.ts` code 09 Aug 2026; the file's own header comment claiming "six gates" is stale)

`lib/preflight.ts` — runs before every order. All gates must pass or the order is rejected with a reason string.

| Gate | Condition | Applies to |
| --- | --- | --- |
| 1 | Token connected | All orders |
| 2 | Market open (9:15–15:30 IST, weekday, non-holiday) | All orders |
| 2b | Intraday circuit (live NIFTY 50 hysteresis; currently enabled, −3% trip / −2% resume) | Auto BUY only |
| 3 | Per-trade cap (≤ `capital.perTrade`) | Auto BUY only |
| 4 | Idempotency (symbol not already bought today) | Auto BUY only |
| 4b | Panic-sell flag not set (currently enabled, 10% drop / 10min window) | Auto BUY only |
| 4c | Pyramid gate (maxBuysPerSymbol, minDropBetweenBuysPct) | Auto BUY only |
| 4d | Sector concentration (maxPerSector in DipParams) | Auto BUY only |
| 5 | Day quota (≤ maxBuysPerDay / maxSellsPerDay) | Auto only |
| 6 | Position cap (≤ maxPositions) | Auto BUY only |
| 7 | Funds available | All BUY |
| 8 | No-short guard — clamps sell qty to held qty, rejects if held = 0 | All SELL |
| 9 | No-loss-sell rider — auto SELLs reject if LTP < entry after modeled charges; bypassable via `bypassNoLossSell`/`bypassNoLossSellReason` | Auto SELL only |

`manual: true` orders skip gates 3, 4, 4b, 4c, 4d, 5, 6, 9.

---

## 9. StrategyParams Type System

Defined in `lib/strategyConfig.ts`.

### `DipParams` (Accumulator / mean-reversion strategies)

```typescript

interface DipParams {
  emaPeriod: number;              // EMA window (default 20)
  entryBelowPct: number;          // % below EMA to trigger entry
  strongBuyBelowPct: number;      // % below EMA for strong buy signal
  minDownDays: number;            // consecutive down days required
  capitulationFloorPct: number;   // max allowed drop before skipping
  tranche2AboveEMAPct: number;    // % above EMA to sell 2nd tranche
  reactiveDrop: number;           // intraday % drop to trigger reactive scan
  reactiveIntervalMin: number;    // reactive scan interval in minutes
  firesOnAnyMode: boolean;        // fires in both auto and manual mode
  maxPerSector?: number;          // optional sector concentration limit
}

```

### `MomentumParams` (Catalyst / momentum strategies)

```typescript

interface MomentumParams {
  minDayGainPct: number;          // min intraday gain % to qualify
  maxDayGainPct: number;          // max intraday gain % (avoid overextended)
  consecutiveCandles: number;     // rising 5-min candles required
  emaProximityPct: number;        // LTP must be within ±X% of EMA
  volumeAvgDays: number;          // days for volume average baseline
  scanStartHHMM: string;          // scan window start e.g. "09:30"
  scanEndHHMM: string;            // scan window end e.g. "14:30"
  deliveryHandoffDays: number;    // days before handing off to Accumulator
  exitSameDayTime?: string;       // EOD exit time e.g. "15:10"
  exitSameDayOnPositive?: boolean; // exit same day only if estimated net P&L after charges is positive
  squareOffEOD?: boolean;         // always square off EOD (bypasses no-loss gate)
}

```

### Type Helpers

Always use the helper functions — never cast `strategy.params as any`:

```typescript

import { asDipParams, asMomentumParams } from '@/lib/strategyConfig';

const params = asDipParams(strategy);       // asserts DipParams, throws if wrong type
const params = asMomentumParams(strategy);  // asserts MomentumParams, throws if wrong type

```

---

## 10. Key Patterns and Rules for AI Assistants

These rules come from hard-won experience. Follow them exactly.

### Build / Type-Check

- **Never run `npm run build` while the dev server is running** — it conflicts with the Next.js dev process.
- For type-checking only: `npx tsc --noEmit`

### UI / Buttons

- **Never hide action buttons** — gate by disabling in place with a `title` tooltip. Use the HTML `disabled` attribute + `title` attribute. Do not use conditional rendering to hide buttons.

### Watchlist Keys

- **Watchlist keys (`listA`, `listB`, `list3`, …) are immutable** — they never change. Only `meta.name` is editable. Never rename, reassign, or generate new keys.

### Local Dev

- **`STATE_FILE_PATH` must be unset on local dev** — if set, Kite OAuth crashes with ENOENT because the EC2 path doesn't exist locally.

### Config vs. Code Bugs

- For env/config-shaped bugs: ask which `.env` block was edited before adding code defenses. The bug is usually a misconfigured env var, not missing null-checks.

### Design Conversations

- For design conversations: discuss and confirm approach before writing any code, making edits, or showing implementation plans.

### Journal Entries

- Always use `journalOrder()` helper in `lib/journal.ts` — it derives `strategyId` from the Kite order `tag` field.
- For manual SELLs with a known strategy (from `reconcileManualSells`), pass explicit `strategyId` + `source: 'manual'` to `journalOrder()`.

### Tag Consistency

- **Positions store is the single source of truth.** Do not override strategy tags using Kite order tags for settled holdings — it creates inconsistency between pages.
- OOS = truly unknown. Closed known trades should resolve through journal attribution, not stale open-position rows.

### Sector Concentration Gate

- `maxPerSector` is a `DipParams`-only field. Do not add it to `MomentumParams`.

---

## 11. Environment Variables

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

**Local dev:** Copy `.env.example` to `.env.local`. Do NOT set `STATE_FILE_PATH`.

---

## 12. Deploy Runbook

### Production deploy (EC2)

```bash
cd ~/dineshtrade
git pull
rm -rf .next
npm ci
NODE_OPTIONS="--max-old-space-size=2048" npm run build
pm2 restart dineshtrade --update-env

```

Notes:

- `rm -rf .next` avoids stale Next build artifacts such as missing compiled route modules.
- `npm ci` keeps deploys reproducible from `package-lock.json`.
- `pm2 restart dineshtrade --update-env` is the correct command for an existing app. Do not use `pm2 start npm --name dineshtrade -- start` on every deploy, or you can create duplicate PM2 entries.

### Type check only (safe while dev server is running)

```bash

npx tsc --noEmit

```

### Data directory

`~/dineshtrade/data/` — **never touched by deploy**. Contains all runtime state. Back up before any destructive operation.

### PM2 commands

```bash

pm2 status            # check process state
pm2 logs dineshtrade  # tail logs
pm2 restart dineshtrade --update-env  # reload with new env vars

```

---

## 13. Recent Changes (June 2026)

### T+1 Settlement Fix (01 Jun 2026)

`KiteHolding` now has a `t1_quantity` field. `buildLiveQtyBySymbol()` in `lib/kite.ts` computes live qty as `quantity + t1_quantity`. Prevents day-1 CNC positions from appearing OOS on the Holdings page — they transition from T0 positions → T+1 holdings → settled holdings without losing their strategy tag.

### Manual Sell Strategy Attribution (01 Jun 2026)

`reconcileManualSells()` in `lib/cronReconcile.ts` now journals the SELL entry with:

- `strategyId` = the buying strategy (from positions store)
- `source: 'manual'`
- Positions store entry is removed after the manual SELL is journaled, preventing stale strategy ownership from leaking into later re-buys.

### Journal Fix-Attribution Button (01 Jun 2026)

Settings → Journal Maintenance → "Fix Journal Attribution" button. Calls `POST /api/journal/fix-attribution`. Retroactively patches old `dt-manual` SELL entries that are missing `strategyId` — looks up each entry's symbol in the positions store and backfills the tag.

### Holdings Avg for Closed Positions (01 Jun 2026)

T0 rows with `qty = 0` (sold today) now display `average_price` from the holdings endpoint (buy cost), not from Kite's position `average_price` (which is the sell execution price). Makes the displayed avg consistent with the "what did I pay" view.

### Journal Strategy Fallback (01 Jun 2026)

`/api/positions` and `/api/strategy/positions` both fall back to `getJournalStrategyFallback()` in `lib/journal.ts` when a symbol is not found in the positions store. Reads last 30 days of auto-BUY journal records and returns the most recent `strategyId` for each symbol. Prevents OOS false positives after positions store cleanup.

### Codebase Refactor (01 Jun 2026)

- `cron.ts` split into `cronState.ts` / `cronBuy.ts` / `cronEOD.ts` / `cronReconcile.ts` / `cron.ts` (orchestrator) — eliminates circular dependencies
- `strategyTag.ts` — new file, centralises `resolvePositionTag()` logic used across all API routes
- `buildLiveQtyBySymbol()` — extracted to `lib/kite.ts`, handles `quantity + t1_quantity`
- `getJournalStrategyFallback()` — new export in `lib/journal.ts`
- `StrategyParams` typed as `DipParams | MomentumParams` — `asDipParams()` / `asMomentumParams()` helpers enforce correct access pattern; eliminates all `params as any` casts

---

Technical handoff document — June 2026.
