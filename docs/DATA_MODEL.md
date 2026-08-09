# DineshTrade — Data Model (code-verified against live files, 09 Aug 2026)

No database exists. Everything below is a real file read directly from the repo /
EC2 data directory. Two directories matter and they are **not the same thing**:

- `config/*.json` — checked into git. Bundled **seed defaults**.
- `data/*.json` — **never** committed (gitignored, EC2-only, `~/dineshtrade/data/`).
  The live runtime overlay the running app actually reads and mutates. On first read
  of a file that doesn't exist yet in `data/`, the store falls back to the
  `config/` seed; once saved via the UI, `data/` wins from then on.

**These two have already drifted apart substantially in this app.** Anyone reading
"the strategy config" or "the watchlist" needs to know which one they mean — treat
`data/` as ground truth for current behavior, `config/` as history/defaults only.

## 1. `config/` — checked-in seeds

| File | Shape | Current content |
|---|---|---|
| `accounts.json` | Array of `{ name, displayName, initials, color, note, reconciliationBase? }` | 2 accounts: `DINESH` (reconciliationBase 100002), `SONIA` (none). |
| `holidays.json` | `{ holidays: string[], tradingHours: {...} }` | 31 NSE holiday dates spanning 2025–2026 + session-window definitions. |
| `pivotalLists.json` | `{ generated, meta: { [key]: {name} }, lists: { [key]: entry[] } }` | One list, `pivotalA`, currently **empty**. |
| `strategy.json` | schema `"2.0"` — `{ capital, strategies[], capital_legacy, limits, targets, ... }` (legacy keys kept for Phase-1 back-compat per its own `_comment`) | **3 strategies seeded**: `accumulator`, `catalyst`, `market_boom` (seeded `active: false`). `capital.perTrade` seeded at ₹5,000, `maxPositions` 10, `maxBuysPerDay` 3. **All of this is stale relative to `data/strategy.json` — see §3.** |
| `watchlist.json` | `{ generated, rules, listA: entry[], listB: entry[] }`, entry = `{ nse, name, trades, lastTraded, sector }` | 108 symbols total: `listA` 62, `listB` 46. Derived from 5 years of trade-frequency history per the embedded `rules` block. |
| `notes.txt` | Plain text | Not config — a personal scratch file (deploy-script snippet + pasted AI session-continuation notes). Not machine-read by the app. |

## 2. `data/` — live runtime state (EC2, never wiped by deploys)

| File | Shape | Notes |
|---|---|---|
| `state.json` | `{ mode, selectedAccounts, kiteTokens, idempotencyLedger, buyHistory, panicSkipList }` | Contains a live Kite access token — sensitive. `panicSkipList` and `mode`/`selectedAccounts` are global, not per-account (see `docs/MULTI_TENANCY_CURRENT_STATE.md`). |
| `positions.json` | Object keyed `"ACCOUNT:SYMBOL"` → `{ strategyId, account, symbol, firstBuyPrice, firstBuyAt, totalQty, remainingQty, tranche1At, tranche1SoldQty, lots: [{id, boughtAt, entryPrice, originalQty, remainingQty, tranche1At, strategyId}] }` | Lot-based — supports multiple pyramid buys per symbol, each with independent tranche state. |
| `strategy.json` | Same schema-2.0 shape as the seed, but **live values**: 4 strategies (adds `new_pivotal`), `capital.perTrade` ₹20,000, `maxPositions` 35, `maxBuysPerDay` 6, `maxDeployPct` 100%. Carries `_updatedAt` (last write 2026-08-06). | **This is what actually runs.** See `docs/ARCHITECTURE.md` §6 for full per-strategy param detail. |
| `watchlist.json` | `{ generated, meta: {listA, listB, list3: "QuickWins", ...}, lists: {...} }` | Live list is smaller and different from the seed — `listA` 48 symbols (seed: 62), `listB` 1 symbol (seed: 46), plus a new `list3` "QuickWins" (10 symbols) the seed doesn't have at all. |
| `pivotalLists.json` | Mirrors seed shape | Still empty — `pivotalA` has zero symbols even though the live Pivotal strategy (`new_pivotal`) is active and pointed at it. |
| `daily-closes.json` | `{ schema, updatedAt, closes: { [symbol]: {date, close, volume, open?, high?, low?}[] } }` | Rolling cache, ~67 symbols, feeds EMA/momentum/ceiling calculations without re-hitting Kite. Capped at 60 entries/symbol. |
| `backtest-history.json` | `{ schema, updatedAt, runs: [...] }` | Persisted backtest run history — dozens of runs, each with full strategy snapshot + summary metrics + per-trade P&L. |
| `journal-YYYY-MM.jsonl` | Append-only JSON Lines, one file per IST month | Record `type`s: `order`, `trade`, `signal_skipped`, `strategy_scan`, `exit_monitor`, `monitor_heartbeat`. Never mutated, only appended. Mode `0o600`. |
| `strategy1.json.migrated`, `strategy2_positions.json.migrated` | Legacy pre-unification snapshots | Inert leftovers from the one-shot migration into the unified `positions.ts` store (with `strategyId`, `lots[]`). Kept only as a recovery path — not read by the running app. |

## 3. Known config-vs-live drift (as of this audit)

Worth stating explicitly since it's easy to check the wrong file and draw the wrong
conclusion about "current behavior":

| Field | `config/strategy.json` (seed) | `data/strategy.json` (live) |
|---|---|---|
| Strategy count | 3 (`accumulator`, `catalyst`, `market_boom`) | **4** — adds `new_pivotal` |
| `market_boom.active` | `false` | **`true`** |
| `capital.perTrade` | ₹5,000 | **₹20,000** |
| `capital.maxPositions` | 10 | **35** |
| `capital.maxBuysPerDay` | 3 | **6** |
| `capital.maxSellsPerDay` | 3 | **20** |
| `capital.maxDeployPct` | 80% | **100%** |
| `capital.intradayCircuitTripPct`/`ResumePct` | 0 / 0 (disabled) | **−3% / −2%** (enabled) |
| `capital.panicDropPct`/`panicWindowMin` | 0 / 0 (disabled) | **10% / 10min** (enabled) |

And for watchlists: seed `listA`/`listB` = 62/46 symbols; live `listA`/`listB`/`list3`
= 48/1/10 symbols. The seed files have not been kept in sync with the running app for
some time — this is worth cleaning up (making the seed match live, or documenting
that the seed is intentionally just a fallback/example) independent of any
multi-tenant work.

## 4. Core TypeScript shapes (from `lib/`)

```ts
// lib/positions.ts
interface PositionLot {
  id: string; boughtAt: string; entryPrice: number;
  originalQty: number; remainingQty: number;
  tranche1At?: string | null; tranche1SoldQty?: number; strategyId?: string;
}
interface Position {
  strategyId: string; account: string; symbol: string;
  firstBuyPrice: number; firstBuyAt: string;
  totalQty: number; remainingQty: number;
  tranche1At?: string | null; tranche1SoldQty?: number;
  lots?: PositionLot[];
}

// lib/strategyConfig.ts
type StrategyType = 'dip' | 'momentum' | 'pivotal'
interface CapitalConfig { perTrade, maxBuysPerDay, maxSellsPerDay, deliveryDpCharge,
  circuitBreakerPct, intradayCircuitTripPct, intradayCircuitResumePct,
  panicDropPct, panicWindowMin, maxDeployPct, sharedPool, maxPositions,
  maxBuysPerSymbol, minDropBetweenBuysPct }
interface Strategy { id, name, type: StrategyType, active, color, scanIntervalMin,
  watchlist: string[], params: DipParams | MomentumParams | PivotalParams,
  exits: { t1Pct, t2Pct }, giftNiftyGate: { enabled, minPct, maxPct } }
```

Use `asDipParams()` / `asMomentumParams()` / `asPivotalParams()` from
`lib/strategyConfig.ts` to narrow `Strategy.params` — never cast with `as any`.

## 5. Journal event types (append-only, `journal-YYYY-MM.jsonl`)

| `type` | Written by | Purpose |
|---|---|---|
| `order` | Every successful Kite order (manual + auto, BUY + SELL) | Ground truth for what actually executed — powers `/api/positions` reconciliation and Trade Report. |
| `trade` | Strategy monitors, on a completed BUY+SELL pair | Entry/exit pair with verdict, day-high/low, left-on-table. |
| `signal_skipped` | Cron auto-BUY, on preflight rejection | Gate + reason — powers the Skipped Orders page. |
| `strategy_scan` | Every strategy scan tick, regardless of outcome | Powers per-strategy health ("hasn't fired in 15 days"). |
| `exit_monitor` | Sell monitors | Exit-check bookkeeping. |
| `monitor_heartbeat` | Cron tick | Liveness signal for cron-status health checks. |
