-- Update 2: team management from the website + "who asked" on Autobot reports.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run.

-- Admins can add/remove people from the Settings page.
alter table public.team add column if not exists is_admin boolean not null default false;
-- ⚠️ Use the same two emails as in schema.sql
update public.team set is_admin = true where email in ('reporter@yourcompany.com', 'fixer@yourcompany.com');

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team where lower(email) = lower(auth.jwt() ->> 'email') and is_admin)
$$;

drop policy if exists team_insert on public.team;
drop policy if exists team_update on public.team;
drop policy if exists team_delete on public.team;
create policy team_insert on public.team for insert with check (public.is_admin());
create policy team_update on public.team for update using (public.is_admin()) with check (public.is_admin());
-- Admins can remove others, never themselves (so the last admin can't lock everyone out).
create policy team_delete on public.team for delete
  using (public.is_admin() and lower(email) <> lower(auth.jwt() ->> 'email'));

-- Store emails in lowercase so sign-in matching is simple.
create or replace function public.team_lower_email() returns trigger language plpgsql as $$
begin new.email := lower(trim(new.email)); return new; end $$;
drop trigger if exists team_lower on public.team;
create trigger team_lower before insert or update on public.team
  for each row execute function public.team_lower_email();

-- Autobot reports now record who asked.
drop function if exists public.log_report(text,text,text,text,text,text,text,text);
create or replace function public.log_report(
  p_title            text,
  p_prompt           text,
  p_expected         text,
  p_actual           text default null,
  p_category         text default 'other',
  p_severity         text default 'medium',
  p_reporter         text default null,
  p_notes            text default null,
  p_conversation_url text default null
) returns text
language plpgsql as $$
declare
  r public.reports;
  cats text[] := array['memory','instructions','facts','tone','tools','reasoning','language','brand','speed','other'];
  sevs text[] := array['low','medium','high','critical'];
begin
  insert into public.reports
    (title, prompt, expected_behavior, actual_response, category, severity, notes, conversation_url, source, reported_by)
  values (
    p_title, p_prompt, p_expected, p_actual,
    case when lower(p_category) = any(cats) then lower(p_category) else 'other' end,
    case when lower(p_severity) = any(sevs) then lower(p_severity) else 'medium' end,
    p_notes, p_conversation_url, 'autobot', coalesce(nullif(trim(p_reporter), ''), 'Autobot')
  ) returning * into r;
  return 'Logged report #' || r.number || ': ' || r.title;
end $$;
revoke execute on function public.log_report(text,text,text,text,text,text,text,text,text) from public, anon, authenticated;

select email, name, role, is_admin from public.team;
