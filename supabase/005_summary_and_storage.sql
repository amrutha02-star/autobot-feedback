-- Update 5: "What went wrong" on every report · recordings as Google Drive links · storage meter.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run.

alter table public.reports     add column if not exists summary    text;
alter table public.attachments add column if not exists size_bytes bigint;

-- Pass criteria are no longer used; keep the column for older reports but don't require it.
alter table public.reports alter column expected_behavior drop not null;

-- Autobot's logging function: p_summary (what Autobot did wrong, third person) is the main field. p_expected is optional/legacy.
drop function if exists public.log_report(text,text,text,text,text,text,text,text,text);
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
  cats text[] := array['memory','instructions','facts','tone','tools','reasoning','language','brand','speed','other'];
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

-- Storage meter for the Settings page (admins only).
create or replace function public.storage_used() returns bigint
language sql stable security definer set search_path = public, storage as $$
  select case when public.is_admin()
    then coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id = 'screenshots'), 0)
    else null end
$$;
revoke execute on function public.storage_used() from public, anon;
grant execute on function public.storage_used() to authenticated;

-- Recordings live in Google Drive; attachments can be a Drive link instead of a stored file.
alter table public.attachments alter column path drop not null;
alter table public.attachments add column if not exists url  text;
alter table public.attachments add column if not exists kind text not null default 'image';
alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments add  constraint attachments_kind_check check (kind in ('image', 'video'));
alter table public.attachments drop constraint if exists attach_has_source;
alter table public.attachments add  constraint attach_has_source check (path is not null or url is not null);

-- Site settings admins can change from the Settings page (e.g. the Google sign-in ID). Everyone on the team can read them.
create table if not exists public.app_settings (name text primary key, value text not null);
alter table public.app_settings enable row level security;
drop policy if exists settings_read  on public.app_settings;
drop policy if exists settings_write on public.app_settings;
create policy settings_read  on public.app_settings for select using (public.is_team());
create policy settings_write on public.app_settings for all using (public.is_admin()) with check (public.is_admin());

-- For Autobot: attach a Drive recording link to a report.
create or replace function public.add_recording(p_number bigint, p_url text) returns text
language plpgsql as $$
declare rid uuid;
begin
  if p_url !~ '^https://(drive|docs)\.google\.com/' then return 'Not a Google Drive link: ' || p_url; end if;
  select id into rid from public.reports where number = p_number;
  if rid is null then return 'No report #' || p_number; end if;
  insert into public.attachments (report_id, event_id, url, kind) values (rid, null, p_url, 'video');
  update public.reports set updated_at = now() where id = rid;
  return 'Attached recording to report #' || p_number;
end $$;
revoke execute on function public.add_recording(bigint, text) from public, anon, authenticated;

-- For Autobot's scheduled backup: everything as one JSON document (no secrets, no screenshot files).
create or replace function public.export_all() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'generated_at', now(),
    'counts', jsonb_build_object(
      'reports',     (select count(*) from public.reports),
      'events',      (select count(*) from public.events),
      'attachments', (select count(*) from public.attachments),
      'team',        (select count(*) from public.team)
    ),
    'team',        coalesce((select jsonb_agg(jsonb_build_object('email', email, 'name', name, 'role', role, 'is_admin', is_admin)) from public.team), '[]'),
    'reports',     coalesce((select jsonb_agg(to_jsonb(r) order by r.number) from public.reports r), '[]'),
    'events',      coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.events e), '[]'),
    'attachments', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.attachments a), '[]')
  )
$$;
revoke execute on function public.export_all() from public, anon, authenticated;

select 'Update 5 done ✓' as status;
