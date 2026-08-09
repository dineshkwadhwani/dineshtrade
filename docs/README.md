# DineshTrade — `docs/` index

**Start here.** Everything in this folder was reconciled against the actual code on
09 Aug 2026 — treat these as accurate; treat anything in `docs/archive/` as history
only, not a description of what the app does today.

## Current-state docs (code-verified, read these)

| Doc | What's in it |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stack, runtime/process model, auth, the real 13-gate preflight sequence, all 4 live strategies with current params, cron responsibilities, deploy. Start here for "how does this app work." |
| [`MULTI_TENANCY_CURRENT_STATE.md`](MULTI_TENANCY_CURRENT_STATE.md) | Precisely how multi-tenant the app is *today* — one operator, multiple broker sub-accounts, no user/login concept, per-account vs. global data scoping table. Read this before any multi-tenant refactor conversation. |
| [`APP_MAP.md`](APP_MAP.md) | Every page, every API route, every component — file by file. |
| [`DATA_MODEL.md`](DATA_MODEL.md) | Exact shape of every `config/*.json` (seed) and `data/*.json` (live) file, plus the drift that's accumulated between them. |
| [`TRADING_ENGINE_CORE.md`](TRADING_ENGINE_CORE.md) | Strategy/exit rules as a dense reference (decision trees, exit priority, charge model). |
| [`TradingEngine.md`](TradingEngine.md) | The same, as a one-page plain-English flowchart. |

## Root-level docs (project root, not in this folder)

- `CONTEXT.md` — narrative project history, trading philosophy, family-account
  background, phase-by-phase build log. Kept current through 09 Aug 2026.
- `COPILOT.md` — technical handoff for a coding assistant picking this up cold:
  full `lib/` file table, strategy tag system, data layer, patterns to follow.
- `README.md` — quick local setup instructions.

## Archive (`docs/archive/`) — history only, not current

- **`v2-unbuilt-angelone-supabase-plan/`** — a planning exercise for a full rewrite
  (Angel One broker + Supabase + multi-user SaaS + billing). **Verified never
  implemented** — no trace of Supabase, Angel One, or a broker-abstraction interface
  anywhere in the codebase. Kept for historical planning context only.
- **`v1-historical-2026-06/`** — earlier (07 Jun 2026) versions of the context/spec
  docs, superseded by the current-state docs above. Some content in them is now
  simply wrong (e.g. an outdated bio, an outdated broker for the primary account,
  outdated gate counts and strategy counts) — see that folder's own `README.md`.

## Why this reorg happened

The docs folder had accumulated three overlapping generations of context docs (a
historical one from June, a speculative "v2" rebuild plan that was never built, and
the current picture) with no clear signal for which one was true. This pass
reconciled everything against the actual code — `lib/`, `app/`, and the live
`data/*.json` files — and split the result into "current, verified" vs. "archived,
historical" so a reader doesn't have to guess which document to trust.
