-- ================================================================
-- Phase 4 schema extensions — run this in the Supabase SQL Editor
-- against the live DB before/alongside deploying the Phase 4 code.
-- Idempotent (IF NOT EXISTS everywhere) — safe to re-run.
--
-- Context: DALGO_SUPABASE_SCHEMA_v2.sql defines customer_state and
-- customer_positions without a home for a few fields the V1 code still
-- carries. Rather than change business logic to fit the schema (forbidden
-- by the Phase 4 task brief), we extend the schema narrowly to fit the
-- existing, unchanged business logic. Decided with the user during Phase 4
-- (2026-08-09) — see chat: "Add session_meta jsonb column (Recommended)".
-- ================================================================

-- customer_state: kiteTokens (per-account Kite access tokens) and
-- selectedAccounts (which of the legacy multi-account set is active) have
-- no dedicated columns in the v2 schema. They're V1 multi-account
-- concepts (DINESH/KIRAN/SHEELA/SONIA in one process) that predate the
-- one-broker-account-per-customer-instance model and are still read by
-- ~12 live trading files outside Phase 4's scope (cronBuy, cronEOD,
-- strategy1/2, pivotal, cronReconcile, kite.ts, intradayCircuit,
-- panicSell, retrospective, tradeReport). Retiring them in favour of
-- broker_accounts.access_token_enc is real work for a later phase.
-- Until then, they're persisted verbatim in this jsonb blob so
-- lib/state.ts can drop STATE_FILE_PATH entirely.
alter table customer_state
  add column if not exists session_meta jsonb not null default '{}';

-- customer_positions: strategy_id (uuid, FK to customer_strategies) can't
-- hold the current string strategy ids ('accumulator', 'catalyst', ad hoc
-- user-created ids) without Phase 5's proper strategy-registry wiring.
-- strategy_tag carries that string at the row level (lots jsonb already
-- carries a per-lot strategyId — this is the row-level summary of the
-- same concept, mirroring the in-memory Position.strategyId field).
--
-- account: the table's unique key is (customer_id, symbol) — no account
-- dimension, matching the one-broker-account-per-customer model. But
-- every lib/positions.ts function signature takes `account: string` (kept
-- unchanged per the Phase 4 brief) and legacy multi-account V1 data uses
-- it as part of the identity. Persisted verbatim; harmless since exactly
-- one account value is ever used per customer instance in practice.
alter table customer_positions
  add column if not exists strategy_tag text,
  add column if not exists account text not null default '';

-- orders / trades / signals_skipped / strategy_scans: the lean journal
-- schema (§8.4) is intentionally slim, but lib/journal.ts's existing record
-- shapes (unchanged business logic, per the Phase 4 brief) carry a few
-- fields these tables have no column for: the legacy multi-account
-- `account` identity (same rationale as customer_positions.account above),
-- the string strategy tag (same rationale as customer_positions.strategy_tag
-- — the uuid strategy_id FK stays null until Phase 5), and — for `trades`
-- specifically — report fields (dayHighAfterEntry/dayLowAfterEntry/
-- leftOnTable/notes, used by lib/retrospective.ts, lib/email.ts and the
-- trades page) and the Kite (broker) order-id strings for the entry/exit
-- legs, which are NOT the same thing as the uuid buy_order_id/sell_order_id
-- FK columns (those point at this app's own `orders` rows, Phase 5 work).
alter table orders
  add column if not exists account text not null default '',
  add column if not exists strategy_tag text;

alter table trades
  add column if not exists account text not null default '',
  add column if not exists strategy_tag text,
  add column if not exists day_high_after_entry numeric,
  add column if not exists day_low_after_entry numeric,
  add column if not exists left_on_table numeric,
  add column if not exists notes text,
  add column if not exists buy_order_broker_id text,
  add column if not exists sell_order_broker_id text;

alter table signals_skipped
  add column if not exists account text not null default '';

alter table strategy_scans
  add column if not exists account text not null default '',
  add column if not exists strategy_tag text,
  add column if not exists strategy_name text;

-- customer_strategies: business logic keys every strategy by a stable,
-- immutable STRING id ('accumulator', 'catalyst', 'market_boom', ad hoc
-- customer-created ids) — used everywhere (positions.strategyId, journal
-- strategy_tag, getStrategyById(id), the whole strategy engine). The table's
-- primary key is a DB-generated uuid and its unique key is (customer_id,
-- name) — but `name` is a user-editable display label (spec §7.4: customer
-- "names it, modifies params" after copying a template), not a stable
-- identifier, and platform_strategy_id isn't unique per customer either (a
-- customer can create two strategies off the same template). strategy_key
-- is the Phase-4-added stable string id lib/strategyConfigStore.ts persists
-- and reads back as Strategy.id, with its own unique constraint used as the
-- upsert conflict target (renames must UPDATE the existing row, not INSERT
-- a new one under the old name's unique key).
alter table customer_strategies
  add column if not exists strategy_key text;

create unique index if not exists customer_strategies_customer_key
  on customer_strategies(customer_id, strategy_key)
  where strategy_key is not null;
