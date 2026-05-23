# DineshTrade — Project Context

**Last Updated:** 23 May 2026
**Version:** 1.4
**Purpose:** Single source of truth on who, what, and why. Upload to any new Claude session to bootstrap full context.

---

## 1. Who is Dinesh

**Dinesh Wadhwani** — Founder & CEO of StudioVerse (separate SaaS, unrelated).
**Location:** Pune, Maharashtra, India
**Email:** dinesh.k.wadhwani@gmail.com (work: dinesh.wadhwani@nice.com)

---

## 2. Trading Background

Trading Indian equities since FY2020 across 4 family accounts plus ~10 friends/family informally.

### Family Accounts
| Name | Relation | Broker | Account No | Status |
|---|---|---|---|---|
| Dinesh Wadhwani | Self | Motilal Oswal | 2180536 | Primary |
| Kiran Wadhwani | Wife | Motilal Oswal | 4180283 | Active |
| Sheela Wadhwani | Mother | Motilal Oswal | 4432333 | Active |
| Sonia Wadhwani | Daughter | Zerodha | CJD607 | Active |

### Verified P&L (FY2020–FY2026)
| Account | Net Realised P&L | Best Year ROC |
|---|---|---|
| Dinesh | ₹7,28,820 | 17.5% (FY23-24) |
| Kiran | ₹27,68,752 | 20.8% (FY23-24) |
| Sheela | ₹19,35,215 | 11.1% (FY23-24) |
| Sonia | ₹4,96,373 | 2.2% (FY24-26) |
| **Total** | **₹59,28,726** | **FY23-24: ₹26.56L in one year** |

Win rate 94–100% in peak years. Brokerage paid 6 years: ₹4,89,748 (7.6% of gross). Sheela is the gold standard (96.6% win rate, 87-day avg hold). Bajaj Finance = ₹6.32L profit (best). Strides Pharma = ₹2.30L loss (worst, blocklisted).

---

## 3. Trading Philosophy

- Never short sell
- Never trade F&O
- Never sell at a loss — wait for recovery
- Buy blue chips on dips, they come back
- LIFO — last trade on each script must be profitable
- List A is config-locked — no impulsive UI adds

---

## 4. The Strategies (Multi-strategy Framework)

The original "two strategies" model evolved on 21 May into a **multi-strategy framework**. Each strategy is a JSON record in `data/strategy.json` with its own type, watchlist, exits, and handoff window. Two ship by default:

### Strategy 1 — "Accumulator" (Mean Reversion · permanent keeper)

*Renamed from "Oscillator" on 21 May 2026. Internal id: `accumulator`.*

- **Trigger:** Stock 5–8% below 20-day EMA + 3+ consecutive down days
- **Capitulation floor:** stocks > 12% below EMA are rejected as panic, not mean-reversion (configurable per-strategy via `capitulationFloorPct`)
- **Tranche 1 exit:** SELL 50% when LTP ≥ entry × (1 + t1Pct/100)
- **Tranche 2 exit:** SELL remaining 50% when LTP ≥ entry × (1 + t2Pct/100). No time stop.
- **When used:** "Dip mode" (gap-down days where GIFT Nifty < −0.5%) + reactive intraday drops
- **Structural role:** the **universal parking lot**. Every other strategy's position migrates here after its `deliveryHandoffDays` window expires, or when its source strategy is deactivated/deleted. Cannot itself be deactivated or deleted.

### Strategy 2 — "Catalyst" (Intraday momentum · default sibling)

*Internal id: `catalyst`.*

- **Trigger (momentum-based):**
  - Day gain between **+0.5% and +1.5%**
  - **3+ rising 5-min candles** in a row
  - Volume > prorated 10-day average
  - LTP within ±3% of 20-day EMA
  - Scan window: 9:30–14:30 IST
- **Exit T1:** entry × 1.015 → SELL 50% immediately
- **Exit T2:** entry × 1.020 → SELL remainder
- **Handoff:** if `firstBuyAt` age ≥ `deliveryHandoffDays` (default 15) the position's `strategyId` is re-stamped to `accumulator` — accumulator's EMA-based exits take over.
- **When used:** "Catalyst mode" (positive/flat days)

### Custom strategies (user-created)

Users can create additional **dip** or **momentum** strategies via Settings → Strategies (e.g. "quickwin" with T1=1.0%, T2=1.2%, handoff=5d). Each gets its own `dt-<id>` order tag, its own row in `data/positions.json`, and its own monitor params. Universal parking lot is hard-coded to `accumulator` — any custom strategy's positions flow there on expiry/deactivate/delete.

### Market Mode
| GIFT Nifty | Mode | Engine |
|---|---|---|
| Positive / flat | Catalyst | Strategy 2 |
| Gap-down < −0.5% | Dip | Strategy 1 (Accumulator) |
| −5% or worse | Circuit | No trades |

---

## 5. Hard Stop Rules (10 Preflight Gates)

Every order (auto or manual) passes through `runPreflight()`. Gates fire in order; first failure short-circuits with `{ ok: false, gate, reason }`.

1. **Token** — Kite access token must be valid
2. **Market open** — 9:15–15:30 IST, weekdays, non-holiday
2b. **Intraday circuit** — *(auto-BUY only)* live NIFTY 50 vs today's open. Trips when drop ≤ `intradayCircuitTripPct` (default 0 = disabled). Hysteresis resume at `intradayCircuitResumePct`. Doesn't block exits or manual orders.
3. **Per-trade cap** — order value ≤ ₹5,000 (auto only; manual bypasses)
4. **Idempotency** — one BUY per `${account}:${date}:${symbol}` (auto only)
4b. **Panic-sell** — *(auto-BUY only)* per-symbol drop from peak in last N min (from 5-min candles). Default 0 = disabled. Once tripped, the symbol joins `state.panicSkipList[today]` and is blocked for the rest of the IST day. Persists across restarts.
4c. **Pyramid** — *(auto-BUY only)* max BUYs per symbol + minimum drop between consecutive BUYs.
5. **Day quota** — max 3 BUYs / 3 SELLs per day per account (auto only)
6. **Position cap** — max 10 open positions per account (BUY only)
7. **Funds** — live margin check before BUY (BUY only)
8. **No-short** — fetch live held qty, clamp SELL to held, never short
   - Also: **No-loss-sell** rider — Auto SELLs never fire if LTP < entry. Manual SELLs are exempt — user judgement.

Manual trades bypass gates 2b, 3, 4, 4b, 4c, 5 (rate-limit + auto-only safety gates). Gates 1, 2, 6, 7, 8 always apply.

**The GIFT-Nifty pre-market circuit** lives at the `capital.circuitBreakerPct` level (default −5%): if GIFT Nifty drops that much pre-market, `generateRecommendations()` short-circuits with `mode: 'circuit'` and no BUYs scan that day. Separate from gate 2b which is live intraday.

**StopLoss removed (21 May 2026):** earlier UI surfaced an "SL" reference field on Engine recommendations. Removed because no auto-SELL ever fires below entry (no-loss-sell rider) — the number was misleading.

Total corpus: ₹50,000. CNC + MIS supported. NSE only.

---

## 6. Connected Accounts (Zerodha Kite)

App supports **multi-account** via env-var prefix:

```
ZERODHA_ENVIRONMENT=PROD          # or TEST
ZERODHA_ACCOUNT1=DINESH
ZERODHA_ACCOUNT2=SONIA
PROD_ZERODHA_API_KEY_DINESH=...
PROD_ZERODHA_API_SECRET_DINESH=...
PROD_ZERODHA_API_KEY_SONIA=...
PROD_ZERODHA_API_SECRET_SONIA=...
```

Token refresh is **daily** — user clicks "Login with Kite" each morning, OAuth redirect handles `request_token` → `access_token` via `/api/zerodha/callback`.

Plan: **Kite Connect ₹500/month** per account (needed for live `/quote` + historical data — EMA computation, momentum scan).

---

## 7. Watchlist (Named Multi-List)

The seed lists are derived from 5 years of actual trade history:

- Traded only once: excluded
- Not traded since May 2024: excluded
- STAR (Strides Pharma): manually blocklisted
- Top 75% by frequency → **List A** (84 stocks)
- Bottom 25% → **List B** (29 stocks)

Top List A: BAJFINANCE (91), TMPV (81), RELIANCE (74), BIRLACORPN (62), TATASTEEL (60), MARUTI (53), INDUSINDBK (50), BAJAJ-AUTO (46), JSWSTEEL (45), M&M (44).

### Schema (21 May 2026 — named-list refactor)

`config/watchlist.json` seeds + `data/watchlist.json` overrides:

```json
{
  "meta":  { "listA": { "name": "List A" }, "listB": { "name": "List B" } },
  "lists": { "listA": [...], "listB": [...], "list3": [...] }
}
```

- **Stable internal keys** (`listA`, `listB`, `list3`, …) — never change, so renaming a list never touches `strategy.json`.
- **Editable display names** in `meta[key].name` (max 40 chars).
- **N lists supported** — create / rename / delete from `/manage-lists`. Listed default symbols seed `listA` and `listB`.
- **Same symbol can live in multiple lists** (e.g. BAJFINANCE in both "Top Volume" and "Dip Candidates"). Strategies dedupe by NSE symbol at scan time.

### Strategy ↔ list linkage

Each strategy carries a `watchlist: string[]` of internal keys it scans. Settings → Strategies → Watchlist multi-select shows display names but stores keys. The engine flat-maps and dedupes across selected lists per scan tick.

### Delete safety

`listA` and `listB` cannot be deleted (always-on pair). Any other list refuses delete with 409 if any strategy's `watchlist` array references its key — user must unhook from Settings first.

---

## 8. Current Build Status — 20 May 2026

### Phase 1 (complete)
- Next.js 14 App Router scaffold, Obsidian Gold theme (Cormorant Garamond serif + Outfit body + JetBrains Mono numbers)
- Time-based login (`ddmmyyyyhh` IST, hourly rotation, midnight session expiry)
- All pages built: Dashboard, Watchlist, Engine, Holdings, Positions, Today's Orders + Retrospective, Trade Report, Settings
- AppShell with top nav + mobile bottom nav
- Multi-account architecture (env-prefix pattern)
- Login with Kite OAuth flow + daily token persistence
- State backed by cookie (local dev) or file (`STATE_FILE_PATH` on EC2)

### Phase 2 (complete)
- AI provider abstraction (Anthropic / Gemini / Groq / OpenAI) — flip via `AI_PROVIDER` env
- Morning market briefing on Dashboard (cached, USE_MOCK_MARKET toggle for dev)
- Strategy 1 (oscillator) — full EMA computation, two-tranche SELL monitor, persistent `strategy1.json` registry
- Strategy 2 (catalyst) — momentum signal with 3-rising-candle + volume + EMA filters; intraday SELL monitor; 15:00 IST handoff to Strategy 1
- Cron orchestration via `node-cron` (Asia/Kolkata, gated by `CRON_ENABLED=true`):
  - Tick every 5 min, 9:15–15:30 IST weekdays — runs S1 + S2 monitors; first dip-mode tick of the day runs the BUY scan
  - 15:35 IST — daily retrospective email + monthly rollup on last trading day
- 8 preflight gates including live-held-qty `noShort` with auto-clamp
- Watchlist live LTPs via batched `/quote`, red/green colouring
- Manual Buy/Sell modal on Watchlist + Holdings (and now Positions) — bypasses rate-limit gates, tagged `dt-manual`
- OOS (Out Of System) badge on Holdings — pre-existing positions never auto-managed

### Phase 3 — built on 18–19 May 2026 (this thread)
- Journal system (`lib/journal.ts`) — append-only JSONL at `~/dineshtrade/data/journal-YYYY-MM.jsonl`. Two record types: `trade` (completed BUY+SELL pair with verdict + day high/low + left-on-table) and `signal_skipped` (auto-mode BUYs blocked by preflight). Writes hooked in: strategy1 tranche exits, strategy2 SELLs, cron auto-BUY rejections. Never wiped by deployments.
- Daily retrospective (`lib/retrospective.ts`) — `buildDailyReport(date)`: enriches today's trades with live Kite OHLC (final day-high / left-on-table reflect full session), classifies missed signals as `good_miss` vs `missed_opportunity` by EoD close, computes 30-day rolling stats (win rate, avg gain, capital efficiency, delivery open), generates up to 3 fine-tuning bullets from heuristics.
- Strategy 1 backtest (`lib/backtest.ts`) — replays the Accumulator rules on historical daily candles for the last N trading days (default 60), using next-day opens for entries and the strategy's saved T1/T2 percentage exits from entry price, plus per-trade capital sizing, position caps, and an equity curve. Exposed via `POST /api/strategy/backtest`.
- Settings now has a dedicated **Backtest** tab beside **Strategies**. It loads all saved strategies into a dropdown, accepts a trading-day lookback, runs the authenticated backtest API, and renders summary, trades, and equity curve on the same page. Dip strategies replay from daily candles; momentum strategies replay from 5-minute candles with same-page results.
- Real trade report (`lib/tradeReport.ts`) — reconstructs actual journaled BUY / SELL legs into the same `summary + trades + equityCurve` shape as the backtest report. It supports a From / To date range, optional account and strategy filters (including Manual), carries pre-range open positions forward so in-range exits stay linked to the original BUY row, and marks open rows at the selected To date. Exposed via `POST /api/trade-report` and rendered on the new top-level `/trade-report` page.
- Monthly rollup (`buildMonthlyReport`) — totals, best/worst trades, avg daily return, signals missed, optional recommendation.
- Email HTML — Obsidian Gold inline-styled tables for `daily_report` + `monthly_report`. Plain-text fallback included.
- Cron retrospective at 15:35 IST with three skip rules: not a market day, SMTP unconfigured, no activity (zero trades AND zero signals).
- New in-app `/trades` page — tabbed: "Today's Orders" (existing live Kite order log) and "Retrospective" (date-picker dropdown of all journal dates, renders the same `DailyReport` payload the email uses).
- New API: `GET /api/journal/dates` and `GET /api/journal/[date]`.
- New `/positions` page — joins Kite `/portfolio/positions` with today's `/orders` to enrich each row with a strategy tag (S1 / S2 / Manual / OOS / Mixed). Header strip: Open Positions · Capital · Unrealized · Day P&L. Each row: Symbol + tag pill + product (CNC/MIS) + qty + avg + LTP (with % change) + stacked P&L (unrealized + realized) + **Square Off** action button.
- Square Off — opens OrderModal pre-filled with SELL · held qty · matching product (MIS/CNC) · MARKET · LTP. Manual override of auto: after fill, S1 monitor's noShort gate removes the symbol from `strategy1.json`; S2 monitor's `qty <= 0` branch skips. Same `dt-manual` tag path.
- "Today's Positions" nav item added between Holdings and Today's Orders.

### Phase 5 — built on 20–21 May 2026

#### Unified position store + universal parking lot

- New `lib/positions.ts` — single store at `data/positions.json` keyed by `(account, symbol)` with a **`strategyId`** field on every row. One-shot migration on first load: legacy `strategy1.json` rows stamp `strategyId: 'accumulator'`; `strategy2_positions.json` rows stamp `strategyId: 'catalyst'`. Old files renamed `.migrated` (recoverable).
- **Per-strategy exit profiles** — both monitors look up `getStrategyById(pos.strategyId)` per loop iteration and use *that* strategy's T1/T2 + handoff window. Custom strategies (e.g. "quickwin") get their own exits at runtime, not the catalyst default.
- **`accumulator` is the universal parking lot** — every momentum strategy hands off here when `deliveryHandoffDays` elapses; deactivating / deleting any other strategy migrates its open positions to accumulator via `migrateStrategyId(from, 'accumulator')`. Settings UI protects accumulator's Active toggle + Delete button; API refuses payloads where accumulator is missing or inactive.
- **Strategy rename** — `oscillator` → `accumulator` across config seed, code literals, type unions, journal `StrategyTag`. Runtime migration in `lib/strategyConfigStore.ts:getRuntimeStrategyConfig()` rewrites legacy `data/strategy.json` entries on first read.
- **Tile-BUY tag scheme** — Engine page tile BUY (and rec-card Execute) tags Kite orders as `dt-${strategy.id}` instead of legacy `dt-s1` / `dt-s2`. `/api/zerodha` parses the tag → `strategyId` and routes to `positions.recordBuy()`. Legacy tags still understood for back-compat.
- **Positions page tag pill** — `PositionTag` shape is now `{ kind, strategyId?, label, color }`. Rendered from each strategy's display name + color (driven by the store's `strategyId`, falling back to order-tag inference for legacy / OOS rows).

#### New preflight gates

- **Intraday circuit** (`lib/intradayCircuit.ts`) — live NIFTY 50 vs today's open. Hysteresis trip/resume. Module-level state machine. 30 s quote cache; holds last-known state if quote fetch fails. Capital fields `intradayCircuitTripPct` + `intradayCircuitResumePct`.
- **Panic-sell** (`lib/panicSell.ts`) — per-symbol peak-to-current drop in last N minutes from the 5-min candle cache. Tripped symbols join `state.panicSkipList[YYYY-MM-DD]` (persistent) and short-circuit all subsequent auto-BUYs that day. Capital fields `panicDropPct` + `panicWindowMin`.
- **Capitulation floor enforced in BUY scan** — `runStrategy1` + `runReactiveDipScan` reject `dev < −capitulationFloorPct`. Previously this was a tile-display-only filter.

#### Engine improvements

- **Disk-backed daily-closes cache** (`lib/dailyCloses.ts`) — replaces the morning 60-day-per-symbol historical re-fetch with an incremental "fetch yesterday's bar only" path. Persistent `data/daily-closes.json`, max 60 entries per symbol, atomic write. Cold-start writes full window; subsequent days do single-bar appends. Logs `[dailyCloses] refresh — cold:X incremental:Y failed:Z skipped:W`.
- **Engine tile labels driven by live config** — per-strategy params (`entryBelowPct`, `reactiveDrop`, `capitulationFloorPct`, etc.) and capital fields (`perTrade`, `maxPositions`) flow into the rule labels + checks on tiles. Previously many were hardcoded.
- **T1 quantity handling** — Kite's holdings split `quantity` (settled) vs `t1_quantity` (bought today, in T+1 settlement). Holdings totals, Dashboard P&L, /api/capital, retrospective open positions, and tile holdings now sum both.
- **StopLoss field removed** — `Recommendation.stopLoss` dropped from interface, scan paths, email template, Engine rec card, /api/zerodha enrichment.
- **AI briefing prompt rewrite** — switched from literal example values (which Gemini was echoing back daily) to placeholder syntax (`<index_level>`, `<NSE_TRADINGSYMBOL>`) with explicit "do not echo placeholders" instruction.

#### Journal as daily diary

- New journal type **`OrderRecord`** (`type: 'order'`) — every successful Kite order writes one (manual + auto, BUY + SELL). `journalOrder()` helper in `lib/journal.ts`; called from `/api/zerodha`, cron auto-BUY, strategy1 tranche SELLs, strategy2 SELLs.
- **`listJournalDates()` returns the trading-day calendar** (last 60 days, weekdays minus NSE holidays) UNION journaled dates. Today shows up immediately, every past trading day appears in the dropdown.
- **15:35 retrospective always sends** on trading days — the "skip if no activity" rule is gone. Zero-trade days still send the diary.
- **Retrospective uses journal for past dates** — `buildLiveSnapshot()`'s Activity Today reads `type: 'order'` records when `date !== today`; Kite `/orders` (session-scoped) only when today.

#### Multi-list duplicate membership

- A symbol can now live in multiple lists simultaneously. Manage Lists' add-button rejection narrowed to "already in *the target* list". API POST stopped its cross-list dedupe (was "listA wins"). Strategy engine dedupes the scan universe by NSE symbol at flat-map time.

### Phase 4 — built on 19–20 May 2026 (this thread)

- **Retrospective expansion** — the daily report now answers "what actually happened today" instead of just "how did the round-trips go". Five new sections on top of the trade-by-trade view: live Kite **Activity Today** (every order, not just closed pairs), **Open Positions** (with strategy source + pyramid status), **Capital Status** (deployed / available / circuit breaker), and **Per-Strategy Health** cards. Strategy Health surfaces the kind of "this strategy hasn't fired in 15 days — something is wrong" insight the old report couldn't.
- New journal record type **`strategy_scan`** — `lib/cron.ts` writes one per strategy scan with `{ strategyId, recs, executed, symbols?, skipReason? }`. Powers Strategy Health by giving the retrospective an authoritative ground truth for "did this strategy run at all today?".
- New retrospective helpers in `lib/retrospective.ts` — `buildLiveSnapshot()` (parallel Kite orders/holdings/positions/margins → activity + open positions + capital), `buildStrategyHealth()` (30-day rolling: scans, signals, executions, last-signal date; flags inactive / no-scans-30d / no-signals-15d / scans-but-no-signals).
- **Named watchlists** — replaced the hardcoded `listA` / `listB` pair with a generic `{ meta, lists }` shape supporting N user-named lists. Schema keys remain stable (`listA`, `listB`, `list3`, `list4` …) so renaming a list never touches `strategy.json` — zero regression risk for running strategies. The Manage Lists page now supports create, in-place rename, and delete (delete blocked if any strategy references the list); the move-between-lists button is gone. Watchlist page tabs are now driven by `meta`. Strategy editor in Settings shows a multi-select of all lists by their display name.
- **UI polish — mobile** — Watchlist row collapses to `B`/`S` buttons + drops the unused Trades column. Positions row redesigned as a 3-line two-column card (symbol/avg/qty left, P&L/LTP/SQ button right) matching the Kite app's density. Today's Orders shows `B`/`S` for side and ✓ / ✗ / C / · glyphs for status instead of raw `COMPLETE` / `REJECTED` / `CANCELLED` text.
- **Market-hours UI gate** — Buy / Sell / Square Off buttons across Watchlist, Holdings, Positions, and Engine are always visible but **disabled** outside NSE hours (with a "Market closed" tooltip). A 60-second `setInterval` re-evaluates `isMarketOpen()` so buttons auto-enable at 9:15 / disable at 15:30 without a refresh.
- **Header polish** — hid the horizontal scrollbar inside the persistent LiveTicker strip via a scoped `.ticker-strip` CSS class (only WebKit horizontal scrollbar was un-styled, producing a chunky gold half-band on mobile when the ticker content overflowed).
- All changes pass `tsc --noEmit` and `npm run build`. No schema migration script needed — `lib/watchlistStore.ts:normalize()` reads both legacy top-level `listA`/`listB` and the new `lists` shape.

---

## 9. What's NOT Built (Deferred)

- Morning report **email** — Dashboard shows the briefing on visit, but no scheduled email send. User opted out (19 May).
- Other-people accounts (Himanshu, Shilpa, Nikhil, Narendra, Kartik, Pankaj, Dolly, Manpreet, Pooja) — V2.
- F&O — out of scope, ever.
- Mobile push notifications — V2.
- Manual override toggle UI in Settings (auto-mode currently overridden implicitly via Manual mode + manual orders).
- Deeper what-if tooling against unsaved strategy drafts — V2. Current scope includes the Settings Backtest UI plus saved-strategy replay for both dip and momentum strategies.
- TMPV demerger reconciliation in Holdings P&L (cosmetic; not blocking).

---

## 10. Deployment

- **Vercel dropped** mid-Phase 2 — EC2-only now (state needs filesystem persistence, cron needs long-lived process).
- **EC2:** Ubuntu, PM2 keeps Node alive. Elastic IP `3.111.255.172`. Domain: `dineshtrade.online`.
- State + journal lives at `~/dineshtrade/data/` — file mode `0o600`, never wiped by deploys.
- Cron registers via Next.js `instrumentation.ts` (requires `experimental.instrumentationHook: true` in 14.x).

See `docs/technical-specification.md` for the full deploy runbook.

---

## 11. Config + Data Files

```
config/                         # ships in repo; bundled seeds
  watchlist.json    Default lists — { meta, lists: { listA, listB } } shape
  accounts.json     Display metadata (name, broker, accountNo, colour, isTrading)
  strategy.json     Capital block + strategies array (accumulator, catalyst, ...)
  holidays.json     NSE holiday list 2026

~/dineshtrade/data/             # runtime overlay on EC2; never wiped by deploys
  state.json                Runtime: tokens, mode, idempotency ledger, buyHistory,
                            panicSkipList
  strategy.json             Runtime overlay of config/strategy.json (Settings saves
                            land here; merged on read by strategyConfigStore)
  watchlist.json            Runtime overlay of config/watchlist.json (Manage Lists
                            saves land here; merged on read by watchlistStore)
  positions.json            Unified open-position store, one row per
                            (account, symbol) with `strategyId`
  daily-closes.json         Rolling 60-day daily-close cache per symbol
                            (incremental fetch each morning)
  journal-YYYY-MM.jsonl     Append-only diary: trade / signal_skipped / strategy_scan
                            / order records
  strategy1.json.migrated   ← legacy (Phase 2/3); migrated into positions.json
  strategy2_positions.json.migrated   ← legacy; migrated into positions.json
```

---

## 12. Reference

- **Functional spec:** `docs/functional-specification.md` — broken into epics, captures the nuances (preflight order, manual override behaviour, journal verdict classification, etc.)
- **Technical spec:** `docs/technical-specification.md` — stack, architecture decisions, infra, build & deploy runbook

---

*DineshTrade v1.4 — Built with Claude — May 2026*
