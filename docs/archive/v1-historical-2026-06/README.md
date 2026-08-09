# Archived — early-June-2026 snapshot docs

These three files (`context.md`, `functional-specification.md`,
`technical-specification.md`) are dated 07 Jun 2026 and were superseded by:

- Root `CONTEXT.md` (kept up to date through 09 Aug 2026)
- `docs/ARCHITECTURE.md`, `docs/APP_MAP.md`, `docs/DATA_MODEL.md`,
  `docs/MULTI_TENANCY_CURRENT_STATE.md` (written Aug 2026, verified line-by-line
  against the actual code)

They're kept for history, not accuracy — some content in them is now simply wrong,
not just stale:

- `context.md` describes Dinesh as "Founder & CEO of StudioVerse" and lists his own
  trading account as Motilal Oswal #2180536. Root `CONTEXT.md` explicitly states
  DineshTrade "has nothing to do with StudioVerse" and lists Dinesh's own account as
  Zerodha (the only broker this app actually integrates with).
- `functional-specification.md` / `technical-specification.md` describe an 8–11-gate
  preflight pipeline; the live code (`lib/preflight.ts`) implements 13 named gate
  checkpoints. See `docs/ARCHITECTURE.md` §Preflight Gates for the current, code-verified
  list.
- Both describe 2 shipped strategies (Accumulator, Catalyst); the live app runs 4
  (Accumulator, Catalyst, Market Boom, and a Pivotal/breakout strategy — see
  `docs/ARCHITECTURE.md` §Strategies).

If you're looking for the current, accurate picture of the app, start at
`docs/README.md`, not here.
