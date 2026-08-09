# Multi-Tenancy — Current State (code-verified, 09 Aug 2026)

**Purpose:** a precise, honest description of how "multi-tenant" the app actually is
today — no proposals, no future plan. Written because the app is described as
"partially multi-tenant" and any refactor conversation needs to start from what's
really there, not from what earlier planning docs assumed would exist.

## The one-sentence version

DineshTrade has **one human operator, multiple broker sub-accounts**. It is not
multi-user. What looks like tenancy is account-switching inside a single shared
session, not isolation between separate customers.

## What "account" means today

An "account" (`DINESH`, `SONIA`) is a **Zerodha Kite Connect credential slot**, not a
person with their own login. Concretely:

- `lib/accounts.ts` enumerates accounts purely from environment variables:
  `{PREFIX}_ZERODHA_ACCOUNT1`, `{PREFIX}_ZERODHA_ACCOUNT2`, … (stops at the first
  gap), where `{PREFIX}` is `ZERODHA_ENVIRONMENT` (`PROD` or `TEST` — an environment
  selector, not a tenant selector).
- Each account name then resolves its own API key/secret from
  `{PREFIX}_ZERODHA_API_KEY_{NAME}` / `{PREFIX}_ZERODHA_API_SECRET_{NAME}`.
- `config/accounts.json` only adds cosmetic metadata (display name, initials, color,
  an optional `reconciliationBase`) — no credentials live there.
- Currently configured: `DINESH` (primary) and `SONIA` (daughter's account). Only
  `DINESH` has an active Kite session/token in live `data/state.json` at the time of
  this audit.
- Adding a new account today means editing `.env` + redeploying — there is no
  self-service "connect your broker" UI flow that creates a new account slot at
  runtime.

## There is no user/login concept at all

`lib/auth.ts` has **no user identity**:

- The password is `ddmmyyyyhh` (day/month/year/hour in IST) — a single shared secret
  derived from the server clock, rotating hourly. Anyone who knows the scheme can
  compute it; it is not tied to any individual.
- On successful login, the JWT payload is a **hardcoded literal**:
  `{ user: 'dinesh', role: 'trader' }`. This is not read from the login input — every
  session ever issued carries the same baked-in identity string, regardless of who
  actually typed the password.
- There is exactly one session cookie (`dt_session`) model for the whole app. No
  per-user rows, no signup, no password-per-person, no roles beyond the one hardcoded
  string.

**Consequence:** "who is logged in" and "which broker account is currently selected"
are two completely different, currently-conflated things. The refactor needs to
introduce the first concept from scratch — it does not exist to be extended.

## What is scoped per-account vs. shared globally right now

This is the part that matters most for scoping a multi-tenant rewrite — the app
already has *some* per-account isolation, but a lot of state is deliberately shared
across every account under the one operator.

| Data | Scope today | Where |
|---|---|---|
| Kite access tokens | Per-account | `state.kiteTokens[account]` |
| Idempotency ledger (one BUY/day/symbol) | Per-account | key `${ACCOUNT}:${DATE}:${SYMBOL}:${SIDE}` inside one shared map |
| Pyramid buy history | Per-account | key `${ACCOUNT}:${SYMBOL}` inside one shared map |
| Panic-sell skip list | **Global, not per-account** | keyed only by date — "a stock in panic is in panic for every account" (explicit code comment in `lib/state.ts`) |
| Trading mode (`auto`/`manual`) | **Global** | one `state.mode` value for the entire app — there is no per-account auto/manual toggle |
| `selectedAccounts` (which accounts auto-mode trades) | **Global list** | one array, not per-account state |
| Open positions (`positions.json`) | Per-account | every row keyed `${ACCOUNT}:${SYMBOL}` |
| Trade journal (`journal-YYYY-MM.jsonl`) | Shared file, account-tagged records | every record carries an `account` field; not physically separated per account |
| **Strategy definitions** (`data/strategy.json` — Accumulator, Catalyst, Market Boom, Pivotal, and their params/exits/gates) | **Global — one config for every account** | no `account` field anywhere in `lib/strategyConfigStore.ts` |
| **Watchlists** (`data/watchlist.json`) | **Global** | shared symbol lists every account's strategy scans read identically |
| **Pivotal lists** (`data/pivotalLists.json`) | **Global** | same pattern |
| Capital caps (`perTrade`, `maxPositions`, `maxBuysPerDay`, …) | **Global** | one `capital` block inside `data/strategy.json`, applied identically to every account regardless of that account's actual size |
| Email notifications | **Global** | one shared `SMTP_USER` / `NOTIFY_TO` — all accounts' trade/report emails go to the same inbox |
| Cron scheduler | **Global, single process** | one PM2-owned Node process runs one set of node-cron tasks; every task loops `Object.keys(state.kiteTokens)` internally — there is no per-account or per-tenant isolation at the process level |

**Bottom line:** trading *execution state* (tokens, positions, idempotency, buy
history) is already per-account. Trading *strategy* (what to buy, when, with what
risk limits) is global and shared. A real multi-tenant model needs both a new
identity layer (see above) **and** per-account (or per-tenant) strategy/capital
config, which today is a single shared blob.

## Broker coupling

- `lib/kite.ts` is a direct, concrete Zerodha REST wrapper. There is no `IBroker`
  interface or adapter pattern anywhere in the codebase — every caller (preflight,
  cron, strategy engine, API routes) imports `lib/kite.ts` functions directly.
- The abandoned `docs/archive/v2-unbuilt-angelone-supabase-plan/HANDOFF.md` sketches
  an `IBroker` interface shape for a Zerodha↔Angel One swap. It was never built, but
  the interface shape it proposes is a reasonable starting sketch if broker
  abstraction becomes part of the refactor scope.

## Persistence coupling

- Everything is flat JSON/JSONL files under `data/` (state, positions, strategy
  overlay, watchlist overlay, pivotal lists, daily-closes cache, backtest history,
  monthly journal files). No database, no ORM, no query layer.
- `lib/positions.ts` wraps all reads/writes in an in-process async mutex
  (`withLock`) because the whole app is one long-lived Node process (PM2, not
  clustered) — this only works because there is exactly one process. It would not
  hold if the app ever ran as more than one instance/replica.
- Config vs. runtime split: `config/*.json` are checked-in **seed defaults**;
  `data/*.json` are the **live runtime overlay** that the running app actually reads
  and mutates. These two have already drifted significantly from each other (see
  `docs/DATA_MODEL.md`) — worth knowing before assuming "the config file" means either
  one unambiguously.

## What would have to be introduced, not just extended

Because none of the following exist today, a multi-tenant rewrite is closer to
"add a new layer underneath everything" than "widen an existing one":

1. A real user/identity model (signup, per-person credentials, sessions tied to an
   actual identity) — `lib/auth.ts` has zero surface area to build on.
2. A way to scope strategy config, watchlists, pivotal lists, and capital caps **per
   tenant** instead of one global config shared by every account.
3. A way to scope email notifications per tenant instead of one shared inbox.
4. Either a multi-process-safe persistence layer (replacing the single in-process
   mutex + flat files) or an explicit decision to keep one process per tenant.
5. A decoupling of "broker account" from "tenant" — today they're conflated 1:1 by
   convention (one operator, a few named broker sub-accounts they personally own);
   a real tenant model needs many tenants each owning 1+ broker accounts.
