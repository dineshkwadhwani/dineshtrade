-- Add subdomain and instance_ip to profiles.
-- subdomain: AM assigns at approval time; drives SSO cross-domain redirect.
-- instance_ip: set by IT after EC2 provisioning (informational only).
alter table profiles
  add column if not exists subdomain text unique,
  add column if not exists instance_ip text;
