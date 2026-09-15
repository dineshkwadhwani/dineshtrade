# DineshTrade — Data Model (code-verified against live Supabase stores, 15 Sep 2026)

Trading state is stored in Supabase. The repository's `clear/` directory contains
old local snapshots only and is not read by the live runtime.

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

## 2. Supabase — live runtime state

| Table | Contents |
|---|---|
| `customer_state` | Mode, broker session metadata, idempotency ledger, buy history, panic skip list. |
| `customer_positions` | Open positions and lot-level entry prices, quantities, strategy ownership, and sell state. |
| `orders` / `trades` / `signals_skipped` | Journal records, scoped by `customer_id`. |

Reset deletes the customer's `orders`, `trades`, and `signals_skipped`, clears
`customer_positions` and `customer_state` trading state, then re-seeds current
broker holdings as fresh BUY records.

## 3. Legacy/local files — not live trading state

| File | Shape | Notes |
|---|---|---|
| `clear/` legacy snapshots | Historical JSON snapshots | Not read by the V2 runtime; should not be used to diagnose live customer data. |
| `data/*.json` | Legacy V1/runtime artifacts | Not the source for V2 customer trading state. |

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

## 5. Multi-row and lot semantics

The position store is aggregate-by-`account + symbol`, but its `lots` array is the
behavioral source of truth. A repeated BUY appends a lot; it does not overwrite the
older lot's entry or tranche ladder. Each lot is independently evaluated and sold,
and `applyLotSell()` recomputes the parent totals after changing only that lot.
The parent weighted average and `firstBuyPrice` are summary/compatibility fields,
not SELL anchors.

Reporting rows are not guaranteed to be unique by symbol. `/api/positions` keeps
distinct journal trades and lot identities when the same symbol has different
strategies, a same-day sell and re-buy, or settled holdings plus T0 activity. Kite
often nets these into one symbol row, so Kite's row must not be used to decide the
application row shape.

Page rules:

- Holdings shows currently held quantity, clamps sold-today lots to zero, and uses
  buy cost for average price. After lot flattening, duplicate holdings/T0 inputs
  are deduped by `symbol + lotId`, preferring T0; no-lot rows use a composite key.
- Today's Positions preserves signed Kite day semantics: a pure sale from settled
  inventory may be negative, while a same-day round trip is zero/closed.
- Strategy positions and exit monitors use each lot's strategy and entry price.
  The parent strategy is only a legacy fallback when a lot has no strategy ID.
- Trade Report pairs journal order legs and must not derive closed trades from
  aggregate symbol quantities.

For the full operational contract, including re-tagging mixed-strategy lots and
recovery-created positions, see `CONTEXT.md` §18 and `COPILOT.md`'s “Multi-row /
lot contract” section.

## 6. Journal event types (append-only, `journal-YYYY-MM.jsonl`)

| `type` | Written by | Purpose |
|---|---|---|
| `order` | Every successful Kite order (manual + auto, BUY + SELL) | Ground truth for what actually executed — powers `/api/positions` reconciliation and Trade Report. |
| `trade` | Strategy monitors, on a completed BUY+SELL pair | Entry/exit pair with verdict, day-high/low, left-on-table. |
| `signal_skipped` | Cron auto-BUY, on preflight rejection | Gate + reason — powers the Skipped Orders page. |
| `strategy_scan` | Every strategy scan tick, regardless of outcome | Powers per-strategy health ("hasn't fired in 15 days"). |
| `exit_monitor` | Sell monitors | Exit-check bookkeeping. |
| `monitor_heartbeat` | Cron tick | Liveness signal for cron-status health checks. |
