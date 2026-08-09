# DineshTrade — Architecture (code-verified, 09 Aug 2026)

This is the current, ground-truth technical picture — verified directly against the
code in `lib/`, `app/`, and the live `data/*.json` files, not carried forward from
older planning docs. See `docs/README.md` for how this fits with the rest of the
`docs/` folder, and `docs/MULTI_TENANCY_CURRENT_STATE.md` for the tenancy-specific
deep dive.

## 1. What this app is

A personal algorithmic trading system for NSE cash equities. It connects to Zerodha
Kite Connect, scans watchlists for entry signals under a small set of configurable
strategies, places CNC (delivery-only) orders automatically, monitors open positions
for exits, and journals everything for reporting. One human operator; several Zerodha
sub-accounts underneath (see `docs/MULTI_TENANCY_CURRENT_STATE.md`).

## 2. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14.2.3, App Router, TypeScript |
| UI | React 18, Tailwind CSS 3.4 |
| Broker | Zerodha Kite Connect — direct REST via `axios`/`kiteconnect`; no abstraction layer |
| Cron | `node-cron` 3.x, in-process, Asia/Kolkata timezone |
| Auth | `jose` JWT cookie, single shared time-based password — no per-user identity |
| Persistence | Flat JSON / JSONL files on disk under `data/` — **no database** |
| Email | `nodemailer` + Gmail SMTP App Password |
| AI | Multi-provider dispatcher (`lib/ai.ts`) — Anthropic / Gemini / Groq / OpenAI, selected by `AI_PROVIDER` env var; currently configured for Gemini |
| Market data extra | `yahoo-finance2` (sector lookups in `lib/nse.ts`) |
| Process model | Custom `server.js` (not `next start`) — wraps the Next handler and starts cron itself so PM2 owns exactly one long-lived process |
| Deployment | AWS EC2 (ap-south-1), PM2, Caddy reverse proxy, domain `dineshtrade.online` |

Confirmed via `package.json`: **no** Supabase client, **no** Angel One SDK — these
appear only in the archived speculative v2 plan, never implemented.

## 3. Runtime process model

```
PM2 (single process: "dineshtrade")
 └─ server.js
     ├─ Next.js request handler (all pages + /api/* routes)
     └─ startCron()  — loaded from dist/cron-runtime.cjs (esbuild-bundled at build time)
         ├─ core 5-min tick        */5 9-15 * * 1-5  (Asia/Kolkata)
         │    → SELL monitors (dip / momentum / pivotal), EOD square-off,
         │      manual-sell reconciliation, reactive dip scan
         ├─ one BUY-scan task PER ACTIVE STRATEGY, each at its own scanIntervalMin
         └─ 15:35 IST              daily retrospective email (+ monthly on last trading day)
```

`instrumentation.ts` is intentionally a no-op — an earlier version started cron from
Next's instrumentation hook, which double-started cron across transient runtime
contexts. `server.js` is now the single owner.

There is exactly **one** cron scheduler for the whole app. Every task internally
loops over all connected accounts (`Object.keys(state.kiteTokens)`) — accounts are
not isolated at the process level (see `docs/MULTI_TENANCY_CURRENT_STATE.md`).

## 4. Auth & session

- Password: `ddmmyyyyhh` in IST, recomputed every hour server-side — no stored
  credential, no per-user secret (`lib/auth.ts`).
- On success: JWT cookie `dt_session`, payload is the **hardcoded literal**
  `{ user: 'dinesh', role: 'trader' }`, expires at IST midnight.
- `middleware.ts` gates every route except `/login`, `/api/auth`, and Next static
  assets, redirecting unauthenticated requests to `/login`. Individual API routes
  independently re-verify the cookie server-side (defense in depth, and necessary
  since `fetch()` calls shouldn't get an HTML redirect).
- State backend: JWT cookie for interactive local dev, or a flat file
  (`STATE_FILE_PATH`, EC2 only) for the cron process, which runs outside any request
  context. **Must stay unset on local dev** — an EC2-shaped path crashes with ENOENT.

## 5. Order lifecycle & preflight gates

Every order (auto or manual) passes through `runPreflight()` in `lib/preflight.ts`.
The file's own header comment claims "six gates" — that comment is stale. The
actual, code-verified sequence is **13 named checkpoints**, evaluated in this exact
order, short-circuiting on first failure:

| # | Gate | Applies to |
|---|---|---|
| 1 | Token connected | all orders |
| 2 | Market open (hours + weekday + NSE holiday calendar) | all orders |
| 2b | Intraday circuit (live NIFTY 50 vs today's open, hysteresis trip/resume) | auto BUY only |
| 3 | Per-trade cap (`capital.perTrade`) | auto BUY only |
| 4 | Idempotency (one BUY per account+date+symbol) | auto BUY only |
| 4b | Panic-sell (per-symbol drop-from-peak in a rolling window) | auto BUY only |
| 4c | Pyramid (`maxBuysPerSymbol`, `minDropBetweenBuysPct`) | auto BUY only |
| 4d | Sector concentration (`maxPerSector`, dip-type strategies only) | auto BUY only |
| 5 | Day quota (`maxBuysPerDay` / `maxSellsPerDay`, net of today's fills) | auto only |
| 6 | Position cap (`maxPositions`) | auto BUY only |
| 7 | Funds available (live margin check) | all BUY |
| 8 | No-short (clamps SELL qty to live held qty; rejects if held = 0) | all SELL |
| 9 | No-loss-sell (auto SELLs reject if LTP < entry after modeled charges; bypassable via `bypassNoLossSell` — used by `squareOffEOD` / Pivotal stop-loss) | auto SELL only |

`manual: true` orders skip gates 3, 4, 4b, 4c, 4d, 5, 6, 9 — they still go through
token, market, funds (BUY) / no-short (SELL). Rate-limit and behavioral gates exist to
prevent runaway automation, not to second-guess the human.

`markPlaced()` runs after a successful order: records the idempotency key and (for
non-manual BUYs) appends to buy-history for the pyramid gate.

## 6. Strategies (live, from `data/strategy.json` — not the checked-in seed)

**Important:** `config/strategy.json` (checked into git) and `data/strategy.json`
(live runtime overlay the app actually reads) have drifted apart significantly. The
table below reflects `data/strategy.json` as of 06 Aug 2026 — this is what's actually
running. See `docs/DATA_MODEL.md` for the seed-vs-live diff in full.

Global capital caps applied to every account (`data/strategy.json` → `capital`):
`perTrade ₹20,000` · `maxBuysPerDay 6` · `maxSellsPerDay 20` · `maxPositions 35` ·
`maxDeployPct 100%` · `maxBuysPerSymbol 3` · `minDropBetweenBuysPct 10%` ·
`intradayCircuitTripPct -3% / ResumePct -2%` · `panicDropPct 10% / panicWindowMin 10min` ·
`circuitBreakerPct -5%` (pre-market GIFT Nifty circuit) · `deliveryDpCharge ₹15.34`.

Four strategies are currently configured, all `active: true`:

### Accumulator (`accumulator`, type `dip`)
Mean-reversion. Scans `listA` every 15 min. Entry: ≥5% below 20-day EMA
(`entryBelowPct`), 8% for the "strong buy" tier, 3+ consecutive down days, rejected
above a 12% capitulation floor, max 3 open positions per sector. GIFT Nifty gate:
fires only when GIFT Nifty ≤ −0.5%. Exits: T1 +3%, T2 +5% of `firstBuyPrice`, in two
tranches. Reactive scan: any List A stock down ≥2% intraday triggers an off-cycle
check (throttled to once per 30 min), fires in any market mode. This is the
**structural universal parking lot** — every other strategy hands its positions off
here after its `deliveryHandoffDays` window; it cannot be deactivated or deleted.

### Catalyst — Momentum (`catalyst`, type `momentum`)
Scans `listA` every 5 min, window 09:15–15:00. Entry: day gain 0.5–0.75%, 3+ rising
5-min candles, LTP within ±3% of 20-day EMA, plus a ceiling filter (must be below a
2% buffer under the 20-day high). Exits: T1 +1.5%, T2 +2.0%. EOD: `exitSameDayTime`
15:15, `exitSameDayOnPositive: true` (sells if net-of-charges P&L is still positive),
`squareOffEOD: false`. Handoff to Accumulator after 30 calendar days.

### Market Boom (`market_boom`, type `momentum`)
Scans `listA` every 3 min, window 09:15–15:15. Entry: day gain 0.25–0.5% (tighter/
earlier than Catalyst), 2+ rising candles, EMA proximity ±5%. Exits: T1 +1.0%, T2
+1.5%. EOD `exitSameDayTime` 15:10, `exitSameDayOnPositive: true`,
`squareOffEOD: false`. GIFT Nifty gate present but currently disabled
(`enabled: false`, `minPct: 1`). Note: this strategy is `active: true` in live data
today — the checked-in `config/strategy.json` seed still marks it `active: false`,
which is now stale.

### New Pivotal Strategy (`new_pivotal`, type `pivotal`)
Scans `listA` every 5 min, window 10:00–13:00 (`normal` mode) or at 15:10
(`dayEnd` mode). Per-symbol setup lives in a separate Pivotal List
(`pivotalListId: "pivotalA"`), each entry carrying its own `breakoutTriggerPrice`,
`t1Pct`/`t2Pct`, optional `stopLossPrice`. Strategy-level filters: 10-day
consolidation window, max 6% consolidation range, 1.2× volume-surge ratio, 2
confirming rising candles. Exit priority: stop-loss (if set, bypasses no-loss gate)
→ T2 → T1 → 15-day handoff to Accumulator. Note: `pivotalA` (the seeded Pivotal List)
is currently **empty** in both `config/pivotalLists.json` and `data/pivotalLists.json`
— the strategy is wired and active but has no symbols configured to trade yet.

All four strategies share one `retraceAfterHit` / `retractPercentAllowed` mechanism:
if a lot touches T1/T2 intraday and then retraces, the exit can still fire as long as
the retracement stays within the configured allowance and the price is still above
that lot's own entry — implemented uniformly across `DipParams`, `MomentumParams`,
and `PivotalParams` in `lib/strategyConfig.ts`.

## 7. Cron responsibilities split

- **Per-strategy BUY scan tasks** (own `scanIntervalMin` cadence, hot-reloaded on
  Settings save via `reloadCronStrategies()`) — find and place new BUYs only.
- **Global 5-min tick** — everything else: SELL monitoring across all three strategy
  families (dip/momentum/pivotal), EOD square-off, manual-sell reconciliation,
  reactive dip scan.
- Rationale (from code comments): BUY signals need per-strategy cadence (Market Boom
  every 3 min vs. Accumulator every 15); SELL monitoring, reconciliation, and EOD
  housekeeping are account-wide concerns that don't belong to any one strategy.

Race-condition guards: `inProcessBuyCounts` and `inProcessNewSymbols` (module-level,
in `lib/cronState.ts`) give a fast in-process pre-check so two concurrent per-strategy
cron ticks landing on the same minute can't both slip past the day-quota or
position-cap gates before either order shows up in Kite's own API. `lib/positions.ts`
additionally wraps every read-modify-write in an async mutex (`withLock`) — this is
only safe because the whole app is one long-lived, non-clustered Node process.

## 8. Data scoping: per-account vs. global

See `docs/MULTI_TENANCY_CURRENT_STATE.md` for the full table and its implications.
Short version: trading *execution state* (Kite tokens, open positions, journal,
idempotency ledger, pyramid buy history) is per-account. Trading *strategy*
(definitions, params, watchlists, pivotal lists, capital caps) is global — shared
identically by every account under the one operator.

## 9. Persistence layer

No database. Flat files under `data/` (see `docs/DATA_MODEL.md` for exact shapes):
`state.json`, `positions.json`, `strategy.json` (runtime overlay of
`config/strategy.json`), `watchlist.json` (runtime overlay of
`config/watchlist.json`), `pivotalLists.json` (overlay of `config/pivotalLists.json`),
`daily-closes.json` (rolling OHLC cache), `backtest-history.json`, and monthly
append-only `journal-YYYY-MM.jsonl` files. `~/dineshtrade/data/` on EC2 must never be
touched by a deploy step.

## 10. Deploy

```bash
cd ~/dineshtrade
git pull
rm -rf .next
npm ci
NODE_OPTIONS="--max-old-space-size=2048" npm run build   # next build + esbuild-bundles lib/cron.ts → dist/cron-runtime.cjs
pm2 restart dineshtrade --update-env
```

Type-check only (safe while `next dev` is running): `npx tsc --noEmit`. Never run
`npm run build` while the dev server is running — the two conflict.

## 11. Where to go next

- `docs/APP_MAP.md` — every page, every API route, every component, file-by-file.
- `docs/DATA_MODEL.md` — exact current shape of every config/data file, and the
  seed-vs-live drift that exists today.
- `docs/MULTI_TENANCY_CURRENT_STATE.md` — the tenancy-specific deep dive.
- `docs/TRADING_ENGINE_CORE.md` — strategy/exit rule reference in decision-tree form.
- Root `CONTEXT.md` / `COPILOT.md` — narrative project history and full lib/ file
  table (kept in sync with this document).
