-- ================================================================
-- Phase 5 schema extensions — run this in the Supabase SQL Editor
-- against the live DB before/alongside deploying the Phase 5 code.
-- Idempotent — safe to re-run.
--
-- Context: Phase 5 (Multi-Tenant Cron) needs customer_instances to be
-- writable from a bare cron process (lib/instanceStatus.ts's
-- updateInstanceStatus()) before the manual EC2-provisioning runbook
-- (spec §5.7) has necessarily recorded subdomain/instance_url — those
-- columns were NOT NULL in the original v2 schema. Also adds
-- last_reset_at for Task 5.10 (multi-tenant account reset).
-- ================================================================

alter table customer_instances alter column subdomain drop not null;
alter table customer_instances alter column instance_url drop not null;
alter table customer_instances add column if not exists last_reset_at timestamptz;
