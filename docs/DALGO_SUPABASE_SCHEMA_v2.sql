-- DAlgo Supabase Schema v2.0
-- Extracted from DALGO_REFACTOR_SPEC_v2.md
-- Run this ENTIRE script in Supabase SQL Editor
-- Date: 09 Aug 2026

-- ================================================================
-- DALGO DATABASE SCHEMA v2.0
-- Run this entire script in Supabase SQL Editor
-- ================================================================

-- Platform configuration
create table if not exists platform_config (
  key text primary key,
  value text not null,
  description text,
  value_type text not null default 'string'
    check (value_type in ('string', 'boolean', 'number', 'json')),
  updated_at timestamptz default now(),
  updated_by uuid
);

insert into platform_config (key, value, description, value_type) values
('DALGO_APP_NAME', 'DAlgo', 'Application display name', 'string'),
('DALGO_REGISTRATION_DISCLAIMER',
 'DAlgo is a software platform that enables automated trading. We are not a SEBI-registered investment advisor and do not provide investment advice. All trading strategies, parameters, and decisions are yours. By registering, you confirm you have read and understood our Terms of Service, Privacy Policy, and Risk Disclosure.',
 'Disclaimer shown on registration page', 'string'),
('DALGO_STRATEGY_DISCLAIMER',
 'This is a strategy template, not investment advice. By enabling this strategy you confirm that these are your own trading decisions, you have reviewed all parameters, and you take full responsibility for all trades placed by this strategy. DAlgo is a software platform only.',
 'Disclaimer shown when customer enables a strategy', 'string'),
('SUREPASS_KYC_ENABLED', 'false',
 'Enable Surepass V2 full Aadhar KYC validation. When false, images stored but not validated.',
 'boolean'),
('SMS_OTP_ENABLED', 'false',
 'Enable mobile SMS OTP verification (V2 feature — TODO in code)', 'boolean'),
('STRATEGY_SCAN_DB_ENABLED', 'false',
 'Store strategy_scan records in Supabase (increases DB usage 73%)', 'boolean'),
('HEARTBEAT_DB_ENABLED', 'false',
 'Store monitor_heartbeat records in Supabase. Default off — dropped entirely.', 'boolean'),
('TOKEN_ALERT_TIME_IST', '09:00',
 'Time HH:MM IST to send token-missing alerts', 'string'),
('SUPPORT_EMAIL', 'support@dalgo.online',
 'Support email shown to users', 'string')
on conflict (key) do nothing;

-- Fixed rules
create table if not exists platform_fixed_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  rule_name text not null,
  description text,
  value jsonb not null,
  value_type text not null check (value_type in ('boolean', 'number', 'string')),
  warning_message text,
  updated_at timestamptz default now(),
  updated_by uuid
);

insert into platform_fixed_rules (rule_key, rule_name, description, value, value_type, warning_message) values
('sell_monitor_cadence_min', 'Sell monitor cadence (minutes)',
 'How often the SELL monitor runs during market hours.',
 '5', 'number',
 'Changing sell monitor cadence affects all customers immediately. Lower values increase API usage significantly.'),
('no_short_selling', 'No short selling',
 'Block SELL orders when account does not hold that symbol.',
 'true', 'boolean',
 'WARNING: Disabling this allows short selling. This fundamentally changes the trading philosophy.'),
('no_fo_trading', 'No F&O trading',
 'Only NSE cash equity segment permitted.',
 'true', 'boolean',
 'WARNING: This platform is not designed for F&O trading.'),
('no_loss_sell_auto', 'Auto mode no-loss sell rule',
 'Never sell below average cost in auto mode. The foundational DAlgo rule.',
 'true', 'boolean',
 'WARNING: Disabling this allows selling at a loss in auto mode. This changes the DAlgo philosophy fundamentally.'),
('order_product_type', 'Order product type',
 'All automated orders placed as this product type.',
 '"CNC"', 'string',
 'Changing product type affects all future orders across all customers.'),
('exchange', 'Exchange',
 'Exchange for all automated orders.',
 '"NSE"', 'string',
 'Changing exchange affects all customers. NSE is the only supported exchange.')
on conflict (rule_key) do nothing;

-- User profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('superadmin', 'account_manager', 'broking_company', 'customer')),
  full_name text not null,
  email text not null,
  mobile text,
  status text not null default 'pending'
    check (status in ('pending', 'under_review', 'identity_verified', 'active', 'suspended', 'rejected')),
  assigned_account_manager_id uuid references profiles(id),
  broking_company_id uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Registrations and KYC
create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  registration_type text not null check (registration_type in ('customer', 'broking_company')),
  full_name text not null,
  dob date,
  address text,
  city text,
  state text,
  pincode text,
  mobile text,
  aadhar_number text,
  aadhar_front_url text,
  aadhar_back_url text,
  surepass_result jsonb,
  surepass_verified boolean default false,
  company_name text,
  gst_number text,
  company_registration_number text,
  company_address text,
  company_city text,
  company_state text,
  company_pincode text,
  company_email text,
  company_mobile text,
  assigned_to uuid references profiles(id),
  step1_approved_at timestamptz,
  step1_approved_by uuid references profiles(id),
  rejection_reason text,
  step2_activated_at timestamptz,
  step2_activated_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Broker accounts
create table if not exists broker_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  broker_name text not null check (broker_name in ('zerodha','upstox','angelone','aliceblue','dhan','5paisa')),
  client_code text,
  api_key_enc text,
  api_secret_enc text,
  access_token_enc text,
  refresh_token_enc text,
  token_captured_at timestamptz,
  token_expires_at timestamptz,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id, broker_name)
);

-- Customer EC2 instances
create table if not exists customer_instances (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade unique,
  -- subdomain/instance_url nullable (Phase 5): the cron heartbeat/token-status
  -- writer (lib/instanceStatus.ts) upserts this row from the customer EC2
  -- itself and must be able to create it before the provisioning runbook
  -- (spec §5.7) has recorded these — NULLs are fine under a unique index.
  subdomain text unique,
  instance_url text,
  elastic_ip text,
  ec2_instance_id text,
  status text not null default 'provisioning'
    check (status in ('provisioning','active','suspended','terminated')),
  last_heartbeat_at timestamptz,
  last_cron_tick_at timestamptz,
  last_reset_at timestamptz,
  kite_token_status text default 'missing'
    check (kite_token_status in ('connected','missing','expired')),
  cron_mode text default 'manual' check (cron_mode in ('auto','manual')),
  open_positions_count integer default 0,
  todays_orders_count integer default 0,
  todays_buy_count integer default 0,
  todays_sell_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- SSO tokens
create table if not exists sso_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  customer_id uuid not null references profiles(id) on delete cascade,
  used boolean default false,
  used_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Platform capital defaults
create table if not exists platform_capital_defaults (
  id uuid primary key default gen_random_uuid(),
  per_trade numeric not null default 5000,
  max_buys_per_day integer not null default 3,
  max_sells_per_day integer not null default 10,
  max_positions integer not null default 10,
  max_buys_per_symbol integer not null default 3,
  min_drop_between_buys_pct numeric not null default 10,
  max_deploy_pct numeric not null default 80,
  delivery_dp_charge numeric not null default 15.34,
  circuit_breaker_pct numeric not null default -5,
  intraday_circuit_trip_pct numeric not null default -3,
  intraday_circuit_resume_pct numeric not null default -2,
  panic_drop_pct numeric not null default 0,
  panic_window_min integer not null default 0,
  updated_at timestamptz default now()
);

insert into platform_capital_defaults
  (per_trade,max_buys_per_day,max_sells_per_day,max_positions,max_buys_per_symbol,
   min_drop_between_buys_pct,max_deploy_pct,delivery_dp_charge,circuit_breaker_pct,
   intraday_circuit_trip_pct,intraday_circuit_resume_pct,panic_drop_pct,panic_window_min)
values (5000,3,10,10,3,10,80,15.34,-5,-3,-2,0,0)
on conflict do nothing;

-- Platform strategies (templates)
create table if not exists platform_strategies (
  id text primary key,
  name text not null,
  type text not null check (type in ('dip','momentum','pivotal')),
  active boolean default true,
  published boolean default false,
  color text default '#3B82F6',
  scan_interval_min integer default 5,
  watchlist_keys text[] default array['listA'],
  params jsonb not null,
  exits jsonb not null,
  gift_nifty_gate jsonb,
  description text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Platform watchlists
create table if not exists platform_watchlists (
  id uuid primary key default gen_random_uuid(),
  list_key text not null unique,
  name text not null,
  symbols jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Platform pivotal lists
create table if not exists platform_pivotal_lists (
  id uuid primary key default gen_random_uuid(),
  list_id text not null unique,
  name text not null,
  entries jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Customer capital config
create table if not exists customer_capital_config (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade unique,
  per_trade numeric not null default 5000,
  max_buys_per_day integer not null default 3,
  max_sells_per_day integer not null default 10,
  max_positions integer not null default 10,
  max_buys_per_symbol integer not null default 3,
  min_drop_between_buys_pct numeric not null default 10,
  max_deploy_pct numeric not null default 80,
  delivery_dp_charge numeric not null default 15.34,
  circuit_breaker_pct numeric not null default -5,
  intraday_circuit_trip_pct numeric not null default -3,
  intraday_circuit_resume_pct numeric not null default -2,
  panic_drop_pct numeric not null default 0,
  panic_window_min integer not null default 0,
  updated_at timestamptz default now(),
  updated_by uuid references profiles(id)
);

-- Customer strategies (copies from platform templates)
create table if not exists customer_strategies (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  platform_strategy_id text references platform_strategies(id),
  -- Phase 4 addition — stable string id (business logic's Strategy.id, e.g.
  -- 'accumulator'/'catalyst'). See scripts/migrations/2026-08-09-*.sql for
  -- why this can't just be `name` or `platform_strategy_id`.
  strategy_key text,
  name text not null,
  type text not null check (type in ('dip','momentum','pivotal')),
  active boolean default false,
  color text default '#3B82F6',
  scan_interval_min integer default 5,
  watchlist_keys text[] default array['listA'],
  params jsonb not null,
  exits jsonb not null,
  gift_nifty_gate jsonb,
  enabled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id, name)
);

create unique index if not exists customer_strategies_customer_key
  on customer_strategies(customer_id, strategy_key)
  where strategy_key is not null;

-- Customer watchlists
create table if not exists customer_watchlists (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  list_key text not null,
  name text not null,
  symbols jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id, list_key)
);

-- Customer pivotal lists
create table if not exists customer_pivotal_lists (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  list_id text not null,
  name text not null,
  entries jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id, list_id)
);

-- Customer positions
create table if not exists customer_positions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  broker_account_id uuid references broker_accounts(id),
  strategy_id uuid references customer_strategies(id),
  -- string strategy id ('accumulator', 'catalyst', ad hoc user ids) — the
  -- FK above stays null until Phase 5 wires up the strategy registry
  -- properly. Added in Phase 4 (scripts/migrations/2026-08-09-*.sql).
  strategy_tag text,
  symbol text not null,
  -- Legacy V1 multi-account identity (DINESH/KIRAN/SHEELA/SONIA). The
  -- table's unique key intentionally has no account dimension (one broker
  -- account per customer instance), but lib/positions.ts still takes
  -- `account` on every call. Added in Phase 4.
  account text not null default '',
  total_qty integer not null default 0,
  remaining_qty integer not null default 0,
  first_buy_price numeric not null,
  first_buy_at timestamptz not null,
  tranche1_at timestamptz,
  tranche1_sold_qty integer default 0,
  lots jsonb default '[]',
  status text not null default 'open' check (status in ('open','closed','handed_off')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id, symbol)
);

-- Customer state (replaces state.json)
create table if not exists customer_state (
  customer_id uuid primary key references profiles(id) on delete cascade,
  cron_mode text not null default 'manual' check (cron_mode in ('auto','manual')),
  idempotency_ledger jsonb not null default '{}',
  buy_history jsonb not null default '{}',
  panic_skip_list jsonb not null default '{}',
  daily_buy_count integer default 0,
  daily_sell_count integer default 0,
  day_key text,
  circuit_tripped boolean default false,
  gift_nifty_change_pct numeric,
  -- Legacy V1 multi-account fields with no dedicated column: kiteTokens
  -- (per-account Kite access tokens) and selectedAccounts. Persisted
  -- verbatim so lib/state.ts can drop STATE_FILE_PATH. Retiring these in
  -- favour of broker_accounts.access_token_enc is later-phase work — see
  -- scripts/migrations/2026-08-09-phase4-schema-extensions.sql.
  session_meta jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- Orders (lean journal)
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  broker_account_id uuid references broker_accounts(id),
  strategy_id uuid references customer_strategies(id),
  -- legacy V1 multi-account identity + string strategy tag — see the
  -- customer_positions comment above. Added in Phase 4.
  account text not null default '',
  strategy_tag text,
  symbol text not null,
  side text not null check (side in ('BUY','SELL')),
  qty integer not null,
  price numeric not null,
  broker_order_id text,
  tag text,
  status text not null,
  source text not null check (source in ('auto','manual')),
  reason text,
  trade_date date not null,
  created_at timestamptz default now()
);

-- Trades (completed pairs)
create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  strategy_id uuid references customer_strategies(id),
  -- Phase 4 additions: legacy account identity, string strategy tag, report
  -- fields used by lib/retrospective.ts/lib/email.ts/the trades page, and
  -- the Kite (broker) order-id strings for each leg — distinct from the uuid
  -- buy_order_id/sell_order_id FKs below, which point at this app's own
  -- `orders` rows (Phase 5 wiring).
  account text not null default '',
  strategy_tag text,
  day_high_after_entry numeric,
  day_low_after_entry numeric,
  left_on_table numeric,
  notes text,
  buy_order_broker_id text,
  sell_order_broker_id text,
  symbol text not null,
  qty integer not null,
  entry_price numeric not null,
  entry_time timestamptz not null,
  exit_price numeric,
  exit_time timestamptz,
  pnl_rupees numeric,
  pnl_pct numeric,
  verdict text check (verdict in ('correct_exit','early_exit','delivery','manual')),
  buy_order_id uuid references orders(id),
  sell_order_id uuid references orders(id),
  trade_date date not null,
  created_at timestamptz default now()
);

-- Signals skipped
create table if not exists signals_skipped (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  strategy_id uuid references customer_strategies(id),
  -- Phase 4 addition — see customer_positions.account above.
  account text not null default '',
  symbol text not null,
  signal_price numeric,
  gate text not null,
  reason text not null,
  signal_date date not null,
  signal_time text,
  created_at timestamptz default now()
);

-- Strategy scans (optional — only when STRATEGY_SCAN_DB_ENABLED = true)
create table if not exists strategy_scans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  strategy_id uuid references customer_strategies(id),
  -- Phase 4 additions — string strategy id/name (StrategyScanRecord has no
  -- uuid to give strategy_id yet) + legacy account identity.
  account text not null default '',
  strategy_tag text,
  strategy_name text,
  recs integer default 0,
  executed integer default 0,
  symbols text[],
  skip_reason text,
  scanned_at timestamptz default now(),
  scan_date date not null
);

-- Shared daily closes (not per user)
create table if not exists daily_closes (
  symbol text not null,
  trade_date date not null,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  close_price numeric not null,
  volume bigint,
  updated_at timestamptz default now(),
  primary key (symbol, trade_date)
);

-- Backtest runs
create table if not exists backtest_runs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  strategy_id uuid references customer_strategies(id),
  strategy_name text,
  strategy_type text,
  params jsonb,
  results jsonb,
  ai_analysis text,
  run_at timestamptz default now()
);

-- Audit log
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  actor_role text,
  actor_name text,
  action text not null,
  target_type text,
  target_id text,
  target_name text,
  before_value jsonb,
  after_value jsonb,
  ip_address text,
  created_at timestamptz default now()
);

-- Email log
create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references profiles(id),
  recipient_email text not null,
  event_type text not null,
  subject text,
  status text default 'sent' check (status in ('sent','failed','pending')),
  error_message text,
  sent_at timestamptz default now()
);

-- ================================================================
-- INDEXES
-- ================================================================

create index if not exists idx_orders_customer_date on orders(customer_id, trade_date desc);
create index if not exists idx_orders_customer_symbol on orders(customer_id, symbol);
create index if not exists idx_orders_broker_order_id on orders(broker_order_id) where broker_order_id is not null;
create index if not exists idx_trades_customer_date on trades(customer_id, trade_date desc);
create index if not exists idx_positions_customer on customer_positions(customer_id);
create index if not exists idx_positions_customer_symbol on customer_positions(customer_id, symbol);
create index if not exists idx_positions_open on customer_positions(customer_id, status) where status = 'open';
create index if not exists idx_daily_closes on daily_closes(symbol, trade_date desc);
create index if not exists idx_signals_date on signals_skipped(customer_id, signal_date desc);
create index if not exists idx_audit_log on audit_log(actor_id, created_at desc);
create index if not exists idx_sso_active on sso_tokens(token) where used = false;
create index if not exists idx_sso_expiry on sso_tokens(expires_at) where used = false;
create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_profiles_status on profiles(status);
create index if not exists idx_profiles_manager on profiles(assigned_account_manager_id) where assigned_account_manager_id is not null;
create index if not exists idx_customer_strategies on customer_strategies(customer_id);
create index if not exists idx_customer_strategies_active on customer_strategies(customer_id, active) where active = true;
create index if not exists idx_instances_active on customer_instances(status) where status = 'active';

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

alter table profiles enable row level security;
alter table registrations enable row level security;
alter table broker_accounts enable row level security;
alter table customer_instances enable row level security;
alter table customer_strategies enable row level security;
alter table customer_watchlists enable row level security;
alter table customer_pivotal_lists enable row level security;
alter table customer_capital_config enable row level security;
alter table customer_positions enable row level security;
alter table customer_state enable row level security;
alter table orders enable row level security;
alter table trades enable row level security;
alter table signals_skipped enable row level security;
alter table backtest_runs enable row level security;
alter table strategy_scans enable row level security;
alter table sso_tokens enable row level security;
alter table audit_log enable row level security;
alter table email_log enable row level security;
alter table daily_closes enable row level security;
alter table platform_strategies enable row level security;
alter table platform_watchlists enable row level security;

-- Helper functions
create or replace function is_superadmin()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'superadmin')
$$ language sql security definer;

create or replace function is_account_manager()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'account_manager')
$$ language sql security definer;

create or replace function get_my_role()
returns text as $$
  select role from profiles where id = auth.uid()
$$ language sql security definer;

-- RLS Policies
create policy "profiles_read" on profiles for select using (
  auth.uid() = id or is_superadmin() or is_account_manager()
  or exists (select 1 from profiles p where p.id = auth.uid()
    and p.role = 'broking_company' and profiles.broking_company_id = auth.uid())
);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

create policy "customer_strategies_read" on customer_strategies for select using (
  customer_id = auth.uid() or is_superadmin()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'account_manager'
    and exists (select 1 from profiles c where c.id = customer_strategies.customer_id
      and c.assigned_account_manager_id = auth.uid()))
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'broking_company'
    and exists (select 1 from profiles c where c.id = customer_strategies.customer_id
      and c.broking_company_id = auth.uid()))
);
create policy "customer_strategies_write" on customer_strategies for all using (
  customer_id = auth.uid() or is_superadmin()
);

create policy "orders_read" on orders for select using (
  customer_id = auth.uid() or is_superadmin()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'account_manager'
    and exists (select 1 from profiles c where c.id = orders.customer_id
      and c.assigned_account_manager_id = auth.uid()))
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'broking_company'
    and exists (select 1 from profiles c where c.id = orders.customer_id
      and c.broking_company_id = auth.uid()))
);
create policy "orders_insert" on orders for insert with check (
  customer_id = auth.uid() or is_superadmin()
);

create policy "positions_all" on customer_positions for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "state_all" on customer_state for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "broker_accounts_all" on broker_accounts for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "capital_all" on customer_capital_config for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "watchlists_all" on customer_watchlists for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "pivotal_all" on customer_pivotal_lists for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "trades_read" on trades for select using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "trades_insert" on trades for insert with check (
  customer_id = auth.uid() or is_superadmin()
);
create policy "signals_all" on signals_skipped for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "backtest_all" on backtest_runs for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "instances_read" on customer_instances for select using (
  customer_id = auth.uid() or is_superadmin() or is_account_manager()
);
create policy "instances_write" on customer_instances for all using (is_superadmin());

-- Platform data: all authenticated read, SA writes
create policy "platform_strategies_read" on platform_strategies for select using (auth.role() = 'authenticated');
create policy "platform_strategies_write" on platform_strategies for all using (is_superadmin());
create policy "platform_watchlists_read" on platform_watchlists for select using (auth.role() = 'authenticated');
create policy "platform_watchlists_write" on platform_watchlists for all using (is_superadmin());
create policy "daily_closes_read" on daily_closes for select using (auth.role() = 'authenticated');
create policy "daily_closes_write" on daily_closes for all using (is_superadmin());

-- SSO and audit
create policy "sso_insert" on sso_tokens for insert with check (is_superadmin());
create policy "sso_read" on sso_tokens for select using (true);
create policy "sso_update" on sso_tokens for update using (true);
create policy "audit_read" on audit_log for select using (is_superadmin());
create policy "audit_insert" on audit_log for insert with check (true);
create policy "email_log_insert" on email_log for insert with check (true);
create policy "email_log_read" on email_log for select using (is_superadmin());

-- KYC documents bucket (storage.objects) — Phase 3 registration/onboarding.
-- Explicit deny-by-default, service-role-only access. Redundant with
-- "private bucket + zero policies" (RLS already denies anon/authenticated
-- by default — see scripts/setup-storage.ts), but kept explicit and
-- auditable alongside the rest of this file's RLS policies. Must be run
-- manually in the Supabase SQL editor; supabase-js has no API to create
-- storage.objects policies.
create policy "kyc_documents_service_role_select" on storage.objects
  for select using (bucket_id = 'kyc-documents' and auth.role() = 'service_role');
create policy "kyc_documents_service_role_insert" on storage.objects
  for insert with check (bucket_id = 'kyc-documents' and auth.role() = 'service_role');
create policy "kyc_documents_service_role_update" on storage.objects
  for update using (bucket_id = 'kyc-documents' and auth.role() = 'service_role');
create policy "kyc_documents_service_role_delete" on storage.objects
  for delete using (bucket_id = 'kyc-documents' and auth.role() = 'service_role');
