# DineshTrade — Project Context
**Last Updated:** 29 May 2026  
**Version:** 2.0  
**Purpose:** This file gives Claude (or any AI assistant) full context of everything discussed so far about this project. Start any new conversation by uploading this file.

---

## 1. WHO IS DINESH

**Dinesh Wadhwani** — Founder & CEO of StudioVerse (a separate SaaS business, unrelated to this project).  
**Location:** Pune, Maharashtra, India  
**Email:** dinesh.k.wadhwani@gmail.com  
**This project (DineshTrade) has nothing to do with StudioVerse.**

---

## 2. TRADING BACKGROUND

Dinesh has been trading Indian equities since **FY2020** across **4 family accounts** plus managing trades for ~10 other people (friends/family).

### Family Accounts
| Name | Relation | Broker | Account No | Status |
|---|---|---|---|---|
| Dinesh Wadhwani | Self | Zerodha | DINESH | Primary (in app) |
| Kiran Wadhwani | Wife | Motilal Oswal | 4180283 | Active |
| Sheela Wadhwani | Mother | Motilal Oswal | 4432333 | Active |
| Sonia Wadhwani | Daughter | Zerodha | CJD607 | Active |

### Verified P&L (from official broker reports)
| Account | Net Realised P&L (FY2020–2026) | Best Year ROC |
|---|---|---|
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
- **Exit T1 = +1.5%, T2 = +2.0%** (both anchored to firstBuyPrice)
- **EOD behaviour** (added 28 May): `exitSameDayOnPositive` and `squareOffEOD` flags control what happens at `exitSameDayTime` (default 15:10)
- **Handoff:** after `deliveryHandoffDays` (default 15) → Accumulator takes over

### Market Boom (example third strategy)
- `squareOffEOD=true`, `exitSameDayOnPositive=true`, `deliveryHandoffDays=0`
- Always squares off at 15:10 — never takes delivery

### Market Mode
| GIFT Nifty | Mode | Action |
|---|---|---|
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

## 6. APPLICATION — CURRENT STATE (29 May 2026)

### Deployed at:
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
|---|---|---|
| Login | `/login` | Time-based password auth |
| Dashboard | `/dashboard` | Morning briefing, global indices, GIFT Nifty |
| Watchlist | `/watchlist` | Dynamic tabs per list, LTP colour coding |
| Manage Lists | `/manage-lists` | Create/rename/delete watchlists |
| Trading Engine | `/engine` | Recommendations, scan tiles, Execute, pending orders |
| Current Holdings | `/holdings` | Holdings + T0 positions merged, Buy/Sell (B/S) buttons |
| Today's Positions | `/positions` | Intraday P&L, Square Off |
| Today's Orders | `/trades` | Order log + Retrospective tab |
| Trade Report | `/trade-report` | Date-range P&L from journal |
| Settings | `/settings` | Accounts, strategies, backtest, Reset |

### Authentication
- Password: `ddmmyyyyhh` in IST — changes every hour
- Session: JWT cookie, expires midnight IST

---

## 7. KEY FEATURES BUILT (as of 29 May 2026)

### Cron Architecture
- **Core 5-min tick** (`*/5 9-15 * * 1-5`): SELL monitors (S1 + S2), EOD square-off, manual-sell reconciliation, reactive dip scan
- **Per-strategy BUY scan tasks**: each active strategy gets its own cron at `scanIntervalMin` — independent of the 5-min tick
- **15:35 IST**: daily retrospective email

### EOD Square-Off (added 28 May 2026)
- Momentum strategy params: `exitSameDayTime` (default "15:10"), `exitSameDayOnPositive`, `squareOffEOD`
- Visible and editable in Settings → Strategies → "End of Day Behaviour" section
- `squareOffEOD=true` bypasses the no-loss sell gate (via `bypassNoLossSell` in preflight)
- Configurable per-strategy, not global

### Position Tracking — Holdings Bug Fix (28 May 2026)
- CNC positions carried forward overnight were dropping to OOS because Kite moves them from `/portfolio/positions` to `/portfolio/holdings`
- Fix: `strategy2.ts` now includes holdings in `liveQtyBySymbol`
- Journal-based Seed 2 reseeding: on each monitor tick, reads last 30 days of journal BUY records and reseeds any momentum positions that fell out of the store but are still held in Kite

### Manual Sell Reconciliation (added 28 May 2026)
- `reconcileManualSells()` runs every 5-min tick + at 15:35 EOD
- Detects positions closed manually in Kite (Kite qty = 0 but position still in store)
- Today's sell: journals at actual fill price from Kite order book
- Prior-day sell: journals synthetic SELL at current LTP (or entry price if market closed)
- Removes position from store so it doesn't show as "OPEN" in trade report

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
2. Market open (9:15–15:30, weekday, non-holiday)
2b. Intraday circuit (live NIFTY 50 hysteresis)
3. Per-trade cap (auto only)
4. Idempotency (auto BUY only)
4b. Panic-sell (auto BUY only)
4c. Pyramid (auto BUY only — maxBuysPerSymbol, minDropBetweenBuysPct)
4d. Sector concentration (auto BUY with strategyId — maxPerSector)
5. Day quota (auto only)
6. Position cap (BUY)
7. Funds available (BUY)
8. No-short guard (SELL — clamps to held qty; auto: no-loss-sell rider, bypassable via `bypassNoLossSell`)

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
|---|---|
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

## 12. OPEN ISSUES / KNOWN BUGS (as of 29 May 2026)

- **Login with Kite button**: clicking navigates to `/api/zerodha/login` which should redirect to Kite OAuth. If it "refreshes" instead, the redirect is going back to `/settings?error=...` — likely `isAccountConfigured()` returning false. Check if `ZERODHA_ENVIRONMENT` and `PROD_ZERODHA_API_KEY_DINESH` env vars are set correctly on EC2.
- **Light mode**: attribute selector overrides apply after React hydration. SSR-rendered pages may flash before light mode applies. Further refinement possible.
- **@types/connect**: was corrupt (no .d.ts files). Fixed by `npm install --save-dev @types/connect` + `"types": ["node"]` in tsconfig.json.

---

## 13. HOW TO USE THIS FILE

Start any new Claude conversation:
1. Upload this `CONTEXT.md`
2. Say: "This is context for DineshTrade. [Your question]"

Also upload `docs/functional-specification.md` + `docs/technical-specification.md` for deep implementation questions.

---

*DineshTrade v2.0 — Built with Claude AI — May 2026*
