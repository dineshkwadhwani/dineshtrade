-- ================================================================
-- Platform Holidays table (global market calendar)
-- Run this in Supabase SQL Editor before running
-- scripts/migrate-holidays-to-supabase.ts.
-- Idempotent and safe to re-run.
-- ================================================================

create table if not exists platform_holidays (
  id uuid primary key default gen_random_uuid(),
  market text not null default 'NSE',
  holiday_date date not null,
  name text not null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

create unique index if not exists uq_platform_holidays_market_date
  on platform_holidays (market, holiday_date);

create index if not exists idx_platform_holidays_market_active_date
  on platform_holidays (market, active, holiday_date);
