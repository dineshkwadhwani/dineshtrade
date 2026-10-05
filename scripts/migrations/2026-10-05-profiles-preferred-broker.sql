alter table profiles
  add column if not exists preferred_broker text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_preferred_broker_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table profiles
      add constraint profiles_preferred_broker_check
      check (preferred_broker is null or preferred_broker in ('zerodha', 'upstox'));
  end if;
end
$$;