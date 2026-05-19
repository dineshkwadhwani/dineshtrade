# DineshTrade — Functional Specification

**Version:** 1.2 · **Last Updated:** 19 May 2026

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

### F3.1 — Config-locked Watchlist
- List A (84 stocks) + List B (29 stocks) derived from 5 years of trade history.
- **Cannot** be edited from the UI — must edit `config/watchlist.json` and redeploy. This is by design: it prevents impulsive adds.
- Per row: symbol, exchange, optional notes. UI shows live LTP fetched via Kite's batched `/quote` endpoint, coloured green/red by net change.

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

### F4.1 — Strategy 1: The Oscillator (mean reversion)

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
- **Intraday exit:** SELL when LTP ≥ entry × 1.015 (+1.5%). T2 (+2.0%) is documented as a backup but the engine takes the first to fire.
- **3:00 PM cutoff:** If neither exit fires, the position **hands off to Strategy 1**: `ensureStrategy1Tracking()` is called (idempotent) so the EMA-based exit logic takes over from the next day.
- **Order tags:** `dt-s2` (BUY), `dt-s2-exit` (intraday SELL)

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

### Nuances
- **Tranche 2 rule change:** originally "next day above EMA". Changed to "EMA + 3% same-day, no time stop" on user request (18 May 2026) — captures more upside on momentum names.
- **Strategy 2 monitors all live positions, not just today's:** even after a Manual → Auto switch mid-session, the monitor picks up existing `dt-s2`-tagged positions because it reads order tags + live positions every tick. No restart needed.
- **Why strategy.json centralises thresholds:** so a config change (e.g. "raise T1 from 1.5% to 1.8%") doesn't touch code or trigger a redeploy code review.

---

## Epic 5 — Order Lifecycle & Preflight Gates

**Goal:** Every order — auto or manual — flows through one funnel. No bypasses.

### F5.1 — The 8 Gates (`runPreflight()`)

Order matters; first failure short-circuits with `{ ok: false, gate, reason }`.

1. **Token** — `state.kiteTokens[account]` exists and isn't expired
2. **Market open** — current IST time within 9:15–15:30, weekday, non-holiday per `config/holidays.json`
3. **Per-trade cap** — `pricePerShare × quantity ≤ ₹5,000` *(auto only; manual bypasses)*
4. **Idempotency** — in-process ledger keyed by `${account}:${date}:${symbol}`, BUY side only *(auto only; manual bypasses)*
5. **Day quota** — max 3 BUYs / 3 SELLs per day per account *(auto only)*
6. **Position cap** — BUY only; auto + manual both gated. Max 10 open positions per account
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
3. `buildDailyReport(today).shouldSend === false` (zero trades AND zero signals) → skip
4. Otherwise: `sendDailyReport(report)` — HTML email
5. **Additionally**, if `isLastWeekdayOfMonth(today)`: build + send `monthly_report` (skipped if month had zero activity)

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
- Two record types:
  - **`trade`** — `{ type, date, account, symbol, qty, entryPrice, entryTime, exitPrice, exitTime, pnlRupees, pnlPct, dayHighAfterEntry, dayLowAfterEntry, leftOnTable, verdict, strategy, orderIdBuy?, orderIdSell?, notes? }`
  - **`signal_skipped`** — `{ type, date, time, account, symbol, signalPrice, reasonSkipped }`

### F7.2 — Where writes happen
- Strategy 1 monitor — after each tranche SELL fills (with notes per tranche)
- Strategy 2 monitor — after each +1.5% SELL fills (computes day high/low + left-on-table at write time)
- Cron auto-BUY scan — when preflight rejects a recommendation (writes `signal_skipped` with the gate reason)

### F7.3 — Verdict classification
At journal-write time, `classifyVerdict({ strategy, entryPrice, exitPrice, t1TriggerPct, isDelivery })`:
- `correct_exit` — gainPct ≥ T1 trigger − 0.05 (tolerance for fill slippage)
- `early_exit` — exited below T1
- `delivery` — Strategy 2 position taken to delivery at 3 PM
- `manual` — manual SELL (via OrderModal)

### F7.4 — Daily report (`buildDailyReport(date)`)
Five sections:
1. **Hero stats** — trades count, win rate, total P&L, capital deployed
2. **Trade-by-trade** — per-trade card with entry/exit/P&L, **enriched with live Kite OHLC** so final day-high / left-on-table reflect the full session (not just the moment of sale)
3. **Missed signals** — `signal_skipped` records, classified post-hoc:
   - `missed_opportunity` — signalPrice × 1.015 was hit by EoD high
   - `good_miss` — wasn't hit
   - `unknown` — no OHLC data
4. **30-day rolling stats** — win rate, avg gain, capital efficiency, delivery open count
5. **Fine-tuning bullets** — up to 3 heuristic-generated tips:
   - Avg left-on-table > 1.5% over last 10 wins → suggest raising T1
   - Missed-opportunity rate > 40% over today's skipped signals → check if filter is too tight
   - Win rate < 60% over 30 days → review entry criteria; > 85% → consider loosening filters

### F7.5 — Monthly rollup (`buildMonthlyReport(date)`)
Fires on the last trading day of the month (after the daily report). Shows: total trades, win rate, total P&L, best/worst trade, avg daily return, signals missed, optional recommendation.

### F7.6 — In-app Retrospective tab
- `/trades` page has two top-level tabs: "Today's Orders" and "Retrospective"
- Retrospective tab: dropdown of all journal dates (newest first), renders the same `DailyReport` payload the EoD email uses
- Powered by `GET /api/journal/dates` + `GET /api/journal/[date]`

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
- Table per position:
  - Symbol + **strategy tag pill** (S1 gold / S2 blue / Manual purple / OOS gray / Mixed amber)
  - Product chip (CNC or MIS)
  - Qty (held now)
  - Avg price
  - LTP with intraday % change
  - **Stacked P&L** — unrealized (main, coloured) + realized today (smaller line below)
  - **Square Off** action button (red)
- Closed-today rows are kept in the list but dimmed (so you can see what fired earlier today)

### F8.2 — Strategy tag derivation
Per row, the tag is computed from today's filled order tags for that symbol:
- All tags are `dt-s1*` and no manual → **S1**
- All tags are `dt-s2*` and no manual → **S2**
- All tags are `dt-manual` → **Manual**
- No order tags today → **OOS** (pre-existing position)
- Multiple categories → **Mixed** (rare, flagged so the user investigates)

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
```
{
  mode: 'auto' | 'manual',
  selectedAccounts: string[],
  kiteTokens: { [accountName]: { apiKey, accessToken, capturedAt } },
  lastBriefingDate?: string,
  ...
}
```

### F9.2 — Storage backend
- **Local dev (no `STATE_FILE_PATH`):** JWT cookie. Quick to iterate, no filesystem dependency.
- **EC2 (`STATE_FILE_PATH=~/dineshtrade/data/state.json`):** file on disk, mode `0o600`. Cron reads fresh on every tick — no in-memory cache to invalidate.

### F9.3 — Separate persisted files
- `data/state.json` — runtime state (above)
- `data/strategy1.json` — Strategy 1 open positions (long-lived across days)
- `data/journal-YYYY-MM.jsonl` — append-only journal

All three live in the **same directory** so EC2 deploys only need to whitelist one path.

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
- Row per order: time, symbol, side, qty, price, status (coloured)

### F11.2 — Status colours
- COMPLETE → green
- REJECTED / CANCELLED → red
- OPEN / PENDING / TRIGGER_PENDING → gold

(Same page also hosts the Retrospective tab — see Epic 7.)

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

---

## What's NOT in scope (explicit)

- F&O — ever
- Short selling — ever (no exceptions, even manual)
- BSE — NSE only
- Crypto, mutual funds, ETFs — equities only
- Multi-user — single user, multi-account
- Mobile native app — responsive web only
- Push notifications — email only (mobile push deferred to V2)
- Backtest harness — V2

---

*End of functional spec. For implementation details, see `technical-specification.md`.*
