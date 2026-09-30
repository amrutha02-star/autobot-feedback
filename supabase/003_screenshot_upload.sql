-- Update 3: secret key for Autobot's screenshot drop-box.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run (keeps the existing key).

create table if not exists public.app_secrets (
  name  text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;

-- Only admins can read it (the Settings page shows it inside Autobot's instruction).
drop policy if exists secrets_admin_read on public.app_secrets;
create policy secrets_admin_read on public.app_secrets for select using (public.is_admin());

insert into public.app_secrets (name, value)
values ('upload_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

select name, 'created ✓' as status from public.app_secrets;
