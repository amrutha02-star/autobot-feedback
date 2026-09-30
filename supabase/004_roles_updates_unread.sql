-- Update 4: only the fixer moves stages · reporters add updates · "new for you" tracking · locked history.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run.

-- ── New event type: "update" (extra info/screenshots added after reporting) ──
alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in ('comment','fix','retest','status','update'));
alter table public.events  add column if not exists author_email text;
alter table public.reports add column if not exists reporter_email text;

-- Fill in emails for things created before this update
update public.reports r set reporter_email = t.email from public.team t where r.reporter_email is null and r.reported_by = t.name;
update public.events  e set author_email   = t.email from public.team t where e.author_email   is null and e.author      = t.name;

create or replace function public.is_fixer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team where lower(email) = lower(auth.jwt() ->> 'email') and role = 'fixer')
$$;

-- ── New reports: stamp who filed it (can't be faked) and always start as Open ──
create or replace function public.stamp_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare me public.team;
begin
  select * into me from public.team where lower(email) = lower(auth.jwt() ->> 'email');
  if me.email is not null then
    new.reporter_email := me.email;
    new.reported_by    := me.name;
    new.source         := 'web';
  end if;
  new.status := 'open';
  new.verified_at := null;
  return new;
end $$;
drop trigger if exists reports_stamp on public.reports;
create trigger reports_stamp before insert on public.reports for each row execute function public.stamp_report();

-- ── Timeline events: stamp author, enforce who may move stages, update status ──
create or replace function public.apply_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cur text;
  me  public.team;
begin
  select status into cur from public.reports where id = new.report_id;
  if cur is null then raise exception 'Report not found'; end if;

  select * into me from public.team where lower(email) = lower(auth.jwt() ->> 'email');
  if me.email is not null then          -- a person on the website (Autobot has no sign-in and skips this)
    new.author       := me.name;
    new.author_email := me.email;
    if new.kind in ('fix', 'status') and me.role <> 'fixer' then
      raise exception 'Only the fixer can move a report to another stage';
    end if;
    if new.kind = 'retest' and cur <> 'fixed' then
      raise exception 'A retest can only be recorded after the fixer marks the report as fixed';
    end if;
  end if;

  new.from_status := cur;
  if new.kind = 'fix' then
    new.to_status := 'fixed';
  elsif new.kind = 'retest' then
    new.to_status := case new.verdict when 'pass' then 'verified' else 'reopened' end;
  elsif new.kind = 'status' then
    if new.to_status is null then raise exception 'status event needs to_status'; end if;
  else
    new.from_status := null;
    new.to_status   := null;
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

-- ── Access rules: history can be added to, never edited or deleted ──
drop policy if exists reports_all    on public.reports;
drop policy if exists reports_read   on public.reports;
drop policy if exists reports_add    on public.reports;
drop policy if exists reports_edit   on public.reports;
drop policy if exists reports_remove on public.reports;
create policy reports_read   on public.reports for select using (public.is_team());
create policy reports_add    on public.reports for insert with check (public.is_team());
create policy reports_edit   on public.reports for update using (public.is_fixer()) with check (public.is_fixer());
create policy reports_remove on public.reports for delete using (public.is_fixer());

drop policy if exists events_all  on public.events;
drop policy if exists events_read on public.events;
drop policy if exists events_add  on public.events;
create policy events_read on public.events for select using (public.is_team());
create policy events_add  on public.events for insert with check (public.is_team());

drop policy if exists attach_all  on public.attachments;
drop policy if exists attach_read on public.attachments;
drop policy if exists attach_add  on public.attachments;
create policy attach_read on public.attachments for select using (public.is_team());
create policy attach_add  on public.attachments for insert with check (public.is_team());

drop policy if exists screenshots_team   on storage.objects;
drop policy if exists screenshots_read   on storage.objects;
drop policy if exists screenshots_upload on storage.objects;
create policy screenshots_read   on storage.objects for select using (bucket_id = 'screenshots' and public.is_team());
create policy screenshots_upload on storage.objects for insert with check (bucket_id = 'screenshots' and public.is_team());

-- ── "New for you": when each person last opened each report ──
create table if not exists public.report_views (
  email     text not null,
  report_id uuid not null references public.reports(id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (email, report_id)
);
alter table public.report_views enable row level security;
drop policy if exists views_own on public.report_views;
create policy views_own on public.report_views for all
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email') and public.is_team());

select email, name, role, is_admin from public.team order by is_admin desc, name;
