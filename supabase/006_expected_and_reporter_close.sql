-- Update 6: reporters can close ("no fix needed") and reopen their own reports.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run.

-- New stage: closed (by the reporter, no fix needed)
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check check (status in
  ('open','acknowledged','fixed','verified','reopened','wont_fix','closed'));

create or replace function public.apply_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cur  text;
  rep  public.reports;
  me   public.team;
  mine boolean;
begin
  select * into rep from public.reports where id = new.report_id;
  if rep.id is null then raise exception 'Report not found'; end if;
  cur := rep.status;

  select * into me from public.team where lower(email) = lower(auth.jwt() ->> 'email');
  if me.email is not null then          -- a person on the website (Autobot has no sign-in and skips this)
    new.author       := me.name;
    new.author_email := me.email;
    mine := lower(coalesce(rep.reporter_email, '')) = lower(me.email)
            or (rep.reporter_email is null and rep.reported_by = me.name);

    if new.kind = 'fix' and me.role <> 'fixer' then
      raise exception 'Only the fixer can mark a report as fixed';
    end if;

    if new.kind = 'status' and me.role <> 'fixer' then
      -- Reporters may only close or reopen their own reports
      if not mine then
        raise exception 'You can only close or reopen reports you filed';
      elsif new.to_status = 'closed' then
        if cur = 'closed' then raise exception 'This report is already closed'; end if;
      elsif new.to_status = 'reopened' then
        if cur not in ('closed', 'verified', 'wont_fix') then
          raise exception 'Only closed, verified or won''t-fix reports can be reopened';
        end if;
      else
        raise exception 'Only the fixer can move a report to that stage';
      end if;
      if coalesce(trim(new.body), '') = '' then raise exception 'Please add a short reason'; end if;
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

-- Closed reports aren't "open"
create or replace view public.open_reports with (security_invoker = true) as
  select number, title, category, severity, status, created_at
  from public.reports where status in ('open','acknowledged','reopened')
  order by case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, created_at;

select 'Update 6 done ✓' as status;
