# DineshTrade — Functional Specification

**Version:** 1.4 · **Last Updated:** 23 May 2026

This spec documents the *user-visible* behaviour: what the app does, when, and why. Each epic is independently shippable. Nuances and edge cases are listed inline because they are where the value (and the risk) lives.

---

## Epic 1 — Authentication & Access Control

**Goal:** Single-user app, no signup flow, but secure enough that a stolen URL won't trade for someone else.

### F1.1 — Time-based password login
- Password format: `ddmmyyyyhh` in IST. Example: 19 May 2026 at 14:00 IST → `1905202614`.
- Password rotates **hourly**. Last hour's password is rejected (no grace window).
- Login form shows the current IST date/time on the page so the user can compute the password without a separate clock.

### F1.2 — Session lifetime
- Successful login mints a **JWT in a cookie** (`dt_session`), signed with `SESSION_SECRET`.
- Session expires at **midnight IST**, not on browser close. Reopening the tab the next morning forces a fresh password.
- Explicit **Logout** button kills the cookie immediately.

### F1.3 — Route protection
- Edge middleware enforces auth on every `/` route except `/login`, `/api/auth`, and Kite OAuth callbacks.
- Unauthenticated requests get a 307 redirect to `/login`. API routes that need auth verify the cookie directly (not relying on middleware in case middleware misses an exception).

### Nuances
- Hourly rotation means anyone watching your screen at 14:59 can't reuse the password at 15:00. Trades after a session steal are still gated by Kite OAuth (separate token), so the blast radius is bounded.
- The session cookie is `HttpOnly` + `Secure` + `SameSite=Lax`. No CSRF token because there's no other writer.

---

## Epic 2 — Zerodha Multi-Account Connection

**Goal:** Connect 1–N Zerodha Kite accounts. Each one is an independent trading surface; the app fans out scans, orders, and monitors across all connected accounts.

### F2.1 — Account configuration
- Accounts are declared via env vars enumerated by `ZERODHA_ACCOUNT1`, `ZERODHA_ACCOUNT2`, ... up to N.
- Per-account secrets live under `${ZERODHA_ENVIRONMENT}_ZERODHA_API_KEY_${name}` and `${...}_ZERODHA_API_SECRET_${name}` (e.g. `PROD_ZERODHA_API_KEY_DINESH`). `ZERODHA_ENVIRONMENT` flips between `PROD` and `TEST` apps.
- `config/accounts.json` carries display metadata (full name, colour, initials, note).

### F2.2 — Daily token via "Login with Kite"
- Settings page shows a per-account **Login with Kite** button. Clicking opens Kite's OAuth flow.
- Kite redirects back to `/api/zerodha/callback?request_token=...&action=...`. The app trades the `request_token` for an `access_token` via Kite's `/session/token` endpoint, then stores `{ apiKey, accessToken }` in `state.kiteTokens[accountName]`.
- Tokens expire daily (Kite mandate) — user must repeat the OAuth flow each morning.

### F2.3 — Account selection
- Settings has a `selectedAccounts: string[]` — the subset of connected accounts on which **auto** mode is allowed to trade.
- Manual orders can target any connected account regardless of `selectedAccounts`.

### Nuances
- TEST vs PROD: the `ZERODHA_ENVIRONMENT` prefix lets you run a sandbox app side-by-side with the real one without renaming any code.
- If a user has multiple Kite apps inside one account (e.g. Dinesh has two), each app is its own `ACCOUNTn` entry — the human is the same but the API surface is separate.
- Token state is the single source of truth for "connected" — if the server restarts, persistent state on disk preserves the connection (see Epic 9).

---

## Epic 3 — Watchlist & Holdings

**Goal:** Two slices of "stocks I care about today": the curated config-locked watchlist + whatever the broker actually holds.

### F3.1 — Editable Named Watchlists

- Two default lists ship with the seed: **List A** (~84 stocks, derived from 5 years of trade history) and **List B** (~29 stocks). Both are renamed in place from the Manage Lists page.
- Users can create additional lists ("Dip Candidates", "Penny Watch", etc.) from Manage Lists. There is no fixed cap on list count.
- Each list has a **stable internal key** (`listA`, `listB`, `list3`, `list4` …) plus a user-editable **display name**. Strategies reference lists by key, so renaming a list never affects which symbols a running strategy scans.
- Edits go live immediately — no redeploy. Saves write to `~/dineshtrade/data/watchlist.json`; cron and engine read this on every tick.
- See Epic 12 for the full Manage Lists UX. Watchlist page UI itself is read-only: dynamic tabs (one per list), search filter, batched live LTPs, green/red colouring.

### F3.2 — Holdings page
- Lists Kite holdings (multi-day positions held via CNC) for the active account tab.
- Joins with `/api/strategy/positions` to label each row:
  - **S1 (gold)** — managed by Strategy 1 (tracked in `strategy1.json`)
  - **OOS (gray)** — Out Of System; pre-existing or hand-entered, **never** auto-managed
- Each row has Buy and Sell buttons that open the universal OrderModal.

### F3.3 — OrderModal (used across Watchlist, Holdings, Positions)
- Fields: account, side (BUY/SELL), quantity, product (CNC/MIS), order type (MARKET/LIMIT), limit price.
- Sends `manual: true` + `tag: 'dt-manual'` → bypasses rate-limit gates (per-trade cap, idempotency, day quota).
- Funds + no-short + market-open gates still apply.
- On SELL with partial holdings, auto-clamps to held qty.

### Nuances
- **OOS auto-classification:** done dynamically each render — no manual flag. Any holding not in `strategy1.json` is OOS, and auto-mode treats it as untouchable.
- **Funds-gate exemption for manual:** by design — the user wants to be able to buy with their own judgement, even above the auto-mode per-trade cap. The funds gate still prevents NSE rejection.

---

## Epic 4 — Strategies (the trading brain)

**Goal:** Two clearly-defined strategies, one for catalyst days, one for dip days. Each strategy owns its order tag, its monitor, and its journal.

### F4.1 — Strategy 1: The Accumulator (mean reversion)

*Renamed from "Oscillator" on 21 May 2026. Internal id: `accumulator`. The strategy also serves as the **universal parking lot** — every momentum strategy hands off to it after its `deliveryHandoffDays` window. Cannot be deactivated or deleted (see F4.5 below + Epic 13).*

Strategy 1 has **two trigger paths** — a once-per-day morning scan and a reactive intraday scan.

#### F4.1a — Morning scan
**Used when:** GIFT Nifty < −0.5% (dip mode). Runs once per day at the first dip-mode tick.
- **Entry filter:**
  - Stock 5–8% below 20-day EMA
  - 3+ consecutive down days (from historical daily candles only)

#### F4.1b — Reactive intraday scan
**Used when:** Always (regardless of market mode). Runs every **30 minutes** between **09:15 and 14:00 IST**.
- **Trigger:** Any List A stock down **≥3% from yesterday's close** intraday.
- **Re-evaluation:** Full Strategy 1 entry check on the triggered symbol, with one twist — today is **counted as a down day** for the consecutive-down-days check (since we already know the price has dropped ≥3%, today qualifies as down).
- **Why:** Catches single-stock capitulation moves that the morning scan would have missed because the stock hadn't dropped enough at 9:15 yet.
- **Mode-independence:** Fires on dip days, catalyst days, even flat days. A single-stock 3% intraday drop is a valid Strategy 1 entry signal in its own right.
- **Idempotency:** Shares the standard per-account+date+symbol BUY ledger with the morning scan — no symbol can fire twice in one day across both paths.

#### Exits + persistence (shared between both paths)
- **Two-tranche exit:**
  - **Tranche 1:** SELL 50% when LTP ≥ EMA
  - **Tranche 2:** SELL remaining 50% when LTP ≥ EMA × 1.03 (i.e. **EMA + 3%, no time stop**)
- **Order tags:** `dt-s1` (BUY), `dt-s1-t1` (tranche 1 SELL), `dt-s1-t2` (tranche 2 SELL)
- **Persistence:** every Strategy 1 BUY is recorded in `data/strategy1.json` with `{ account, symbol, qty, entryPrice, tranche1Done }`. Monitor re-hydrates from this file every tick, so positions survive restarts and span days.

#### Visibility
- **Auto mode:** cron places the BUY automatically (same `dt-s1` tag, same exit monitor).
- **Manual mode:** every Engine page Refresh runs both `generateRecommendations()` and `runReactiveDipScan()` in parallel and merges the results — so a reactive dip rec appears as a flagged recommendation alongside any catalyst/dip recs from the regular mode.

### F4.2 — Strategy 2: The Daily Catalyst (intraday momentum)
**Used when:** Catalyst mode (GIFT Nifty positive/flat). Scans every tick during 9:30–14:30 IST.

- **Momentum signal (replaced the original broker-rec filter):**
  1. Day gain between **+0.5% and +1.5%** (not too late, not too lazy)
  2. **3+ rising 5-minute candles** in a row
  3. Volume > prorated 10-day average
  4. LTP within **±3% of 20-day EMA** (not a runaway)
  5. Within the 9:30–14:30 IST scan window
- **Tranche exits (replaced 19 May):** T1 = entry × (1 + `t1Pct`/100), T2 = entry × (1 + `t2Pct`/100). T1 fires first, sells 50%. T2 fires later, sells remainder. Defaults: T1 = 1.5%, T2 = 2.0%. Both anchored to **first BUY price** (pyramid-aware).
- **Multi-day handoff (replaced the old 3:00 PM cutoff):** Strategy 2 keeps trying its T1/T2 every day until `firstBuyAt` age ≥ `deliveryHandoffDays` (default **15 calendar days**, per-strategy configurable). At handoff the position's `strategyId` is re-stamped to `accumulator` in the unified position store — accumulator's monitor takes over with EMA-based exits, no time limit.
- **Order tags:** `dt-catalyst` (BUY, new scheme), `dt-s2-exit` (SELL — legacy literal preserved for back-compat).

### F4.3 — Market Mode resolver
| GIFT Nifty | Mode | Engine |
|---|---|---|
| Positive / flat | Catalyst | Strategy 2 |
| Gap-down −0.5% to −5% | Dip | Strategy 1 |
| −5% or worse | Circuit | No trades (auto disabled) |

Mode is computed once per tick via `getMarketMode()`, cached briefly, and shown as a chip on the Dashboard + Engine page.

### F4.4 — Engine page
Two stacked sections — Recommendations (top) and Full Scan tiles (bottom).

#### Recommendations section (unchanged)
- "Refresh" button runs `generateRecommendations()` — dispatches by current mode.
- Each recommendation shows: symbol, price, T1, T2, stop loss, suggested qty (computed from per-trade cap), reason text, source.
- In **Manual mode**, each rec has an Execute button. In **Auto mode**, the cron is already firing them; the page is informational.

#### Full Scan tiles section
A richer UI layer over the **same** scan logic — no change to the underlying strategies or cron. Surfaces *every* List A stock as a tile so you can see **why** filtered-out stocks didn't make it to recommendations.

- **Two tabs:** Catalyst (Strategy 2) and Oscillator (Strategy 1). Default tab is determined by market mode — GIFT Nifty < −0.5% opens on Oscillator, otherwise Catalyst. User can switch tabs manually.
- **Per-tile content:** symbol + name, live LTP + today's % (▲/▼), per-rule checklist (8 rules with green ✓ / red ✗ / dim ○ for "not evaluated"), each row showing the actual measured value, score line `X / 8`, holding annotation (qty · avg · live P&L) when the account currently holds the stock.
- **Buttons:** every tile has a **BUY** button. The button styling reflects readiness:
  - Full score (e.g. 8/8) → **gold filled** background
  - Near-full (within 2 of max) → **amber outlined**
  - Below that → **dim grey outlined**
  - SELL button appears **only when the account holds the stock**.
- **Auto-fires badge:** in Auto mode, full-score tiles show a green `AUTO-FIRES` chip so the user knows the cron will pick it up.
- **Sort:** tiles sorted by score descending; within same score, alphabetical.
- **Auto-refresh:** every 5 minutes, plus on demand via the Refresh button.
- **Card border colour:** gold (full score), amber (near-full), dim (below).
- **Auto execution behaviour (unchanged from scan logic):** only stocks that pass all rules are auto-traded by the cron. Manual users can click BUY on any tile regardless of score — OrderModal opens pre-filled, all preflight gates still apply.

#### Catalyst rules (8)
1. Within scan window (09:30–14:30 IST)
2. Day gain ≥ +0.5%
3. Day gain ≤ +1.5%
4. ≥3 rising 5-min candles (evaluated only for stocks passing rules 1–3 + 6 + EMA; otherwise dim "not evaluated")
5. Volume > prorated 10-day average
6. LTP within ±3% of 20-EMA
7. Live quote + 20-EMA available
8. Per-trade cap configured

#### Oscillator rules (8)
1. Market open (09:15–15:30 IST)
2. 20-day EMA computable
3. LTP ≥ 5% below 20-EMA (stretched)
4. LTP ≤ 12% below 20-EMA (not panic zone)
5. Today ≥3% drop (reactive trigger — same threshold as the intraday scan)
6. Live LTP available
7. Per-trade cap configured
8. Position cap configured

### F4.5 — Multi-strategy framework + universal parking lot

*Built 20–21 May 2026. The "two strategies" model evolved into a generic N-strategy framework.*

- **Strategies live in `data/strategy.json` as records** with `{ id, name, type: 'dip' | 'momentum', active, scanIntervalMin, watchlist, params, exits, giftNiftyGate, color }`. Defaults seed accumulator + catalyst.
- **Per-strategy exit profiles** — both monitors look up `getStrategyById(pos.strategyId)` *per position* and use that strategy's own `t1Pct`/`t2Pct`/`deliveryHandoffDays`. A custom "quickwin" momentum strategy with T1 = 1.0% will actually sell at +1.0%, not catalyst's 1.5%.
- **Universal parking lot** — when any strategy's position ages past its handoff window (or its parent strategy is deactivated/deleted), the position's `strategyId` field is re-stamped to **`accumulator`**. The position itself stays put; only ownership transfers.
- **Accumulator is permanent** — UI disables its Active toggle + Delete button; `POST /api/strategies` refuses any payload where `accumulator` is missing or inactive. Hard-coded as the handoff target.
- **Order tag scheme** — Engine page tile BUY and Recommendation Execute now tag Kite orders as `dt-${strategy.id}` (e.g. `dt-quickwin`, `dt-accumulator`). Legacy `dt-s1` / `dt-s2` understood for back-compat but no longer emitted.
- **Position migration on deactivate/delete** — when user toggles a strategy inactive OR removes it from the strategies array, `migrateStrategyId(<id>, 'accumulator')` re-stamps every open position belonging to that strategy. Settings UI shows a confirmation dialog: *"Quickwin has 3 open positions. They will be moved to Accumulator on save. Continue?"*

### Nuances
- **Tranche 2 rule change:** originally "next day above EMA". Changed to "EMA + 3% same-day, no time stop" on user request (18 May 2026) — captures more upside on momentum names.
- **Why accumulator is hardcoded:** simplifies the mental model. Tactical strategies are siblings; the strategic mean-reversion strategy is the keeper everyone flows into. A config-driven handoff target would invite chained handoffs (`quickwin → deep_dip → accumulator`) that loop or surprise the user.
- **Strategy IDs are immutable** — Settings UI locks the `id` field after first save. Renaming requires delete-then-create (and a position migration to accumulator in the middle). Display names are freely editable.
- **Why strategy.json centralises thresholds:** so a config change (e.g. "raise T1 from 1.5% to 1.8%") doesn't touch code or trigger a redeploy code review.

---

## Epic 5 — Order Lifecycle & Preflight Gates

**Goal:** Every order — auto or manual — flows through one funnel. No bypasses.

### F5.1 — The 10 Gates (`runPreflight()`)

*Three new auto-BUY-only gates added 20–21 May 2026: intraday circuit, panic-sell, pyramid. Order matters; first failure short-circuits with `{ ok: false, gate, reason }`.*

1. **Token** — `state.kiteTokens[account]` exists and isn't expired
2. **Market open** — current IST time within 9:15–15:30, weekday, non-holiday per `config/holidays.json`
2b. **Intraday circuit** — *(auto-BUY only)* live NIFTY 50 vs today's open. Trips when `dropPct ≤ capital.intradayCircuitTripPct` (default `0` = disabled). Hysteresis: resumes when `dropPct ≥ capital.intradayCircuitResumePct`. Module-level state machine in `lib/intradayCircuit.ts`; holds last-known state if the Kite quote fetch fails (fail-safe held). Distinct from the pre-market `circuitBreakerPct` which gates on GIFT Nifty before market open.
3. **Per-trade cap** — `pricePerShare × quantity ≤ capital.perTrade` *(auto only; manual bypasses)*
4. **Idempotency** — persistent ledger in `state.idempotencyLedger` keyed by `${account}:${date}:${symbol}:BUY` *(auto only; manual bypasses)*
4b. **Panic-sell** — *(auto-BUY only)* per-symbol peak-to-current drop in the last `capital.panicWindowMin` minutes (read from the 5-min candle cache). Trips when `dropPct ≥ capital.panicDropPct` (default `0` = disabled). Tripped symbols join `state.panicSkipList[YYYY-MM-DD]` and short-circuit all subsequent auto-BUYs that IST day. Persistent across restarts.
4c. **Pyramid** — *(auto-BUY only)* per-symbol cap on consecutive BUYs accumulating into one position: `capital.maxBuysPerSymbol` (default 3), each subsequent BUY must be ≥ `capital.minDropBetweenBuysPct`% below the previous BUY price. History resets to fresh on sellout.
5. **Day quota** — max `capital.maxBuysPerDay` / `capital.maxSellsPerDay` per day per account *(auto only)*
6. **Position cap** — BUY only; auto + manual both gated. Max `capital.maxPositions` open positions per account
7. **Funds** — BUY only. Live `/user/margins` check; rejects if `available_cash < tradeValue`
8. **No-short** — SELL only. Fetches live held qty:
   - `held === 0` → reject with `gate: 'noShort'` (signal to monitors that the position was manually closed)
   - `held < requested` → **clamp**: return `adjustedQty: held`, allow order to proceed
   - **No-loss-sell rider:** Auto SELLs additionally reject if `ltp < entryPrice`. Manual SELLs are never blocked on this.

### F5.2 — Order placement path
1. Caller (cron, monitor, OrderModal, /engine Execute) builds the order intent
2. `runPreflight()` runs all 8 gates
3. If clamped, `adjustedQty` is used as the actual quantity
4. `placeKiteOrder()` posts to Kite `/orders/regular`
5. On success, `markPlaced()` updates the idempotency ledger and (for S1 BUYs) `recordStrategy1Buy()` persists to disk
6. Email fires (`trade_executed` or `trade_failed`) — fire-and-forget, never blocks the response

### F5.3 — Manual override of auto
- If the user manually closes a position via the Square Off button (or directly in Kite), the next auto-mode tick:
  - **S1 monitor:** noShort gate fires → S1 entry is removed from `strategy1.json`
  - **S2 monitor:** `qty <= 0` branch hits → entry is silently skipped
- No need for a "pause auto" toggle — manual actions naturally take precedence.

### Nuances
- **Why manual bypasses rate-limit gates:** they exist to prevent runaway auto-mode, not to second-guess the user. Funds + no-short still hold because those prevent broker-side rejection or shorting.
- **Why idempotency is BUY-only:** SELLs are managed by monitors that already track tranche state; idempotency on SELL would prevent legitimate partial closes.
- **Funds gate uses live margin, not state:** state is updated lazily, but the user can place a manual order any time. Always querying Kite ensures accuracy.

---

## Epic 6 — Cron Orchestration

**Goal:** Long-lived background work — strategy monitors, daily reports — runs reliably on PM2-managed EC2.

### F6.1 — Tick (every 5 min, 9:15–15:30 IST weekdays)
Cron expression: `*/5 9-15 * * 1-5` (Asia/Kolkata). Gated by:
- `state.mode === 'auto'`
- `isMarketOpen()` true
- At least one connected account in `state.kiteTokens`

Each tick does, in order:
1. **Strategy 2 SELL monitor** (`monitorAllConnected()`) — fires +1.5% exits or 3:00 PM handoffs
2. **Strategy 1 SELL monitor** (`monitorAllAccountsStrategy1()`) — fires tranche 1 / tranche 2 exits
3. **BUY scan** — only fires if mode is catalyst (every tick) or first dip-tick of the day. Otherwise no-op.

### F6.2 — Daily retrospective (15:35 IST weekdays)
Cron expression: `35 15 * * 1-5`. Skip rules (in order):
1. Not a market day → skip
2. SMTP not configured → skip
3. *(Removed 21 May)* — the "no activity → skip" rule is gone. The retrospective now functions as a **daily diary** and always sends on trading days even with zero trades. A zero-trade day still surfaces open positions, capital status, strategy health, and the manual-mode indicator.
4. Otherwise: `sendDailyReport(report)` — HTML email
5. **Additionally**, if `isLastWeekdayOfMonth(today)`: build + send `monthly_report` (skipped if month had zero activity)

> **Recovery if PM2 restarts after 15:35:** node-cron has no missed-fire replay. A deploy that completes after 15:35 IST means the cron task registers for the *next* day's 15:35. Users can still view the same report live at `/trades` → Retrospective → today.

### F6.3 — Gating env var
- `CRON_ENABLED=true` must be set; otherwise `startCron()` logs and returns. This prevents local dev from accidentally trading.

### Nuances
- **Why every 5 min instead of every minute:** Kite API rate limits, and Strategy 2's momentum signal doesn't need sub-minute resolution.
- **Why the BUY scan runs once a day for dip mode:** dip is a morning-only setup. The signal doesn't reappear intraday; re-scanning would just burn API quota.
- **Why monitors run *before* BUY scan in each tick:** so a position that hit T1 at 14:35 IST closes before the 14:35 tick considers a new BUY in the same symbol. Avoids accidental re-entry.

---

## Epic 7 — Journal & Retrospective

**Goal:** Every trade and every preflight-rejected signal goes in an append-only log. The log powers the EoD email AND the in-app Retrospective view.

### F7.1 — Journal storage (`lib/journal.ts`)
- Append-only JSONL files: `~/dineshtrade/data/journal-YYYY-MM.jsonl` (one per IST month)
- File mode `0o600`. Never wiped by deploys.
- Four record types:
  - **`trade`** — `{ type, date, account, symbol, qty, entryPrice, entryTime, exitPrice, exitTime, pnlRupees, pnlPct, dayHighAfterEntry, dayLowAfterEntry, leftOnTable, verdict, strategy, orderIdBuy?, orderIdSell?, notes? }` — completed BUY+SELL pair only
  - **`signal_skipped`** — `{ type, date, time, account, symbol, signalPrice, reasonSkipped }`
  - **`strategy_scan`** — `{ type, date, ts, strategyId, strategyName, recs, executed, symbols?, skipReason? }` — one record per strategy scan tick. Powers Strategy Health.
  - **`order`** *(added 21 May)* — `{ type, date, ts, account, symbol, side, qty, price, tag?, strategyId?, source: 'auto' | 'manual', orderId? }`. Written via `journalOrder()` on every successful Kite order — manual + auto, BUY + SELL. The retrospective uses these for "Activity Today" on past dates (Kite's `/orders` is session-scoped and rotates out).

### F7.2 — Where writes happen

- **Strategy 1 monitor** — after each tranche SELL fills: writes `trade` (entry+exit pair) AND `order` (raw single-leg)
- **Strategy 2 monitor** — after each SELL fills: writes `trade` AND `order` (with day high/low + left-on-table on the trade record)
- **Cron auto-BUY** — after success: writes `order`; on preflight rejection: writes `signal_skipped` with gate reason
- **`/api/zerodha` (manual + Engine Execute)** — after Kite confirms an order: writes `order` (any side, any tag)
- **Cron strategy task** — every scan, regardless of outcome: writes `strategy_scan`

### F7.3 — Verdict classification
At journal-write time, `classifyVerdict({ strategy, entryPrice, exitPrice, t1TriggerPct, isDelivery })`:
- `correct_exit` — gainPct ≥ T1 trigger − 0.05 (tolerance for fill slippage)
- `early_exit` — exited below T1
- `delivery` — Strategy 2 position taken to delivery at 3 PM
- `manual` — manual SELL (via OrderModal)

### F7.4 — Daily report (`buildDailyReport(date)`)

Hero (4 cards): **Orders Today** · **Open Positions** · **Deployed Today** · **Realized P&L**.

Sections (added 19–20 May 2026 to make the report useful on days with no closed round-trips):

1. **Activity Today** — every Kite order today (BUY / SELL, time, symbol, qty, price, strategy tag), not just closed BUY+SELL pairs. Answers "did anything happen today?" honestly even on partial-fill or open-position days.
2. **Open Positions** — every position still open at EoD, with its strategy source (S1 / S2 / Manual / OOS / Mixed), pyramid status (e.g. "BUY 2/3, next at ≥10% drop"), and S2 handoff countdown for S2-managed positions approaching the 15-calendar-day delivery cutoff.
3. **Capital Status** — deployed today / available / max-deployable / circuit-breaker headroom.
4. **Trade-by-trade** — closed round-trips with entry/exit/P&L, **enriched with live Kite OHLC** so final day-high / left-on-table reflect the full session, not just the moment of sale.
5. **Per-strategy health** — one card per strategy with 30-day counts (scans / signals / executions), last-signal date, and warnings:
   - `inactive` — strategy.active is false
   - `no scans in 30d` — cron task isn't firing (config or gating issue)
   - `no signals in 15d` — strategy scans but produces nothing (filter too tight, or the universe genuinely has no opportunities)
   - `scans-but-no-signals` — scans happen daily but signals are zero (likely filter issue)
6. **Missed signals** — `signal_skipped` records, classified post-hoc: `missed_opportunity` (signalPrice × 1.015 hit by EoD high), `good_miss` (wasn't hit), `unknown` (no OHLC).
7. **30-day rolling stats** — win rate, avg gain, capital efficiency, delivery open count.
8. **Fine-tuning bullets** — up to 3 heuristic-generated tips:
   - Avg left-on-table > 1.5% over last 10 wins → suggest raising T1
   - Missed-opportunity rate > 40% over today's skipped signals → check if filter is too tight
   - Win rate < 60% over 30 days → review entry criteria; > 85% → consider loosening filters

Skip rules now send if **any** of: trades, missed signals, today's orders, open positions exist. The old "skip if zero closed trades" rule was hiding days where BUYs happened but no SELLs.

### F7.5 — Monthly rollup (`buildMonthlyReport(date)`)
Fires on the last trading day of the month (after the daily report). Shows: total trades, win rate, total P&L, best/worst trade, avg daily return, signals missed, optional recommendation.

### F7.6 — In-app Retrospective tab

- `/trades` page has two top-level tabs: "Today's Orders" and "Retrospective"
- Retrospective tab: dropdown of dates (newest first), renders the same `DailyReport` payload the EoD email uses
- **Dropdown contents (updated 21 May)** — `listJournalDates()` returns the UNION of:
  - Every trading day in the last 60 calendar days (weekdays minus NSE holidays)
  - Every date with any journal record (preserves entries older than 60 days)
  - So today's date always appears, plus every recent trading day — even days with zero records.
- **Past-date rendering** — `buildLiveSnapshot()` reads journaled `order` records for any date that isn't today, instead of Kite's session-scoped `/orders` endpoint. Yesterday's manual trade shows up in yesterday's "Activity Today" section as long as the `order` record was written on placement.
- Powered by `GET /api/journal/dates` + `GET /api/journal/[date]`

### F7.7 — Trade Report page

- Separate top-level menu item: **Trade Report**, placed before **Settings** in the main navigation.
- Inputs: **From Date** picker, **To Date** picker, and **Run Report**.
- Filters: optional **Account** and **Strategy** selectors. Strategy filter includes **Manual** in addition to saved strategies.
- Output format intentionally mirrors the backtest report:
  - summary hero tiles
  - secondary metric tiles
  - detailed trade table
  - equity-curve table
- Data source is the append-only journaled order ledger, so both **manual** and **auto** trades are included.
- Rows are position-based, not sell-event-based. A row stays open after tranche 1 and shows `partial` until the remaining quantity exits.
- Carry-in rule: if a position was opened before the From date but exits partially or fully inside the window, it still appears and stays linked to the original BUY so the report does not produce orphaned SELLs.
- Open rows are marked at the selected **To Date**, allowing realized and unrealized MTM to be shown in the same shape as the backtest screen.

### Nuances
- **Why enrich with OHLC at report time, not write time:** at SELL time the day isn't over. EoD high may be higher than what we recorded. Enriching at 15:35 IST gives the user the "what would have been" honestly.
- **Why JSONL not JSON:** atomic append (one write syscall, never partial). No risk of corrupting earlier records on a crash.
- **Why monthly fires even if today's daily skipped:** today might be a flat day but the month had plenty of activity earlier.

---

## Epic 8 — Today's Positions (built 19 May)

**Goal:** A single page that answers "What's my actual exposure right now and what's it doing?"

### F8.1 — `/positions` page

- Multi-account tabs (one per connected account)
- Header strip: Open Positions count · Capital Deployed · Unrealized · Day P&L (incl. closed)
- **Desktop layout** — 12-column table:
  - Symbol + strategy tag pill (S1 gold / S2 blue / Manual purple / OOS gray / Mixed amber) + product chip (CNC / MIS)
  - Qty, Avg, LTP (with intraday %), stacked P&L (unrealized + realized today), Square Off button
- **Mobile layout (< sm breakpoint)** — Kite-style two-column 3-line card:
  - Left column: symbol (big) + tag pills, Avg ₹X, Qty N
  - Right column: P&L (big, coloured), LTP ₹X + today %, **× SQ** button
  - Header row hidden on mobile (cells carry inline labels)
- Closed-today rows are kept in the list but dimmed (so you can see what fired earlier today)
- Square Off button is always visible; disabled outside market hours per CB5

### F8.2 — Strategy tag derivation
*Updated 21 May 2026 — driven by the unified position store's `strategyId`, falling back to today's order-tag inference for OOS / Manual / Mixed cases.*

The `PositionTag` shape returned by `GET /api/positions` is now:

```ts
{ kind: 'strategy' | 'manual' | 'pre' | 'mixed', strategyId?: string, label: string, color: string }
```

Resolution order:

1. If `data/positions.json` has a row for `(account, symbol)` → `kind: 'strategy'`, `label` = strategy's display name (truncated), `color` = strategy's configured color
2. Else infer from today's filled-order tags for the symbol:
   - Single `dt-<strategyId>` (or legacy `dt-s1*` / `dt-s2*`) → `strategy` pill using that strategy's display name + color
   - Only `dt-manual` → `manual` (purple `MANUAL` pill)
   - No app tags → `pre` (grey `OOS` pill)
   - Multiple distinct strategies → `mixed` (amber `MIXED` pill)

The pill carries a tooltip naming the strategy id ("Owned by strategy: quickwin") so the user can quickly trace which strategy will manage the exit.

### F8.3 — Square Off action
- Click opens OrderModal pre-filled with: SELL · held qty · matching product (MIS or CNC) · MARKET · current LTP
- User can edit qty (partial close), switch to LIMIT, or change anything else before placing
- Fires the same `dt-manual` order path → tagged Manual in the journal
- On success, the row auto-refreshes (modal closes, positions reload)

### Nuances
- **Why "realized" is a separate number on the row:** if you did a buy and partial sell today, the row shows what's still open (unrealized) AND what you already booked (realized). Both pieces matter.
- **Realized calculation is approximate:** `min(buyQty, sellQty) × (sellVWAP − buyVWAP)` from today's complete orders. Kite's `pnl` field is the broker-exact number; we exposed the simple one for transparency. Easy swap if you want broker-exact.

---

## Epic 9 — State Persistence

**Goal:** Survive restarts. Don't lose user choices, tokens, or strategy state on a deploy.

### F9.1 — State surface
Single object persisted on every mutation:

```jsonc
{
  "mode": "auto" | "manual",
  "selectedAccounts": ["DINESH", ...],
  "kiteTokens": { "DINESH": { "apiKey": "...", "accessToken": "..." } },
  "idempotencyLedger": { "DINESH:2026-05-21:ITC:BUY": true, ... },
  "buyHistory": { "DINESH:ITC": [{ "price": 312.10, "ts": "..." }, ...] },
  "panicSkipList": { "2026-05-21": ["IDFC", "PNB"] }
}
```

- `idempotencyLedger` — persistent BUY-side ledger, pruned to today's entries on every read
- `buyHistory` — per-account-symbol BUY price + timestamp history, used by the pyramid gate. Resets to fresh after Kite reports zero qty for a symbol
- `panicSkipList` — per-day skip list for the panic-sell gate. Date-keyed; only today's entry survives `normalize()`'s prune step

### F9.2 — Storage backend
- **Local dev (no `STATE_FILE_PATH`):** JWT cookie. Quick to iterate, no filesystem dependency.
- **EC2 (`STATE_FILE_PATH=~/dineshtrade/data/state.json`):** file on disk, mode `0o600`. Cron reads fresh on every tick — no in-memory cache to invalidate.

### F9.3 — Separate persisted files
- `data/state.json` — runtime state (above)
- `data/strategy.json` — runtime overlay of bundled `config/strategy.json` (Settings → Strategies saves)
- `data/watchlist.json` — runtime overlay of bundled `config/watchlist.json` (Manage Lists saves; `{ meta, lists }` shape)
- `data/positions.json` *(new 21 May)* — unified open-position store, single row per `(account, symbol)` with `strategyId`. Replaces the older `strategy1.json` + `strategy2_positions.json`. Legacy files migrated to `.migrated` on first read.
- `data/daily-closes.json` *(new 21 May)* — rolling 60-day daily-close cache per symbol. Incremental fetch each morning replaces the per-tile 60-day re-fetch.
- `data/journal-YYYY-MM.jsonl` — append-only journal

All files live in the **same directory** (`~/dineshtrade/data/`) so EC2 deploys only need to whitelist one path.

### Nuances
- **Why JWT cookie locally:** there's no cron running locally either, so file persistence is overkill. The cookie survives page reloads and that's enough.
- **Why mode 0o600:** state.json + journal files contain trade history + tokens. Only the owner UID should read them.

---

## Epic 10 — Notifications (Email)

**Goal:** Real-time situational awareness without sitting in front of the app.

### F10.1 — Per-trade emails
- `trade_executed` — fires after every successful BUY or SELL (auto or manual). Includes account, symbol, qty, price, T1/T2/SL (for BUYs), source, reason, mode, Kite order ID.
- `trade_failed` — fires when preflight rejects OR Kite rejects. Distinguishes the two: preflight failures show the gate name + reason; Kite failures show the raw API error.

### F10.2 — Daily retrospective (15:35 IST)
- HTML email with the full `DailyReport` payload (see Epic 7).
- Skip rules in F6.2.

### F10.3 — Monthly rollup
- HTML email with `MonthlyReportData` on the last trading day of the month.

### F10.4 — Transport
- Gmail SMTP via `nodemailer`, Google App Password.
- Required env: `SMTP_USER`, `SMTP_PASS`. Optional: `SMTP_HOST`, `SMTP_PORT`, `NOTIFY_TO`.
- All sends are **fire-and-forget** — failures log but never block the calling code.

### Nuances
- **Why both text and HTML in daily/monthly:** terminals + plain-text clients still render the readable fallback. The HTML version is for the inbox.
- **Why no morning briefing email:** user opted out (19 May 2026) — the Dashboard in-app view is sufficient.

---

## Epic 11 — Today's Orders (existing)

**Goal:** Live Kite order log for the active account.

### F11.1 — `/trades` page → "Today's Orders" tab

- Refresh button pulls `/orders` from Kite
- Summary: BUY count, SELL count, Capital Used, Day P&L
- Row per order: time, symbol, **type** (B / S — green / red, no arrow), qty, price, **status glyph** (see below)

### F11.2 — Status glyphs

The status column shows a single glyph instead of the raw Kite enum, with a tooltip carrying the original `status_message`:

- `COMPLETE` → **✓** (green)
- `REJECTED` → **✗** (red)
- `CANCELLED` → **C** (dim grey)
- `OPEN` / `TRIGGER_PENDING` / `MODIFY_PENDING` / etc. → **·** (gold dot)

(Same page also hosts the Retrospective tab — see Epic 7.)

---

## Epic 12 — Manage Lists (named watchlists)

**Goal:** Users can curate as many named watchlists as they want without redeploying and without breaking running strategies.

### F12.1 — `/manage-lists` page

- Renders one card per list, plus a dashed "+ New list" card at the end.
- Each list card shows: editable name (click → input, Enter / blur saves), key suffix (`list3`, `list4` …), symbol count, search filter, scrollable symbol list, per-row remove (✕), and a 🗑 delete-list button (hidden for `listA` and `listB`).
- A top search bar (symbol or company name) hits `/api/watchlist/search` (Kite instrument lookup) and adds the chosen symbol to whichever list is selected in the "Add to …" dropdown.

### F12.2 — Internal keys vs display names

- Lists carry two fields: a stable internal key (`listA`, `listB`, `list3`, …) and a free-form display name in `meta[key].name`.
- Renaming a list edits only the display name. The key never changes — so `strategy.json`'s `"watchlist": ["listA"]` keeps targeting the same symbols regardless of what the user has called the list.
- New lists get the next free key (`list3`, `list4`, …). User-supplied names are limited to 40 chars.

### F12.3 — Delete safety

- `listA` and `listB` cannot be deleted (UI hides the button; API refuses with 400).
- For any other list, `DELETE /api/watchlist?key=list3` first checks every strategy's `watchlist` array. If any strategy references the list, the API returns **409** with the message `"List is used by strategy: <names>. Unhook it from that strategy first."`
- Users must first unhook the list from every strategy (via the Settings → Strategies multi-select) and save, then return to Manage Lists and delete.
- A pending unsaved Manage Lists edit blocks deletion — save changes first.

### F12.4 — Strategy linkage

- Settings → Strategies → each strategy card has a "Watchlist (select one or more)" multi-select.
- Chips show display names. Clicking a chip toggles the list's key in the strategy's `watchlist: string[]` field. At least one must remain selected (the UI prevents going empty).
- The cron and engine read whichever lists are currently selected on every tick; no restart needed after a save.

### F12.5 — Watchlist page (read-only consumer)

- Tabs are now dynamic — one per list, in this order: `listA`, `listB`, then any custom lists alphabetically by key.
- Tab labels use the display name from `meta`. The LTP fetch dedupes symbols across all lists.

### F12.6 — Multi-list membership (added 21 May 2026)

- The **same symbol may live in multiple lists** simultaneously (e.g. BAJFINANCE in both "Top Volume" and "Dip Candidates").
- Add-button rejection narrowed: a symbol is only refused for the *same target list*. The search result row shows an "also in: List X, List Y" hint when the symbol is already in other lists.
- API `POST /api/watchlist` accepts the same symbol in N lists. Per-list dedupe (no duplicates *within* a list) is still enforced.
- Strategy engine dedupes by NSE symbol at scan time across selected lists, so a strategy scanning `[listA, listB]` that share BAJFINANCE still processes it once per tick.

### Manage Lists nuances

- **Why keys are stable forever:** strategies reference watchlists by key. If we renamed keys on every display rename, every rename would need a `strategy.json` migration — fragile and easy to get wrong. Decoupling key from name is the cheapest way to make renames a zero-risk operation.
- **Move-between functionality removed:** the old A→B button is gone for consistency. With N lists, a single "move to" button isn't expressive enough; users now remove from one list and add to another. Costs one extra click; gains clarity.
- **Legacy data:** `lib/watchlistStore.ts:normalize()` reads both the legacy `{ listA: [...], listB: [...] }` and the new `{ lists, meta }` shape. No migration script — EC2's existing `data/watchlist.json` keeps working untouched; the meta block is synthesised on first read (`listA` → "List A", `listB` → "List B") and is persisted on next save.

---

## Epic 13 — Multi-strategy Lifecycle (built 20–21 May 2026)

**Goal:** Multiple strategies coexist, each with its own exits and handoff window. Accumulator is the structural keeper everyone falls through to.

### F13.1 — Strategy creation

- Settings → Strategies → **+ New Dip Strategy** / **+ New Momentum Strategy** at the bottom of the card list.
- Each new strategy gets a generated id (`new_dip`, `new_momentum`, `new_dip_2`, …). Id is **immutable** after first save.
- Defaults seed from `DEFAULT_DIP_PARAMS` / `DEFAULT_MOMENTUM_PARAMS`, including `deliveryHandoffDays: 15` for momentum strategies.

### F13.2 — Per-strategy exits + handoff

- Each strategy carries its own `exits.t1Pct`, `exits.t2Pct`, and (for momentum) `params.deliveryHandoffDays`.
- The strategy 1 monitor (`runStrategy1`/dip-type) and strategy 2 monitor (catalyst/momentum-type) both look up `getStrategyById(pos.strategyId)` per position per iteration — so each open position uses *its own* strategy's parameters at runtime, not a hardcoded category default.

### F13.3 — Position migration semantics

- **Handoff** — when a momentum position's `firstBuyAt` age ≥ `params.deliveryHandoffDays`, the monitor re-stamps its `strategyId` to `accumulator`. The position itself is preserved (`firstBuyPrice`, `firstBuyAt`, `remainingQty` etc.); only the owner changes.
- **Deactivate** — toggling `active: false` on a strategy migrates *all* its open positions to `accumulator` on save. Settings UI confirms with: *"Quickwin has N open positions. They will be moved to Accumulator on save. Continue?"*
- **Delete** — removing a strategy from the strategies array migrates open positions identically, then drops the strategy.
- All migrations use `migrateStrategyId(fromId, 'accumulator')` from `lib/positions.ts`.

### F13.4 — Accumulator protection

- **UI** — Active toggle + Delete button are disabled on the Accumulator card, with tooltip *"Accumulator cannot be deactivated — it is the keeper strategy"*.
- **API** — `POST /api/strategies` refuses any payload where the strategies array lacks `accumulator` or has `accumulator.active === false`. Returns 400 with an explicit error message.
- **Migration safety net** — `lib/strategyConfigStore.ts:migrateLegacyIds()` rewrites legacy `id: 'oscillator'` records to `id: 'accumulator'` on first load. One-shot, persisted on next save.

### F13.5 — Order tag scheme

- Cron auto-BUY, Engine Execute, and tile BUY all tag Kite orders as **`dt-${strategy.id}`** (e.g. `dt-accumulator`, `dt-catalyst`, `dt-quickwin`).
- `/api/zerodha` parses the tag, derives `strategyId`, and routes BUYs to `positions.recordBuy()`.
- Legacy `dt-s1` / `dt-s2` tags still understood on the read path (mapped to `accumulator` / `catalyst`).
- Manual orders from Watchlist / Holdings / Positions OrderModal stay `dt-manual` — no strategy ownership.

### Epic 13 nuances

- **Why accumulator is structurally permanent:** every momentum strategy hands off to it. If it could disappear, half the runtime invariants break.
- **Why we don't allow per-strategy handoff targets:** invites chained handoffs (`quickwin → deep_dip → accumulator`) that loop or surprise. One config target = one mental model.
- **Manual orders never migrate to accumulator:** they don't have a `strategyId` in the store. The position store only records auto and Engine-Execute BUYs (which both carry a strategy tag).

---

## Cross-Epic Behaviours

### CB1 — "Never sell at a loss"
Hard-coded in preflight gate 8 (no-short / no-loss-sell). **Auto-mode SELLs** fail this gate if `ltp < entryPrice`. **Manual SELLs** are exempt — the user is the human override.

### CB2 — Idempotency for "execute again" clicks
The in-process ledger (`${account}:${date}:${symbol}`, BUY-only) means double-clicking Execute on the Engine page in a single session won't fire the same BUY twice. Crossing midnight IST resets the ledger.

### CB3 — Holiday handling
NSE holidays come from `config/holidays.json`. `isMarketDay()` checks both weekend and holiday. The cron's daily-retrospective + tick functions both consult this; no separate holiday wiring per feature.

### CB4 — Multi-account fanout

Anywhere the app talks to "all connected accounts", it iterates `Object.keys(state.kiteTokens)` — not `config/accounts.json`. This means a token-revoked account silently drops out of automation without breaking the UI.

### CB5 — Market-hours UI gate

Every order-placing button across the app (Buy / Sell on Watchlist + Holdings, Square Off on Positions, BUY / SELL on Engine tiles) is gated by `isMarketOpen()`:

- **Visible always** — the button doesn't disappear after 15:30. Hiding affordances was confusing ("did the page break?").
- **Disabled outside NSE hours** — opacity-30, `cursor: not-allowed`, native tooltip "Market closed".
- **60-second tick** — each page sets `setInterval(() => setMarket(isMarketOpen()), 60_000)` so buttons auto-enable at 9:15 and disable at 15:30 without a refresh.
- **Page status badges** — each affected page shows a small status pill ("Closed — Weekend" / "Pre-Market (9:00–9:15)" / "Post-Market (15:30–16:00)") so the user understands *why* buttons are disabled.

`isMarketOpen()` lives in `lib/market.ts` and is the same function the server-side preflight gate 2 uses, so UI gating and server gating stay perfectly in sync.

---

## What's NOT in scope (explicit)

- F&O — ever
- Short selling — ever (no exceptions, even manual)
- BSE — NSE only
- Crypto, mutual funds, ETFs — equities only
- Multi-user — single user, multi-account
- Mobile native app — responsive web only
- Push notifications — email only (mobile push deferred to V2)
- Draft-aware what-if backtest harness — V2 (current implementation includes a Settings → Backtest UI and authenticated saved-strategy replay for both Strategy 1/dip and Strategy 2-style momentum strategies)

---

*End of functional spec. For implementation details, see `technical-specification.md`.*
