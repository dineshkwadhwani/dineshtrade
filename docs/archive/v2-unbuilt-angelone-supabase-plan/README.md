# Archived — v2 "Angel One + Supabase SaaS" plan (never built)

**Status: speculative planning documents only. None of this was implemented.**

`FUNCTIONAL_SPEC.md` and `HANDOFF.md` in this folder describe a planned rewrite of
DineshTrade — swapping Zerodha Kite Connect for Angel One SmartAPI, moving from JSON
files to Supabase Postgres, and going from single-operator to a multi-user SaaS product
with billing plans.

**Verified against the actual codebase (Aug 2026): none of it exists.**

- No `supabase` dependency in `package.json`, no Supabase client code anywhere.
- No Angel One / SmartAPI code anywhere. Zerodha Kite Connect (`lib/kite.ts`) is the
  only broker integration, called directly — no `IBroker` interface or adapter layer.
- No `users`, `tenant_id`, or `organization` concept in any table, file, or route.
- The live app is still exactly the v1 architecture these docs describe as the
  starting point: Next.js + JSON files on disk (`data/*.json`) + PM2 on EC2 + a single
  shared time-based password (see `docs/MULTI_TENANCY_CURRENT_STATE.md`).

Kept here for historical reference only — this was a real planning conversation and
may be useful context for a future rebuild, but it must not be read as a description
of what the app does today. For that, see `docs/ARCHITECTURE.md` and
`docs/MULTI_TENANCY_CURRENT_STATE.md`.

One thing from this plan worth carrying forward if a broker-abstraction refactor
happens: `HANDOFF.md`'s "Broker Adapter Pattern" section sketches an `IBroker`
interface (`getMargins`, `getPositions`, `getHoldings`, `getOrders`, `getQuotes`,
`getHistoricalCandles`, `placeOrder`, `cancelOrder`, `resolveInstrumentToken`) sized
around swapping Zerodha for Angel One. No such interface exists in code today —
every caller uses `lib/kite.ts` directly.
