-- Scope persisted daily candles to their source broker.
-- Existing rows are classified as Zerodha because that was the only writer.
alter table daily_closes
  add column if not exists broker_name text not null default 'zerodha';

alter table daily_closes
  drop constraint if exists daily_closes_pkey;

alter table daily_closes
  add constraint daily_closes_pkey primary key (broker_name, symbol, trade_date);

drop index if exists idx_daily_closes;
create index idx_daily_closes on daily_closes (broker_name, symbol, trade_date desc);