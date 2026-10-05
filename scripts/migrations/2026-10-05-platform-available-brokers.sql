insert into platform_config (key, value, description, value_type)
values (
  'AVAILABLE_BROKERS',
  '["zerodha","upstox"]',
  'Brokers customers may select when creating or changing a broker connection.',
  'json'
)
on conflict (key) do nothing;