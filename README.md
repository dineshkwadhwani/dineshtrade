# DineshTrade — Private Trading Desk

A personal algorithmic trading app for NSE cash equities via Zerodha Kite Connect.
One shared operator login, several Zerodha sub-accounts underneath. No database —
runtime state lives in flat JSON files. See `docs/README.md` for the full
code-verified architecture reference; this file is just local setup.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Copy `.env.example` to `.env.local` and fill in at least:
```bash
SESSION_SECRET=any-random-secret-string-32-chars-min

# Zerodha — env-prefix pattern, one block per account
ZERODHA_ENVIRONMENT=TEST                # or PROD
TEST_ZERODHA_ACCOUNT1=DINESH
TEST_ZERODHA_API_KEY_DINESH=your_kite_connect_api_key
TEST_ZERODHA_API_SECRET_DINESH=your_kite_connect_secret

# AI provider for the morning briefing (pick one)
AI_PROVIDER=GEMINI
AI_GEMINI_API_KEY=your_key
AI_MODEL=gemini-2.5-flash
```
**Do not set `STATE_FILE_PATH` locally** — it's an EC2-only path; setting it on a
laptop crashes Kite OAuth with `ENOENT`. Leave `CRON_ENABLED` unset locally too,
unless you want auto-trading running against your dev machine.

See `CONTEXT.md` §9 for the full environment variable list, including email (SMTP)
config.

### 3. Run locally
```bash
npm run dev
# Open http://localhost:3000
```
Set `USE_MOCK_MARKET=true` to skip live Kite calls during pure-UI work.

### 4. Production deploy
Production runs on AWS EC2 (not Vercel) under PM2 + Caddy, because the app needs a
long-lived process for `node-cron` and filesystem persistence for its JSON data
store. See `CONTEXT.md` §11 or `docs/ARCHITECTURE.md` for the deploy runbook.

## Login
Password = current date+hour in IST: `ddmmyyyyhh` (e.g. 17 May 2026, 14:00 IST →
`1705202614`). Rotates hourly; there is no per-user login — see
`docs/MULTI_TENANCY_CURRENT_STATE.md` for exactly what that means today. Session
expires at midnight IST.

## Where things live
- `config/*.json` — checked-in **seed defaults** (strategy, watchlist, accounts, holidays)
- `data/*.json` / `data/*.jsonl` — **live runtime state**, gitignored, never touched by deploys. This is what the app actually reads day to day; it has drifted from the `config/` seeds — see `docs/DATA_MODEL.md`.
- `lib/` — all business logic (strategies, preflight gates, cron, Kite wrapper, journal)
- `app/` — Next.js pages + API routes

## Current trading rules (live, from `data/strategy.json` — see `docs/DATA_MODEL.md` for the full config-vs-live diff)
- Per-trade cap: ₹20,000 · Max 6 buys / 20 sells per day · Max 35 open positions
- Four strategies running: Accumulator (dip/mean-reversion), Catalyst (momentum), Market Boom (momentum), New Pivotal Strategy (breakout)
- No short selling, no F&O, no margin — CNC delivery only, NSE only
- 13-gate preflight chain before every order — see `docs/ARCHITECTURE.md` §5

## Full documentation
- `docs/README.md` — index of everything, start there
- `CONTEXT.md` — project history and narrative context
- `COPILOT.md` — full technical handoff (every `lib/` file, strategy tag system, patterns to follow)
