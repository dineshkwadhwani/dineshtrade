# DineshTrade — App Map: Pages, API Routes, Components (code-verified, 09 Aug 2026)

Full inventory of `app/` and `components/` as they exist in code today. Cross-check
against `docs/ARCHITECTURE.md` for the underlying business logic each of these calls
into.

## 1. Pages — `app/(app)/*` (session-gated, all linked from `AppShell`'s nav)

| Path | File | What it does |
|---|---|---|
| `/dashboard` | `dashboard/page.tsx` | AI-generated morning briefing (global indices, GIFT Nifty, outlook, top recs), cached per IST day in `localStorage`. |
| `/engine` | `engine/page.tsx` | Trading Engine control page — recommendations, per-strategy rule tiles, cron/auto-mode health, pending-order cancel, manual execute via `OrderModal`. |
| `/health` | `health/page.tsx` | On-demand integration checks (Zerodha token, AI provider, SMTP) against `/api/health`. |
| `/holdings` | `holdings/page.tsx` | Current Holdings — settled Kite holdings merged with today's positions, lot-level breakdown, strategy badges, Buy/Sell. |
| `/manage-lists` | `manage-lists/page.tsx` | CRUD for the plain watchlists (`listA`/`listB`/custom) that dip/momentum strategies scan. |
| `/pivotal-lists` | `pivotal-lists/page.tsx` | CRUD for Pivotal breakout lists (per-symbol trigger/T1/T2/stop-loss). |
| `/positions` | `positions/page.tsx` | Today's broker-style open positions per account, live P&L, Square Off. |
| `/settings` | `settings/page.tsx` | Largest page. Tabs: General (account connect/mode toggle/reset), Strategies (edit capital + all 4 strategies), Backtest (run/compare/AI-analyze). |
| `/skipped-orders` | `skipped-orders/page.tsx` | Auto-BUY signals that were blocked by preflight, filterable by date/account/reason. |
| `/trade-report` | `trade-report/page.tsx` | Date-range journaled P&L report, filterable by account/strategy/symbol. |
| `/trades` | `trades/page.tsx` | Two views via `?view=`: Today's Orders (raw Kite order log) and Retrospective (daily/monthly report). |
| `/watchlist` | `watchlist/page.tsx` | Read-only watchlist viewer with live quotes; never originates orders except via explicit Buy button opening `OrderModal`. |

## 2. Root-level pages

| File | What it does |
|---|---|
| `app/layout.tsx` | Root HTML shell. Restores light/dark theme from `localStorage` pre-hydration to avoid flash. Renders `AppFooter` + children. No auth logic. |
| `app/page.tsx` | `/` — server component, pure redirector: `/dashboard` if session valid, else `/login`. |
| `app/login/page.tsx` | Server component — computes password hint + market status + IST time server-side, passes to `LoginClient`. |
| `app/login/LoginClient.tsx` | Client login form — live IST clock, market-open indicator, POSTs to `/api/auth`. |
| `middleware.ts` | Edge auth gate. Public: `/login`, `/api/auth`, Next static assets. Everything else requires a valid `dt_session` cookie or redirects to `/login`. API routes independently re-verify server-side. |

## 3. API routes — `app/api/*`

| Route | Methods | Purpose |
|---|---|---|
| `accounts` | GET | Configured broker account list + active env prefix. |
| `auth` | POST, DELETE | Login (password → session cookie, starts cron) / logout. |
| `capital` | GET | Live capital snapshot for one account (available/deployed/reserve/P&L/reconciliation). |
| `cron-status` | GET | Cron/strategy health — last-run times, staleness flags, today's counts. |
| `email/test` | POST, GET | Manual SMTP test send / config-status check (not wired into any page UI). |
| `health` | GET | Runs one of `zerodha`/`ai`/`email` integration checks; backs `/health` page. |
| `journal/[date]` | GET | Full `DailyReport` for one IST date. |
| `journal/dates` | GET | Dates with journal records (for date pickers). |
| `market/indices` | GET | Live index ticker snapshot (NIFTY/SENSEX/VIX/sector indices), one batched Kite `/quote` call. |
| `market` | GET | AI-generated market briefing for Dashboard. |
| `orders/cancel` | POST | Cancels a pending Kite order. |
| `pivotal-lists` | GET, POST, DELETE | CRUD for Pivotal breakout lists. |
| `positions` | GET | Core "today's positions" endpoint — merges live Kite positions + orders + journal trades into `EnrichedPosition[]`. Always `force-dynamic`, never cached. |
| `settings/reset` | POST | Hard per-account reset: wipes journal + positions + cron state, re-seeds from live Kite holdings as Accumulator. Requires `confirm: "RESET"`. |
| `state` | GET, POST, DELETE | Session-level app state (mode, selected accounts, token presence — never leaks raw tokens to client). |
| `strategies` | GET, POST | GET: full strategy-engine config + open-position counts. POST: validate + save + hot-reload cron. *(Note: a stale header comment claims POST "will land in Phase 4" — it's already fully implemented.)* |
| `strategy/backtest` | POST | Runs a strategy backtest, appends to history. |
| `strategy/backtest/history` | GET, DELETE | List / clear saved backtest runs. |
| `strategy/backtest/history/analyze` | POST | AI analysis across ≥3 saved runs. |
| `strategy/monitor` | POST | Runs the exit/position monitor across all accounts for all 3 strategy families — same function the cron tick calls, exposed for manual "Sync Positions Now". |
| `strategy/positions` | GET, POST | Unified positions store, annotated with strategy display name/color, journal-fallback tagging. |
| `strategy/tiles` | POST | Per-rule pass/fail tile evaluation for every watchlist symbol, joined with holdings for SELL-button state. |
| `strategy` | POST | Manual "Refresh & Scan" — mode-based recommendations + reactive dip scan + active pivotal strategies, merged and journaled. |
| `system-status` | GET | Traffic-light system health for Settings (cron heartbeat, journal, live margins/positions, capital deploy math). |
| `trade-report` | POST | Builds the live date-range trade report. |
| `version` | GET | Server process start time, shown in `AppFooter`. |
| `watchlist` | GET, POST, DELETE | Reads/saves the runtime watchlist overlay; accepts both legacy and current shapes. |
| `watchlist/search` | GET | Type-ahead NSE instrument search (Manage Lists, Pivotal Lists). |
| `zerodha` | GET, POST | Main Kite proxy — GET dispatches `?action=` (holdings/positions/margins/orders/quote/etc.); POST places orders through the full preflight gate chain unless `manual: true`. |
| `zerodha/callback` | GET | OAuth callback — exchanges `request_token` for an access token, saves to session state. |
| `zerodha/debug` | GET | Diagnostic-only endpoint (profile/holdings/quote calls) — **not called from any page**; intentionally curl/URL-only per its own header comment. |
| `zerodha/login` | GET | Sets a pending-account cookie, redirects to Kite's OAuth login. |
| `zerodha/token` | GET, POST, DELETE | Manual access-token paste flow (alternative to OAuth). |

No stub/placeholder routes were found — every route above has a real implementation.
Two are intentionally UI-unlinked debug utilities (`zerodha/debug`, `email/test` POST).

## 4. Components — `components/`

Only **6 real component files** exist. The scaffolded subfolders `components/ui/`,
`components/charts/`, and `components/app/` (plus its nested route folders) are
**completely empty** — any chart/UI-kit work would start from nothing, not extend
existing code there.

| File | Renders | Notes |
|---|---|---|
| `CapitalBar.tsx` | Per-account capital/P&L strip (2 rows × 4 cells) | Fetches `/api/capital` on mount/account change, no polling. |
| `FundsCard.tsx` | Available/Used/Net funds card | Fetches Kite margins on mount/account change only — explicitly no auto-poll per a code comment. |
| `LiveTicker.tsx` | Scrolling index strip above the top nav | Polls `/api/market/indices` every 30s; fewer indices shown on mobile. |
| `OrderModal.tsx` | Universal Buy/Sell modal, portal-rendered to `document.body` | Posts to `/api/zerodha` (`place_order`); `manual: true` by default, but Engine tiles pass the owning strategy's tag so attribution survives the manual-order path. |
| `layout/AppFooter.tsx` | Footer with author credit + live version (`/api/version`) | |
| `layout/AppShell.tsx` | Full app chrome — ticker + top nav + slide-down menu + theme toggle | Defines the hardcoded `NAV_GROUPS` that link every page in §1. Persists light/dark to `localStorage['dt-light']`. |
