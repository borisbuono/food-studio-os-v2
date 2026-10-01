-- 20261001_rota_s2_settlements.sql
-- Rota S2 — clock → agreed time → overtime (Boris's rulings 2 and 3, 2026-10-01).
--
-- Ruling 2 "free clock, paid as agreed": the kiosk writes labor_shifts whenever
-- it likes. Pay is the PLANNED shift (rota_shifts.planned_minutes). Clocking in
-- 40 minutes early earns nothing by itself.
-- Ruling 3 "overtime is an explicit module": every minute outside the agreed
-- shift (beyond the tolerance) is written to shift_settlements as a pending
-- exception. A manager approves / rejects / adjusts each one. Approved overtime
-- is paid at rota_settings.overtime_rate; approved undertime is deducted.
-- Nothing is paid without a tick; nothing is lost silently either.
--
-- shift_settlements is the source for a later payroll adapter. No export or
-- payroll push exists in this build.

create table if not exists public.shift_settlements (
  id                        uuid primary key default gen_random_uuid(),
  entity_id                 uuid not null references public.entities(id) on delete cascade,
  rota_shift_id             uuid references public.rota_shifts(id) on delete cascade,
  labor_shift_id            uuid references public.labor_shifts(id) on delete set null,
  person_id                 uuid references public.team_members(id) on delete cascade,
  service_date              date not null,
  kind                      text not null default 'planned' check (kind in ('planned','unplanned','no_show')),
  planned_minutes           int  not null default 0,
  worked_minutes            int  not null default 0,
  clock_in                  timestamptz,
  clock_out                 timestamptz,
  hourly_cost               numeric,
  overtime_rate             numeric not null default 1.25,
  tolerance_minutes         int not null default 10,
  early_minutes             int not null default 0,   -- clocked in before the plan
  late_end_minutes          int not null default 0,   -- clocked out after the plan
  late_start_minutes        int not null default 0,   -- clocked in after the plan
  early_end_minutes         int not null default 0,   -- clocked out before the plan
  overtime_minutes          int not null default 0,   -- exception shown to the manager
  undertime_minutes         int not null default 0,
  overtime_status           text not null default 'none' check (overtime_status in ('none','pending','approved','rejected')),
  overtime_approved_minutes int not null default 0,
  undertime_status          text not null default 'none' check (undertime_status in ('none','pending','approved','rejected')),
  undertime_approved_minutes int not null default 0,
  paid_minutes              int not null default 0,   -- planned + approved overtime − approved undertime
  paid_eur                  numeric,
  overtime_eur              numeric not null default 0,
  decided_by                uuid references auth.users(id),
  decided_at                timestamptz,
  note                      text,
  settled_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists shift_settlements_rota on public.shift_settlements(rota_shift_id) where rota_shift_id is not null;
create unique index if not exists shift_settlements_unplanned on public.shift_settlements(labor_shift_id) where rota_shift_id is null and labor_shift_id is not null;
create index if not exists shift_settlements_entity_date on public.shift_settlements(entity_id, service_date desc);
create index if not exists shift_settlements_queue on public.shift_settlements(entity_id) where overtime_status = 'pending' or undertime_status = 'pending';
alter table public.shift_settlements enable row level security;
drop policy if exists shift_settlements_select on public.shift_settlements;
create policy shift_settlements_select on public.shift_settlements for select to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id) or person_id in (select public.app_my_person_ids()));
-- writes only through the definer RPCs below (no direct insert/update policy)

-- paid = agreed + approved overtime − approved undertime --------------------
create or replace function public.fn_settlement_recompute(s public.shift_settlements)
returns public.shift_settlements language plpgsql as $$
begin
  s.paid_minutes := greatest(0, s.planned_minutes
                    + case when s.overtime_status = 'approved' then s.overtime_approved_minutes else 0 end
                    - case when s.undertime_status = 'approved' then s.undertime_approved_minutes else 0 end);
  s.overtime_eur := round(case when s.overtime_status = 'approved' then s.overtime_approved_minutes / 60.0 * coalesce(s.hourly_cost, 0) * s.overtime_rate else 0 end, 2);
  s.paid_eur := case when s.hourly_cost is null then null
                else round((s.paid_minutes - case when s.overtime_status = 'approved' then s.overtime_approved_minutes else 0 end) / 60.0 * s.hourly_cost, 2) + s.overtime_eur end;
  s.updated_at := now();
  return s;
end $$;

-- match a clock row to the published plan -----------------------------------
-- Same entity, same person (via team_members.auth_user_id), published, planned
-- start within ±4 h of the clock-in; nearest wins; a plan already matched to
-- another clock row is skipped.
create or replace function public.fn_match_clock_to_plan(p_labor_shift uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.labor_shifts; tz text; best uuid;
begin
  select * into l from public.labor_shifts where id = p_labor_shift;
  if l.id is null or l.clock_in is null then return null; end if;
  if l.rota_shift_id is not null then return l.rota_shift_id; end if;
  select coalesce(e.timezone, 'Europe/Madrid') into tz from public.entities e where e.id = l.entity_id;
  select rs.id into best
    from public.rota_shifts rs
    join public.team_members tm on tm.id = rs.person_id
   where rs.entity_id = l.entity_id and rs.status = 'published'
     and tm.auth_user_id = l.user_id
     and rs.service_date between (l.clock_in at time zone tz)::date - 1 and (l.clock_in at time zone tz)::date + 1
     and abs(extract(epoch from (l.clock_in - ((rs.service_date::text || ' ' || rs.start_time::text)::timestamp at time zone tz)))) <= 4 * 3600
     and not exists (select 1 from public.labor_shifts x where x.rota_shift_id = rs.id and x.id <> l.id)
   order by abs(extract(epoch from (l.clock_in - ((rs.service_date::text || ' ' || rs.start_time::text)::timestamp at time zone tz))))
   limit 1;
  if best is not null then update public.labor_shifts set rota_shift_id = best where id = l.id; end if;
  return best;
end $$;

-- settle ONE planned shift against its clock rows ---------------------------
create or replace function public.fn_settle_shift(p_rota_shift uuid)
returns public.shift_settlements language plpgsql security definer set search_path = public, pg_temp as $$
declare rs public.rota_shifts; st public.rota_settings; tz text;
        plan_start timestamptz; plan_end timestamptz; w_start timestamptz; w_end timestamptz; worked int; open_rows int;
        early int := 0; late_end int := 0; late_start int := 0; early_end int := 0; ot int := 0; ut int := 0;
        s public.shift_settlements; lsid uuid;
begin
  select * into rs from public.rota_shifts where id = p_rota_shift;
  if rs.id is null or rs.status <> 'published' then return null; end if;
  -- an already decided settlement is never recomputed
  select * into s from public.shift_settlements where rota_shift_id = rs.id;
  if s.id is not null and (s.decided_at is not null) then return s; end if;

  st := public.fn_rota_settings(rs.entity_id);
  select coalesce(e.timezone, 'Europe/Madrid') into tz from public.entities e where e.id = rs.entity_id;
  plan_start := (rs.service_date::text || ' ' || rs.start_time::text)::timestamp at time zone tz;
  plan_end   := plan_start + make_interval(mins => rs.planned_minutes);

  select min(clock_in), max(clock_out),
         coalesce(sum(greatest(0, extract(epoch from (clock_out - clock_in)) / 60 - coalesce(break_minutes, 0))), 0)::int,
         count(*) filter (where clock_out is null), (array_agg(id order by clock_in))[1]
    into w_start, w_end, worked, open_rows, lsid
    from public.labor_shifts where rota_shift_id = rs.id and clock_in is not null;
  if open_rows > 0 then return s; end if;                    -- still on the floor: settle later
  if w_start is null and now() < plan_end + interval '2 hours' then return s; end if;  -- not yet: shift not over

  if s.id is null then
    s.id := gen_random_uuid(); s.settled_at := now();
  end if;
  s.entity_id := rs.entity_id; s.rota_shift_id := rs.id; s.labor_shift_id := lsid; s.person_id := rs.person_id;
  s.service_date := rs.service_date; s.planned_minutes := rs.planned_minutes; s.hourly_cost := rs.hourly_cost;
  s.overtime_rate := st.overtime_rate; s.tolerance_minutes := st.tolerance_minutes;
  s.clock_in := w_start; s.clock_out := w_end; s.worked_minutes := coalesce(worked, 0);

  if w_start is null then
    s.kind := 'no_show'; ut := rs.planned_minutes; early_end := rs.planned_minutes;
  else
    s.kind := 'planned';
    early      := greatest(0, (extract(epoch from (plan_start - w_start)) / 60)::int);
    late_end   := greatest(0, (extract(epoch from (w_end - plan_end)) / 60)::int);
    late_start := greatest(0, (extract(epoch from (w_start - plan_start)) / 60)::int);
    early_end  := greatest(0, (extract(epoch from (plan_end - w_end)) / 60)::int);
    ot := (case when early    > st.tolerance_minutes then early    else 0 end)
        + (case when late_end > st.tolerance_minutes then late_end else 0 end);
    ut := (case when late_start > st.tolerance_minutes then late_start else 0 end)
        + (case when early_end  > st.tolerance_minutes then early_end  else 0 end);
  end if;
  s.early_minutes := early; s.late_end_minutes := late_end; s.late_start_minutes := late_start; s.early_end_minutes := early_end;
  s.overtime_minutes := ot; s.undertime_minutes := ut;
  s.overtime_status  := case when ot > 0 then 'pending' else 'none' end; s.overtime_approved_minutes := 0;
  s.undertime_status := case when ut > 0 then 'pending' else 'none' end; s.undertime_approved_minutes := 0;
  s := public.fn_settlement_recompute(s);

  insert into public.shift_settlements select s.*
  on conflict (rota_shift_id) where rota_shift_id is not null do update set
    labor_shift_id = excluded.labor_shift_id, kind = excluded.kind, planned_minutes = excluded.planned_minutes,
    worked_minutes = excluded.worked_minutes, clock_in = excluded.clock_in, clock_out = excluded.clock_out,
    hourly_cost = excluded.hourly_cost, overtime_rate = excluded.overtime_rate, tolerance_minutes = excluded.tolerance_minutes,
    early_minutes = excluded.early_minutes, late_end_minutes = excluded.late_end_minutes, late_start_minutes = excluded.late_start_minutes,
    early_end_minutes = excluded.early_end_minutes, overtime_minutes = excluded.overtime_minutes, undertime_minutes = excluded.undertime_minutes,
    overtime_status = excluded.overtime_status, undertime_status = excluded.undertime_status,
    overtime_approved_minutes = 0, undertime_approved_minutes = 0,
    paid_minutes = excluded.paid_minutes, paid_eur = excluded.paid_eur, overtime_eur = excluded.overtime_eur, updated_at = now();
  select * into s from public.shift_settlements where rota_shift_id = rs.id;
  return s;
end $$;

-- settle an UNPLANNED clock pair (no published shift matched) ----------------
-- Nothing is agreed, so nothing is paid by default: the whole worked span is a
-- pending overtime exception the manager decides.
create or replace function public.fn_settle_unplanned(p_labor_shift uuid)
returns public.shift_settlements language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.labor_shifts; st public.rota_settings; tz text; s public.shift_settlements; pid uuid; worked int;
begin
  select * into l from public.labor_shifts where id = p_labor_shift;
  if l.id is null or l.clock_in is null or l.clock_out is null or l.rota_shift_id is not null then return null; end if;
  select * into s from public.shift_settlements where labor_shift_id = l.id and rota_shift_id is null;
  if s.id is not null and s.decided_at is not null then return s; end if;
  st := public.fn_rota_settings(l.entity_id);
  select coalesce(e.timezone, 'Europe/Madrid') into tz from public.entities e where e.id = l.entity_id;
  select tm.id into pid from public.team_members tm where tm.auth_user_id = l.user_id limit 1;
  worked := greatest(0, (extract(epoch from (l.clock_out - l.clock_in)) / 60 - coalesce(l.break_minutes, 0)))::int;
  if s.id is null then s.id := gen_random_uuid(); s.settled_at := now(); end if;
  s.entity_id := l.entity_id; s.rota_shift_id := null; s.labor_shift_id := l.id; s.person_id := pid;
  s.service_date := (l.clock_in at time zone tz)::date; s.kind := 'unplanned';
  s.planned_minutes := 0; s.worked_minutes := worked; s.clock_in := l.clock_in; s.clock_out := l.clock_out;
  s.hourly_cost := coalesce(l.hourly_rate_eur, case when pid is null then null else public.fn_person_rate(l.entity_id, pid, s.service_date) end);
  s.overtime_rate := 1.0;  -- unplanned hours are paid at the plain rate if approved; the manager can adjust
  s.tolerance_minutes := st.tolerance_minutes;
  s.early_minutes := 0; s.late_end_minutes := worked; s.late_start_minutes := 0; s.early_end_minutes := 0;
  s.overtime_minutes := worked; s.undertime_minutes := 0;
  s.overtime_status := case when worked > 0 then 'pending' else 'none' end; s.overtime_approved_minutes := 0;
  s.undertime_status := 'none'; s.undertime_approved_minutes := 0;
  s := public.fn_settlement_recompute(s);
  insert into public.shift_settlements select s.*
  on conflict (labor_shift_id) where rota_shift_id is null and labor_shift_id is not null do update set
    worked_minutes = excluded.worked_minutes, clock_in = excluded.clock_in, clock_out = excluded.clock_out, hourly_cost = excluded.hourly_cost,
    late_end_minutes = excluded.late_end_minutes, overtime_minutes = excluded.overtime_minutes, overtime_status = excluded.overtime_status,
    paid_minutes = excluded.paid_minutes, paid_eur = excluded.paid_eur, overtime_eur = excluded.overtime_eur, updated_at = now();
  select * into s from public.shift_settlements where labor_shift_id = l.id and rota_shift_id is null;
  return s;
end $$;

-- on clock-in: match; on clock-out: settle ----------------------------------
create or replace function public.fn_labor_shift_settle_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid;
begin
  begin
    rid := public.fn_match_clock_to_plan(new.id);
    if new.clock_out is not null then
      if rid is not null then perform public.fn_settle_shift(rid); else perform public.fn_settle_unplanned(new.id); end if;
    end if;
  exception when others then
    raise warning 'rota settle (%) failed: %', new.id, sqlerrm;   -- a settlement failure never blocks a clock-out
  end;
  return null;
end $$;
drop trigger if exists rota_settle on public.labor_shifts;
create trigger rota_settle after insert or update of clock_in, clock_out on public.labor_shifts
  for each row execute function public.fn_labor_shift_settle_trg();

-- nightly: yesterday's published shifts (incl. no-shows) + stray unplanned pairs
create or replace function public.fn_settle_day(p_entity uuid, p_date date)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; r record; tz text;
begin
  select coalesce(e.timezone, 'Europe/Madrid') into tz from public.entities e where e.id = p_entity;
  for r in select id from public.rota_shifts where entity_id = p_entity and service_date = p_date and status = 'published' loop
    perform public.fn_settle_shift(r.id); n := n + 1;
  end loop;
  for r in select id from public.labor_shifts l where l.entity_id = p_entity and l.clock_out is not null
            and (l.clock_in at time zone tz)::date = p_date loop
    perform public.fn_match_clock_to_plan(r.id);
    if (select rota_shift_id from public.labor_shifts where id = r.id) is null then perform public.fn_settle_unplanned(r.id); n := n + 1;
    else perform public.fn_settle_shift((select rota_shift_id from public.labor_shifts where id = r.id)); end if;
  end loop;
  return n;
end $$;

create or replace function public.fn_settle_all()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e record; total int := 0; out jsonb := '{}'::jsonb; d date; n int;
begin
  for e in select distinct rs.entity_id, coalesce(en.timezone, 'Europe/Madrid') tz from public.rota_shifts rs join public.entities en on en.id = rs.entity_id loop
    d := (now() at time zone e.tz)::date - 1;
    n := public.fn_settle_day(e.entity_id, d) + public.fn_settle_day(e.entity_id, d - 1);   -- yesterday + the day before (late clock-outs)
    total := total + n; out := out || jsonb_build_object(e.entity_id::text, n);
  end loop;
  begin
    insert into public.cron_runs (job, triggered_by, finished_at, ok, detail) values ('rota_settle', 'pg_cron', now(), true, out);
  exception when others then null; end;
  return out;
end $$;
do $$ begin
  perform cron.unschedule('rota_settle_nightly');
exception when others then null; end $$;
select cron.schedule('rota_settle_nightly', '20 4 * * *', $$select public.fn_settle_all()$$);

-- the tick: approve / reject / adjust one exception --------------------------
create or replace function public.fn_settlement_decide(p_id uuid, p_kind text, p_decision text, p_minutes int default null, p_note text default null)
returns public.shift_settlements language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.shift_settlements;
begin
  select * into s from public.shift_settlements where id = p_id;
  if s.id is null then raise exception 'settlement not found'; end if;
  if not public.fn_is_entity_manager(auth.uid(), s.entity_id) then raise exception 'manager required'; end if;
  if p_kind not in ('overtime','undertime') then raise exception 'kind must be overtime|undertime'; end if;
  if p_decision not in ('approve','reject','adjust') then raise exception 'decision must be approve|reject|adjust'; end if;
  if p_kind = 'overtime' then
    if s.overtime_minutes = 0 then raise exception 'no overtime on this shift'; end if;
    s.overtime_status := case when p_decision = 'reject' then 'rejected' else 'approved' end;
    s.overtime_approved_minutes := case when p_decision = 'reject' then 0 when p_decision = 'adjust' then greatest(0, least(coalesce(p_minutes, 0), s.overtime_minutes)) else s.overtime_minutes end;
  else
    if s.undertime_minutes = 0 then raise exception 'no undertime on this shift'; end if;
    -- approve = deduct the missing minutes; reject = pay the agreed shift in full
    s.undertime_status := case when p_decision = 'reject' then 'rejected' else 'approved' end;
    s.undertime_approved_minutes := case when p_decision = 'reject' then 0 when p_decision = 'adjust' then greatest(0, least(coalesce(p_minutes, 0), s.undertime_minutes)) else s.undertime_minutes end;
  end if;
  s.decided_by := auth.uid(); s.decided_at := now();
  if p_note is not null then s.note := left(p_note, 300); end if;
  s := public.fn_settlement_recompute(s);
  update public.shift_settlements set
    overtime_status = s.overtime_status, overtime_approved_minutes = s.overtime_approved_minutes,
    undertime_status = s.undertime_status, undertime_approved_minutes = s.undertime_approved_minutes,
    paid_minutes = s.paid_minutes, paid_eur = s.paid_eur, overtime_eur = s.overtime_eur,
    decided_by = s.decided_by, decided_at = s.decided_at, note = s.note, updated_at = now()
  where id = s.id;
  return s;
end $$;

-- week labour, settled + planned (for the margin strip and Chef) --------------
create or replace function public.fn_rota_week_labour(p_entity uuid, p_week_start date)
returns table (planned_eur numeric, settled_eur numeric, overtime_eur numeric, pending int, labour_eur numeric, revenue_eur numeric, labour_pct numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with p as (
    select coalesce(sum(planned_minutes * coalesce(hourly_cost,0) / 60.0), 0) planned
      from public.rota_shifts where entity_id = p_entity and service_date >= p_week_start and service_date < p_week_start + 7 and status <> 'cancelled'
       and not exists (select 1 from public.shift_settlements ss where ss.rota_shift_id = rota_shifts.id)
  ), s as (
    select coalesce(sum(paid_eur), 0) paid, coalesce(sum(overtime_eur), 0) ot,
           count(*) filter (where overtime_status = 'pending' or undertime_status = 'pending')::int pend
      from public.shift_settlements where entity_id = p_entity and service_date >= p_week_start and service_date < p_week_start + 7
  ), r as (
    select coalesce(sum(coalesce(ep.food_net_eur,0) + coalesce(ep.wine_net_eur,0) + coalesce(ep.bar_net_eur,0) + coalesce(ep.softdrinks_net_eur,0)), 0) rev
      from public.eod_pos ep join public.restaurants rr on rr.id = ep.restaurant_id
     where rr.entity_id = p_entity and ep.date >= p_week_start and ep.date < p_week_start + 7
  )
  select round(p.planned, 2), round(s.paid, 2), round(s.ot, 2), s.pend,
         round(p.planned + s.paid, 2),
         round(r.rev, 2),
         case when r.rev > 0 then round((p.planned + s.paid) / r.rev * 100, 1) end
    from p, s, r
   where public.fn_is_entity_member(auth.uid(), p_entity);
$$;

grant execute on function public.fn_settlement_decide(uuid,text,text,int,text), public.fn_rota_week_labour(uuid,date) to authenticated;
revoke execute on function public.fn_settle_shift(uuid), public.fn_settle_unplanned(uuid), public.fn_settle_day(uuid,date), public.fn_settle_all(), public.fn_match_clock_to_plan(uuid) from public, anon, authenticated;
