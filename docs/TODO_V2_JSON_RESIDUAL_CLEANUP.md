## TODO: V2 JSON Residual Cleanup

Purpose: eliminate remaining file-based JSON usage paths in V2, while preserving safe rollback/reference points until Supabase-native replacements are proven.

Priority legend:
- P0 = highest (runtime risk)
- P1 = high (operational maintenance risk)
- P2 = medium (tech debt / consistency)
- P3 = low (archive / documentation)

## 1. Remove

Note: No immediate hard deletes are recommended before DB replacements are validated.

1. [DONE][P0] Remove legacy file-based fix-attribution route from V2 (direct removal decision)
- File: app/api/journal/fix-attribution/route.ts
- Status: Implemented in code (route removed from V2)
- Dependency: none (DB rewrite intentionally skipped for this item)

2. [DONE][P1] Remove legacy script after Supabase equivalent validation
- File: scripts/backfill-sectors.ts
- Status: Implemented in code (legacy script removed)

3. [DONE][P1] Remove legacy script after Supabase equivalent validation
- File: scripts/repair-position-by-journal.js
- Status: Implemented in code (legacy script removed)

4. [DONE][P2] Remove legacy script by direct cleanup decision
- File: scripts/inspect-positions.js
- Status: Implemented in code (legacy script removed; DB inspector intentionally skipped)

## 2. Move to a DB implementation with Supabase

Rule: Every item in this section is kept for reference until the DB implementation is complete and verified.

1. [CANCELLED][was P0] Replace file-based journal attribution repair with Supabase-native repair
- Current file: app/api/journal/fix-attribution/route.ts
- Status: superseded by direct removal decision
- Reason: endpoint is not part of active V2 flow and will be removed instead of migrated

2. [DONE][P1] Port sector backfill from watchlist.json to customer_watchlists
- Current file: scripts/backfill-sectors.ts
- Target: DB maintenance script that enriches symbols[].sector in customer_watchlists
- Status: Completed and validated; legacy script removed from V2 repo

3. [DONE][P1] Port position repair from jsonl/positions.json to DB tables
- Current file: scripts/repair-position-by-journal.js
- Target: reconstruct from orders/trades and patch customer_positions
- Status: Completed and validated; legacy script removed from V2 repo

4. [CANCELLED][was P1] Port positions inspector to DB-read diagnostics
- Current file: scripts/inspect-positions.js
- Target: read-only consistency checker for customer_positions
- Status: superseded by direct removal decision
- Reason: script was a one-off defect diagnostic and is not used in runtime/UI workflows

5. [P2] Reduce legacy strategy seed coupling in runtime logic
- Current files: lib/strategyEngine.ts, lib/cron.ts, lib/retrospective.ts
- Target: source defaults from strategyConfigStore / DB-backed config path only

## 3. Keep for now, but mark legacy

1. [P2] Keep bundled strategy fallback for resilience; mark and monitor
- File: lib/strategyConfigStore.ts
- Action: keep fallback, add operational note that prolonged fallback should alert

2. [P2] Keep config seed imports (non-state JSON reads) as intentional legacy
- Files: lib/accounts.ts, lib/market.ts, lib/journal.ts
- Action: annotate as seed config reads, not runtime state persistence

3. [P3] Keep migration bootstrap script as archived legacy utility
- File: scripts/migrate-to-supabase.ts
- Action: mark historical/bootstrap-only; do not run in normal runtime workflows

## Priority-Ordered Execution Queue

1. [DONE][P0] Item 1.1 remove journal fix-attribution route from V2
2. [DONE][P1] Item 2.3 DB position repair tool
3. [DONE][P2] Item 1.4 remove legacy inspect-positions script (DB inspector not needed)
4. [DONE][P1] Item 2.2 DB sector backfill tool
5. [P1/P2] Item 1 removals for remaining scripts after DB replacements pass verification
6. [P2] Item 2.5 remove legacy strategy.json fallback usage in engine/cron/retrospective
7. [P2/P3] Item 3 legacy marking and archive hygiene

## Verification Gates Before Any Removal

1. Grep check in app/ and lib/: no writeFile/writeFileSync path writes to data/*.json or *.jsonl.
2. Smoke test V2 critical APIs: positions, state, watchlist, strategies, journal dates/day.
3. Validate rewritten maintenance tools on staging data (or dry-run mode) before deleting legacy scripts.
4. Keep rollback window (one release) where legacy references remain available but disabled.
