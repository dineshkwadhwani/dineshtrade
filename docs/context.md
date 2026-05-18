# DineshTrade — Project Context

**Last Updated:** 19 May 2026
**Version:** 1.2
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

## 4. The Two Strategies (Implemented)

### Strategy 1 — "The Oscillator" (Mean Reversion)
- **Trigger:** Stock 5–8% below 20-day EMA + 3+ consecutive down days
- **Tranche 1 exit:** SELL 50% when LTP recovers to EMA
- **Tranche 2 exit:** SELL remaining 50% when LTP ≥ EMA × 1.03 (EMA + 3%, no time stop)
- **Target:** ~4–5% per trade total
- **When used:** "Dip mode" (gap-down days where GIFT Nifty < −0.5%)

### Strategy 2 — "The Daily Catalyst" (Intraday momentum)
- **Trigger (momentum-based, replaced the original broker-rec filter):**
  - Day gain between **+0.5% and +1.5%**
  - **3+ rising 5-min candles** in a row
  - Volume > prorated 10-day average
  - LTP within ±3% of 20-day EMA
  - Scan window: 9:30–14:30 IST
- **Exit T1:** +1.5% → SELL immediately
- **Exit T2:** +2.0% → SELL immediately
- **3:00 PM cutoff:** If neither exit hit, hand off to Strategy 1 (delivery)
- **When used:** "Catalyst mode" (positive/flat days)

### Market Mode
| GIFT Nifty | Mode | Engine |
|---|---|---|
| Positive / flat | Catalyst | Strategy 2 |
| Gap-down < −0.5% | Dip | Strategy 1 |
| −5% or more | Circuit | No trades |

---

## 5. Hard Stop Rules (8 Preflight Gates)

Every order (auto or manual) passes through `runPreflight()`. The eight gates:

1. **Token** — Kite access token must be valid
2. **Market open** — 9:15–15:30 IST, weekdays, non-holiday
3. **Per-trade cap** — order value ≤ ₹5,000 (auto only; manual bypasses)
4. **Idempotency** — one BUY per `${account}:${date}:${symbol}` (auto only)
5. **Day quota** — max 3 BUYs / 3 SELLs per day per account (auto only)
6. **Position cap** — max 10 open positions per account (BUY only)
7. **Funds** — live margin check before BUY (BUY only)
8. **No-short** — fetch live held qty, clamp SELL to held, never short
   - Also: **No-loss-sell** rider — Auto SELLs never fire if LTP < entry

Manual trades bypass gates 3, 4, 5 (rate-limits). Gates 1, 2, 7, 8 always apply.

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

## 7. Watchlist

Generated from 5 years of actual trade history.
- Traded only once: excluded
- Not traded since May 2024: excluded
- STAR (Strides Pharma): manually blocklisted
- Top 75% by frequency → **List A** (84 stocks)
- Bottom 25% → **List B** (29 stocks)

Top List A: BAJFINANCE (91), TMPV (81), RELIANCE (74), BIRLACORPN (62), TATASTEEL (60), MARUTI (53), INDUSINDBK (50), BAJAJ-AUTO (46), JSWSTEEL (45), M&M (44).

Full list: `config/watchlist.json`.

---

## 8. Current Build Status — 19 May 2026

### Phase 1 (complete)
- Next.js 14 App Router scaffold, Obsidian Gold theme (Cormorant Garamond serif + Outfit body + JetBrains Mono numbers)
- Time-based login (`ddmmyyyyhh` IST, hourly rotation, midnight session expiry)
- All pages built: Dashboard, Watchlist, Engine, Holdings, Positions, Today's Orders + Retrospective, Settings
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
- Monthly rollup (`buildMonthlyReport`) — totals, best/worst trades, avg daily return, signals missed, optional recommendation.
- Email HTML — Obsidian Gold inline-styled tables for `daily_report` + `monthly_report`. Plain-text fallback included.
- Cron retrospective at 15:35 IST with three skip rules: not a market day, SMTP unconfigured, no activity (zero trades AND zero signals).
- New in-app `/trades` page — tabbed: "Today's Orders" (existing live Kite order log) and "Retrospective" (date-picker dropdown of all journal dates, renders the same `DailyReport` payload the email uses).
- New API: `GET /api/journal/dates` and `GET /api/journal/[date]`.
- New `/positions` page — joins Kite `/portfolio/positions` with today's `/orders` to enrich each row with a strategy tag (S1 / S2 / Manual / OOS / Mixed). Header strip: Open Positions · Capital · Unrealized · Day P&L. Each row: Symbol + tag pill + product (CNC/MIS) + qty + avg + LTP (with % change) + stacked P&L (unrealized + realized) + **Square Off** action button.
- Square Off — opens OrderModal pre-filled with SELL · held qty · matching product (MIS/CNC) · MARKET · LTP. Manual override of auto: after fill, S1 monitor's noShort gate removes the symbol from `strategy1.json`; S2 monitor's `qty <= 0` branch skips. Same `dt-manual` tag path.
- "Today's Positions" nav item added between Holdings and Today's Orders.

---

## 9. What's NOT Built (Deferred)

- Morning report **email** — Dashboard shows the briefing on visit, but no scheduled email send. User opted out (19 May).
- Other-people accounts (Himanshu, Shilpa, Nikhil, Narendra, Kartik, Pankaj, Dolly, Manpreet, Pooja) — V2.
- F&O — out of scope, ever.
- Mobile push notifications — V2.
- Manual override toggle UI in Settings (auto-mode currently overridden implicitly via Manual mode + manual orders).
- Backtest harness — V2.
- TMPV demerger reconciliation in Holdings P&L (cosmetic; not blocking).

---

## 10. Deployment

- **Vercel dropped** mid-Phase 2 — EC2-only now (state needs filesystem persistence, cron needs long-lived process).
- **EC2:** Ubuntu, PM2 keeps Node alive. Elastic IP `3.111.255.172`. Domain: `dineshtrade.online`.
- State + journal lives at `~/dineshtrade/data/` — file mode `0o600`, never wiped by deploys.
- Cron registers via Next.js `instrumentation.ts` (requires `experimental.instrumentationHook: true` in 14.x).

See `docs/technical-specification.md` for the full deploy runbook.

---

## 11. Config Files

```
config/
  watchlist.json    List A (84) + List B (29) — NSE symbols + trade counts
  accounts.json     4 accounts (name, broker, accountNo, colour, isTrading)
  strategy.json     All thresholds: T1 1.5%, T2 2.0%, dip −0.5%, circuit −5%,
                    strategy1_tranche2_above_ema_pct 3.0, strategy2_momentum block,
                    targets, capital caps, day quotas
  holidays.json     NSE holiday list 2026
```

---

## 12. Reference

- **Functional spec:** `docs/functional-specification.md` — broken into epics, captures the nuances (preflight order, manual override behaviour, journal verdict classification, etc.)
- **Technical spec:** `docs/technical-specification.md` — stack, architecture decisions, infra, build & deploy runbook

---

*DineshTrade v1.2 — Built with Claude — May 2026*
