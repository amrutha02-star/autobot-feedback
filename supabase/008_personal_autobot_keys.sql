-- Update 8: a personal Autobot key for every team member, so each person's own Autobot can
-- log feedback through the drop-box function (no Supabase or Composio setup needed).
-- Paste into Supabase → SQL Editor → Run. Safe to re-run.

alter table public.team add column if not exists feedback_key text;
update public.team set feedback_key = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') where feedback_key is null;
alter table public.team alter column feedback_key set default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
create unique index if not exists team_feedback_key_idx on public.team (feedback_key);

-- Nobody can read other people's keys from the website: team members see only these columns.
revoke select on public.team from anon, authenticated;
grant select (email, name, role, is_admin) on public.team to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    revoke select on public.team from supabase_read_only_user;
    grant select (email, name, role, is_admin) on public.team to supabase_read_only_user;
  end if;
end $$;

-- Your own key (for Settings → Connect your Autobot)
create or replace function public.my_feedback_key() returns text
language sql stable security definer set search_path = public as $$
  select feedback_key from public.team where lower(email) = lower(auth.jwt() ->> 'email')
$$;
revoke execute on function public.my_feedback_key() from public, anon;
grant execute on function public.my_feedback_key() to authenticated;

-- Make a new key (yourself, or anyone if you're an admin). The old one stops working at once.
create or replace function public.reset_feedback_key(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not (public.is_admin() or lower(p_email) = lower(auth.jwt() ->> 'email')) then
    raise exception 'You can only reset your own key';
  end if;
  update public.team set feedback_key = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  where lower(email) = lower(p_email) returning feedback_key into k;
  return k;
end $$;
revoke execute on function public.reset_feedback_key(text) from public, anon;
grant execute on function public.reset_feedback_key(text) to authenticated;

select 'Update 8 done ✓' as status;
