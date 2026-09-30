-- Autobot Feedback — database schema
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to re-run.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Team: only these emails can sign in and see anything.
-- ⚠️ Change these two rows to your own team before running: one reporter, one fixer.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.team (
  email text primary key,
  name  text not null,
  role  text not null default 'reporter' check (role in ('reporter', 'fixer'))
);

insert into public.team (email, name, role) values
  ('reporter@yourcompany.com', 'Reporter', 'reporter'),
  ('fixer@yourcompany.com',    'Fixer',    'fixer')
on conflict (email) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Reports: one per problem. Each one doubles as a regression test:
-- the same prompt is re-run after a fix and compared to "expected".
-- ─────────────────────────────────────────────────────────────
create table if not exists public.reports (
  id                uuid primary key default gen_random_uuid(),
  number            bigint generated always as identity unique,
  title             text not null,
  category          text not null default 'other' check (category in
                      ('memory','instructions','facts','tone','tools','reasoning','language','brand','speed','other')),
  severity          text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status            text not null default 'open' check (status in
                      ('open','acknowledged','fixed','verified','reopened','wont_fix')),
  prompt            text not null,      -- what was asked / the conversation
  actual_response   text,               -- what Autobot did
  expected_behavior text not null,      -- what it should have done (the pass criteria)
  notes             text,
  conversation_url  text,
  source            text not null default 'web' check (source in ('web','autobot')),
  reported_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  verified_at       timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- Events: the timeline. comment | fix (CEO shipped something) |
-- retest (same prompt re-run, with verdict) | status (manual change)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.reports(id) on delete cascade,
  kind          text not null check (kind in ('comment','fix','retest','status')),
  body          text,
  response_text text,                   -- retest: Autobot's new reply
  verdict       text check (verdict in ('pass','partial','fail')),
  build         text,                   -- fix/retest: version, prompt rev, model, date…
  from_status   text,
  to_status     text,
  author        text,
  created_at    timestamptz not null default now(),
  constraint retest_needs_verdict check (kind <> 'retest' or verdict is not null)
);
create index if not exists events_report_idx on public.events(report_id, created_at);

create table if not exists public.attachments (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports(id) on delete cascade,
  event_id   uuid references public.events(id) on delete cascade,  -- null = original report
  path       text not null,                                         -- storage path in "screenshots"
  created_at timestamptz not null default now()
);
create index if not exists attachments_report_idx on public.attachments(report_id);

-- ─────────────────────────────────────────────────────────────
-- Status automation (works the same from the website and from Autobot)
--   fix            → fixed
--   retest pass    → verified
--   retest partial → reopened
--   retest fail    → reopened
-- ─────────────────────────────────────────────────────────────
create or replace function public.apply_event() returns trigger
language plpgsql as $$
declare cur text;
begin
  select status into cur from public.reports where id = new.report_id;
  new.from_status := cur;

  if new.kind = 'fix' then
    new.to_status := 'fixed';
  elsif new.kind = 'retest' then
    new.to_status := case new.verdict when 'pass' then 'verified' else 'reopened' end;
  elsif new.kind = 'status' then
    if new.to_status is null then raise exception 'status event needs to_status'; end if;
  else
    new.from_status := null;
    new.to_status := null;
  end if;

  update public.reports set
    updated_at  = now(),
    status      = coalesce(new.to_status, status),
    verified_at = case
                    when new.to_status = 'verified' then now()
                    when new.to_status is not null then null
                    else verified_at
                  end
  where id = new.report_id;

  return new;
end $$;

drop trigger if exists events_apply on public.events;
create trigger events_apply before insert on public.events
  for each row execute function public.apply_event();

-- ─────────────────────────────────────────────────────────────
-- Access control: signed-in team members only.
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team where lower(email) = lower(auth.jwt() ->> 'email'))
$$;

alter table public.team        enable row level security;
alter table public.reports     enable row level security;
alter table public.events      enable row level security;
alter table public.attachments enable row level security;

drop policy if exists team_read   on public.team;
drop policy if exists reports_all on public.reports;
drop policy if exists events_all  on public.events;
drop policy if exists attach_all  on public.attachments;

create policy team_read   on public.team        for select using (public.is_team());
create policy reports_all on public.reports     for all using (public.is_team()) with check (public.is_team());
create policy events_all  on public.events      for all using (public.is_team()) with check (public.is_team());
create policy attach_all  on public.attachments for all using (public.is_team()) with check (public.is_team());

-- Screenshots bucket (private; the site uses short-lived signed links)
insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

drop policy if exists screenshots_team on storage.objects;
create policy screenshots_team on storage.objects for all
  using (bucket_id = 'screenshots' and public.is_team())
  with check (bucket_id = 'screenshots' and public.is_team());

-- ─────────────────────────────────────────────────────────────
-- Autobot helpers (called through Composio → Supabase →
-- "Execute project database query"). Not callable from the browser.
-- ─────────────────────────────────────────────────────────────
create or replace function public.log_report(
  p_title            text,
  p_prompt           text,
  p_expected         text,
  p_actual           text default null,
  p_category         text default 'other',
  p_severity         text default 'medium',
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
    p_notes, p_conversation_url, 'autobot', 'Autobot'
  ) returning * into r;
  return 'Logged report #' || r.number || ': ' || r.title;
end $$;

create or replace function public.add_note(p_number bigint, p_body text) returns text
language plpgsql as $$
declare rid uuid;
begin
  select id into rid from public.reports where number = p_number;
  if rid is null then return 'No report #' || p_number; end if;
  insert into public.events (report_id, kind, body, author) values (rid, 'comment', p_body, 'Autobot');
  return 'Added note to #' || p_number;
end $$;

revoke execute on function public.log_report(text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.add_note(bigint, text) from public, anon, authenticated;

-- Handy read-only views for asking Autobot "what's open?" / "what needs retesting?"
create or replace view public.open_reports with (security_invoker = true) as
  select number, title, category, severity, status, created_at
  from public.reports where status in ('open','acknowledged','reopened')
  order by case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, created_at;

create or replace view public.retest_queue with (security_invoker = true) as
  select number, title, prompt, expected_behavior, updated_at
  from public.reports where status = 'fixed' order by updated_at;
