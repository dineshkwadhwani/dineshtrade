# DineshTrade — Project Context
**Last Updated:** 18 May 2026  
**Version:** 1.0  
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
| Dinesh Wadhwani | Self | Motilal Oswal | 2180536 | Primary |
| Kiran Wadhwani | Wife | Motilal Oswal | 4180283 | Active |
| Sheela Wadhwani | Mother | Motilal Oswal | 4432333 | Active |
| Sonia Wadhwani | Daughter | Zerodha | CJD607 | Active |

### Other accounts managed (not in app yet — V2)
Himanshu, Shilpa, Nikhil, Narendra, Kartik, Pankaj, Dolly, Manpreet, Pooja and a few more.

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
- Bajaj Finance = ₹6.32L profit — family's best single stock
- Strides Pharma (STAR) = ₹2.30L loss — biggest mistake, removed from all lists

---

## 3. TRADING PHILOSOPHY

- Never short sell
- Never trade F&O
- Never sell at a loss — wait for recovery
- Buy blue chips on dips, they always come back
- LIFO approach — ensure last trade on each script is always profitable
- List A is config-locked — cannot add stocks impulsively via UI

---

## 4. THE TWO STRATEGIES

### Strategy 1 — "The Oscillator" (Mean Reversion)
- **Trigger:** Stock 5–8% below 20-day EMA + 3+ consecutive down days
- **Exit:** Sell 50% at EMA recovery, 50% when holds above EMA 1 day
- **Target:** 4–5% per trade
- **Used on:** Gap-down days (GIFT Nifty below −0.5%)

### Strategy 2 — "The Daily Catalyst" (Intraday-to-Delivery)
- **Morning:** Read report → ICICI Direct + HDFC + Moneycontrol + MO recommendations → filter against List A
- **Exit T1:** +1.5% intraday → SELL immediately
- **Exit T2:** +2.0% intraday → SELL immediately
- **If not hit by 3 PM:** Take to delivery → manage as Strategy 1
- **Used on:** Positive/flat days (GIFT Nifty above −0.5%)

### Market Mode Detection
| GIFT Nifty | Mode | Action |
|---|---|---|
| Positive/flat | Catalyst | Strategy 2 |
| Gap-down < −0.5% | Dip | Strategy 1 |
| −5% or more | Circuit | NO TRADES |

Gap-down days = buying opportunities. Never skip trading just because market is down.

---

## 5. HARD STOP RULES (NEVER OVERRIDE)

- Total corpus: ₹50,000
- Max per trade: ₹5,000
- Max open positions: 10
- Max buys per day: 3
- Max sells per day: 3
- No short selling: ever
- No F&O: ever
- Delivery only (CNC), NSE
- Cash check before every order
- Circuit breaker: Nifty −5%+ intraday → stop all trades that day
- Trade until cash runs out — never pause on drawdown

---

## 6. APPLICATION SPECIFICATION

### Tech Stack
- Framework: Next.js 14 (App Router), TypeScript
- Styling: Tailwind CSS
- Deployment: Vercel
- Default URL: `dineshtrade.vercel.app`
- Custom domain: `dineshtrade.online` (being acquired — add in Vercel → Settings → Domains)

### Design
- Theme: Obsidian Gold — dark (#080604) background, gold gradient (DW monogram)
- Fonts: Cormorant Garamond (serif), Outfit (body), JetBrains Mono (numbers)
- Mobile-first design

### Authentication
- Password: `ddmmyyyyhh` in IST — changes every hour
- Example: 17 May 2026 at 14:00 → `1705202614`
- Session expires at midnight IST (not on browser close)
- Only Logout button kills session

### Pages
| Page | Path | Purpose |
|---|---|---|
| Login | `/login` | Obsidian Gold login, ticker strip |
| Dashboard | `/dashboard` | Morning briefing, global indices, GIFT Nifty, outlook |
| Watchlist | `/watchlist` | List A + List B, colour-coded, config-locked |
| Trading Engine | `/engine` | Strategy scanner, recommendations, Execute button |
| Today's Trades | `/trades` | All orders today from active accounts |
| Settings | `/settings` | Accounts toggle, Trade Mode, Zerodha token |

### Settings Details
- Account toggles (active for this session)
- Each Zerodha account has a "Connect" button
- Trade Mode: Auto ↔ Manual (default: Manual)
- Zerodha daily access token paste field
- Strategy rules (read-only display)
- Save persists until logout

### Watchlist Display Rules
- Blue background = currently holding
- Green font = positive today
- Red font = negative today
- Cannot add stocks from UI — edit config/watchlist.json + redeploy

### Trading Engine Logic
- Refresh button → scans List A + List B
- Shows mode (Catalyst / Dip / Circuit)
- Shows remaining buys/sells + cash
- Each recommendation: symbol, price, T1, T2, SL, qty, reason, source
- Manual mode: Execute button per recommendation
- Auto mode: executes automatically

---

## 7. WATCHLIST

Generated from 5 years of actual trade history.
- Stocks traded only once: excluded
- Stocks not traded since May 2024: excluded  
- STAR (Strides Pharma): manually excluded
- Top 75% by frequency = List A (84 stocks)
- Bottom 25% = List B (29 stocks)

Top List A stocks: BAJFINANCE (91), TMPV (81), RELIANCE (74), BIRLACORPN (62), TATASTEEL (60), MARUTI (53), INDUSINDBK (50), BAJAJ-AUTO (46), JSWSTEEL (45), M&M (44)...

Full list in `config/watchlist.json`

---

## 8. ZERODHA INTEGRATION

- Plan: Kite Connect ₹500/month (needed for live quotes + historical data)
- Personal plan (free) works for orders only — not enough for EMA calculation
- Daily auth: access token expires daily, paste in Settings each morning
- All orders: CNC, NSE, MARKET type
- Broker recommendation sources: ICICI Direct, HDFC Securities, Moneycontrol, Motilal Oswal

---

## 9. ENVIRONMENT VARIABLES (.env.local)

```
AI_API_KEY=             # Anthropic API key
AI_API_URL=             # https://api.anthropic.com/v1/messages
AI_MODEL=               # claude-sonnet-4-20250514
ZERODHA_API_KEY=        # Kite Connect API key
ZERODHA_API_SECRET=     # Kite Connect secret
ZERODHA_ACCESS_TOKEN=   # Daily token (paste after morning Zerodha login)
SESSION_SECRET=         # Random 32+ char string
```

AI provider is swappable — change the 3 AI_* vars only, no code changes.

---

## 10. CONFIG FILES

```
config/
  watchlist.json    — List A (84) + List B (29) with NSE symbols + trade counts
  accounts.json     — 4 accounts (name, broker, accountNo, color, isTrading)
  strategy.json     — All rules and thresholds
  holidays.json     — NSE holiday list 2026
```

---

## 11. KEY LIB FILES

```
lib/auth.ts       — Password generation (ddmmyyyyhh IST), JWT session, midnight expiry
lib/market.ts     — Market hours (9:15–15:30), IST datetime, NSE holiday check
lib/strategy.ts   — Mode detection, signal calculation, EMA deviation, targets
```

---

## 12. API ROUTES

| Route | Method | Purpose |
|---|---|---|
| `/api/auth` | POST | Verify password, set session cookie |
| `/api/auth` | DELETE | Logout, clear cookie |
| `/api/market` | GET | Daily briefing via Claude API + web search |
| `/api/zerodha` | GET | ?action=holdings/positions/orders/funds/quote |
| `/api/zerodha` | POST | Place order (action=place_order) |
| `/api/strategy` | POST | Run strategy scan, return recommendations |

---

## 13. DAILY DALAL STREET REPORT

Every morning before 9:15 AM, a market briefing is generated covering:
1. World indices (yesterday close)
2. Asian markets (today live)
3. GIFT Nifty (pre-market signal)
4. India outlook (bias, range, S/R, key factors)
5. Sector analysis (outperform vs underperform)
6. Top 10 momentum stocks with verified CMPs + targets

**Critical rule on CMPs:** Always verify from NSE/BSE. Never estimate. Flag clearly when estimated vs verified.

---

## 14. GOOGLE APPS SCRIPT (Email Automation)

File: `DalalStreetReport.gs`  
Sends daily market report email to `dinesh.k.wadhwani@gmail.com`  
Subject: "Daily Claude Report"  
Runs at 8 AM every weekday via Google trigger  
Cost: Free (Google) + ~₹25-40/report (Claude API)

---

## 15. SONIA'S TMPV DEMERGER EXPLANATION

Sonia's account shows TMPV as a large "loss" — this is accounting artefact:
- Original position: Tata Motors (TATAMOTORS)
- After demerger: split into TMCV (commercial vehicles) + TMPV (passenger vehicles)
- TMCV sold → shows as ₹94,189 profit (40.2%)
- TMPV held → shows as −57% "loss" (Zerodha allocated full original cost to TMPV)
- Combined real P&L on original Tata Motors investment: −₹2.59L on ₹6.21L invested
- TMPV at ₹362 (May 15, +8% that day) — recovering. Breakeven ~₹550

---

## 16. CURRENT STATUS (as of 18 May 2026)

### Built:
- Complete Next.js project structure (ZIP: dineshtrade-v1.0.zip)
- Obsidian Gold login screen
- All 6 pages scaffolded
- Auth system (time-based password, JWT, midnight expiry)
- All API routes (auth, market, zerodha, strategy)
- Config files (watchlist 84+29, accounts, strategy, holidays)
- Strategy rules engine
- AppShell with top nav + mobile bottom nav
- Vercel deployment config

### Pending (needs VS Code session to fix):
- Not tested locally yet — may have compile errors
- Dashboard market API needs live testing
- Zerodha OAuth callback page not built
- Live quotes not yet wired to strategy engine
- Middleware.ts route protection needs verification

### Next Step:
Open in VS Code → `npm install` → fix errors → `npm run dev` → test login

---

## 17. HOW TO USE THIS FILE

Start any new Claude conversation:
1. Upload this `CONTEXT.md`
2. Say: "This is context for DineshTrade. [Your question]"

For VS Code debugging: Upload this file + paste the specific error.
For new features: Upload this file + describe what you want.

---

*DineshTrade v1.0 — Built with Claude AI — May 2026*
