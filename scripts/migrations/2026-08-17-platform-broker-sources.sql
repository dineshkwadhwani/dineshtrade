-- ================================================================
-- Platform Broker Sources table (AI recommendation source allowlist)
-- Run this in Supabase SQL Editor before running
-- scripts/migrate-broker-sources-to-supabase.ts.
-- Idempotent and safe to re-run.
-- ================================================================

create table if not exists platform_broker_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  notes text,
  active boolean not null default true,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

create unique index if not exists uq_platform_broker_sources_name
  on platform_broker_sources (name);

create unique index if not exists uq_platform_broker_sources_url
  on platform_broker_sources (url);

create index if not exists idx_platform_broker_sources_active_order
  on platform_broker_sources (active, display_order, name);
