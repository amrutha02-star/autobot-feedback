-- Update 7: Autobot can read its instruction with Composio's read-only query action · new "App bug" type · live updates.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run.

-- Composio's "Execute read-only database query" runs as supabase_read_only_user.
-- Let that user read the instruction and take backups (still hidden from the public website).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    grant usage on schema public to supabase_read_only_user;
    grant execute on function public.logging_instruction() to supabase_read_only_user;
    grant execute on function public.export_all() to supabase_read_only_user;
    grant select on public.reports, public.events, public.attachments, public.team to supabase_read_only_user;
    grant select on public.open_reports, public.retest_queue to supabase_read_only_user;
  end if;
end $$;

-- Backups must see every row, whichever Composio action runs them (still not callable from the website).
alter function public.export_all() security definer;
alter function public.export_all() set search_path = public;

-- New type: problems with the Autobot app itself (loading, buttons, layout), not with the AI's answers.
alter table public.reports drop constraint if exists reports_category_check;
alter table public.reports add constraint reports_category_check check (category in
  ('memory','instructions','facts','tone','tools','reasoning','language','brand','speed','app','other'));

create or replace function public.log_report(
  p_title            text,
  p_prompt           text,
  p_expected         text default null,
  p_summary          text default null,
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
  cats text[] := array['memory','instructions','facts','tone','tools','reasoning','language','brand','speed','app','other'];
  sevs text[] := array['low','medium','high','critical'];
begin
  insert into public.reports
    (title, summary, prompt, expected_behavior, actual_response, category, severity, notes, conversation_url, source, reported_by)
  values (
    p_title, p_summary, p_prompt, p_expected, p_actual,
    case when lower(p_category) = any(cats) then lower(p_category) else 'other' end,
    case when lower(p_severity) = any(sevs) then lower(p_severity) else 'medium' end,
    p_notes, p_conversation_url, 'autobot', coalesce(nullif(trim(p_reporter), ''), 'Autobot')
  ) returning * into r;
  return 'Logged report #' || r.number || ': ' || r.title;
end $$;
revoke execute on function public.log_report(text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;

-- Live updates: the website hears about new reports, timeline entries and attachments instantly.
-- (Supabase Realtime still applies the same access rules, so people only receive what they could already see.)
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['reports', 'events', 'attachments'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

select 'Update 7 done ✓' as status;
