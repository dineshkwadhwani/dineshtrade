-- platform_daily_briefing — one row per IST calendar day.
-- Stores the AI-fetched market briefing (global indices, GIFT Nifty, outlook, tips).
-- Written once per day by the first dashboard load after 08:30 AM IST.
-- If AI fails or returns mock data, no row is written (section silently omitted).

create table if not exists platform_daily_briefing (
  date_ist   text        primary key,           -- 'YYYY-MM-DD' IST
  data       jsonb       not null,              -- BriefingData JSON
  source     text        not null default 'ai', -- 'ai'
  created_at timestamptz default now()
);

alter table platform_daily_briefing enable row level security;

-- Any authenticated user can read (dashboard display).
create policy "Authenticated users can read daily briefing"
  on platform_daily_briefing for select
  using (auth.role() = 'authenticated');

-- Only the service role (server-side) can write.
-- (No insert/update policy needed — service key bypasses RLS.)
