-- 20261001_rota_s1_planned_shifts.sql
-- Rota S1 — planned shifts + weekly labour budget (Boris's rulings 2026-10-01).
--
-- Ruling 1 "budget both ways": a week is planned against a budget (EUR or % of
-- forecast revenue). rota_weeks carries the budget; rota_shifts carries the plan;
-- fn_rota_week_cost sums the plan live.
--
-- What already existed and is REUSED, not duplicated:
--   labor_shifts        the clock reality (clock_in / clock_out, keyed by auth user)
--   labor_hourly_rates  pay rates (keyed by auth user) — extended here with person_id
--                       so a teammate without a login can still carry a rate
--   events              the unified calendar overlay — events_src_shift is redefined
--                       to show PUBLISHED planned shifts plus unplanned clock-ins
--   team_members        the person (person_id everywhere in the rota)
--
-- Staff data is the smallest circle (Foundation §5): RLS = members of the entity
-- read, managers write; a person always sees their own rows. Nothing here writes
-- to observations.

-- 0) settings per entity ------------------------------------------------------
create table if not exists public.rota_settings (
  entity_id          uuid primary key references public.entities(id) on delete cascade,
  overtime_rate      numeric not null default 1.25,   -- x hourly cost for APPROVED overtime
  tolerance_minutes  int     not null default 10,     -- clock drift inside this is not an exception
  default_budget_pct numeric,                         -- labour % of forecast revenue, new weeks inherit it
  -- minimum staffing per cover band, used by the proposal (S3)
  staffing_bands     jsonb   not null default '[{"max_covers":0,"foh":0,"boh":0},{"max_covers":30,"foh":1,"boh":1},{"max_covers":60,"foh":2,"boh":2},{"max_covers":999,"foh":3,"boh":3}]'::jsonb,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id)
);
alter table public.rota_settings enable row level security;
drop policy if exists rota_settings_select on public.rota_settings;
create policy rota_settings_select on public.rota_settings for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));
drop policy if exists rota_settings_write on public.rota_settings;
create policy rota_settings_write on public.rota_settings for all to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id))
  with check (public.fn_is_entity_manager(auth.uid(), entity_id));

create or replace function public.fn_rota_settings(p_entity uuid)
returns public.rota_settings language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select s from public.rota_settings s where s.entity_id = p_entity),
    row(p_entity, 1.25, 10, null,
        '[{"max_covers":0,"foh":0,"boh":0},{"max_covers":30,"foh":1,"boh":1},{"max_covers":60,"foh":2,"boh":2},{"max_covers":999,"foh":3,"boh":3}]'::jsonb,
        now(), null)::public.rota_settings);
$$;

-- 1) pay rates: extend labor_hourly_rates with person_id --------------------
alter table public.labor_hourly_rates add column if not exists person_id uuid references public.team_members(id) on delete cascade;
alter table public.labor_hourly_rates alter column user_id drop not null;
create index if not exists labor_hourly_rates_person on public.labor_hourly_rates(entity_id, person_id, effective_from desc);
update public.labor_hourly_rates r set person_id = tm.id
  from public.team_members tm where tm.auth_user_id = r.user_id and r.person_id is null;

create or replace function public.fn_person_rate(p_entity uuid, p_person uuid, p_date date)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select r.hourly_rate_eur
    from public.labor_hourly_rates r
    left join public.team_members tm on tm.id = p_person
   where r.entity_id = p_entity
     and (r.person_id = p_person or (r.user_id is not null and r.user_id = tm.auth_user_id))
     and r.effective_from <= p_date
     and (r.effective_to is null or r.effective_to >= p_date)
   order by (r.person_id = p_person) desc, r.effective_from desc
   limit 1;
$$;

-- 2) rota_weeks -------------------------------------------------------------
create table if not exists public.rota_weeks (
  id               uuid primary key default gen_random_uuid(),
  entity_id        uuid not null references public.entities(id) on delete cascade,
  week_start       date not null,
  budget_eur       numeric,
  budget_pct       numeric,
  forecast_revenue numeric,
  status           text not null default 'draft' check (status in ('draft','published')),
  published_at     timestamptz,
  published_by     uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (entity_id, week_start)
);
alter table public.rota_weeks enable row level security;
drop policy if exists rota_weeks_select on public.rota_weeks;
create policy rota_weeks_select on public.rota_weeks for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));
drop policy if exists rota_weeks_write on public.rota_weeks;
create policy rota_weeks_write on public.rota_weeks for all to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id))
  with check (public.fn_is_entity_manager(auth.uid(), entity_id));

-- 3) rota_shifts ------------------------------------------------------------
create table if not exists public.rota_shifts (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references public.entities(id) on delete cascade,
  person_id       uuid not null references public.team_members(id) on delete cascade,
  service_date    date not null,
  start_time      time not null,
  end_time        time not null,                  -- end <= start means "ends next day"
  role            text,
  station         text,
  area            text not null default 'foh' check (area in ('foh','boh','other')),
  planned_minutes int  not null default 0,
  hourly_cost     numeric,                        -- snapshot of fn_person_rate; null = no rate set
  status          text not null default 'planned' check (status in ('planned','published','cancelled')),
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists rota_shifts_entity_date on public.rota_shifts(entity_id, service_date);
create index if not exists rota_shifts_person_date on public.rota_shifts(person_id, service_date);
alter table public.rota_shifts enable row level security;
drop policy if exists rota_shifts_select on public.rota_shifts;
create policy rota_shifts_select on public.rota_shifts for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id) or person_id in (select public.app_my_person_ids()));
drop policy if exists rota_shifts_write on public.rota_shifts;
create policy rota_shifts_write on public.rota_shifts for all to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id))
  with check (public.fn_is_entity_manager(auth.uid(), entity_id));

create or replace function public.fn_rota_shift_before_write()
returns trigger language plpgsql as $$
declare mins int;
begin
  mins := (extract(epoch from (new.end_time - new.start_time)) / 60)::int;
  if mins <= 0 then mins := mins + 1440; end if;
  new.planned_minutes := mins;
  if tg_op = 'INSERT' then
    new.hourly_cost := public.fn_person_rate(new.entity_id, new.person_id, new.service_date);
  elsif new.hourly_cost is null or new.person_id <> old.person_id or new.service_date <> old.service_date then
    new.hourly_cost := public.fn_person_rate(new.entity_id, new.person_id, new.service_date);
  end if;
  if tg_op = 'INSERT' and new.role is not null and new.area = 'foh'
     and lower(new.role) ~ '(cook|chef|cocin|kitchen|boh|line|plonge|kp|pastry|pastel|pizz)' then
    new.area := 'boh';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists rota_shifts_before_write on public.rota_shifts;
create trigger rota_shifts_before_write before insert or update on public.rota_shifts
  for each row execute function public.fn_rota_shift_before_write();

-- 4) link the clock reality to the plan -------------------------------------
alter table public.labor_shifts add column if not exists rota_shift_id uuid references public.rota_shifts(id) on delete set null;
create index if not exists labor_shifts_rota on public.labor_shifts(rota_shift_id);

-- 5) the unified calendar: published plan + unplanned clock-ins --------------
create or replace view public.events_src_shift as
  select rs.entity_id,
         'shift'::text as source_type,
         rs.id as source_id,
         coalesce(tm.name, 'Shift') || coalesce(' · ' || nullif(rs.station, ''), ' · ' || nullif(rs.role, ''), '') as title,
         rs.notes as description,
         ((rs.service_date::text || ' ' || rs.start_time::text)::timestamp at time zone coalesce(e.timezone, 'Europe/Madrid')) as start_ts,
         ((rs.service_date::text || ' ' || rs.start_time::text)::timestamp at time zone coalesce(e.timezone, 'Europe/Madrid')) + make_interval(mins => rs.planned_minutes) as end_ts,
         false as all_day,
         coalesce(e.timezone, 'Europe/Madrid') as timezone,
         coalesce(e.accent_color, '#2B3A45') as colour,
         null::text as location,
         array[rs.person_id] as person_ids,
         case when ls.clock_out is not null then 'done' when ls.clock_in is not null then 'on' else 'planned' end as status,
         jsonb_build_object('planned', true, 'role', rs.role, 'station', rs.station, 'area', rs.area,
                            'clock_in', ls.clock_in, 'clock_out', ls.clock_out, 'rota_shift_id', rs.id) as meta
    from public.rota_shifts rs
    join public.entities e on e.id = rs.entity_id
    left join public.team_members tm on tm.id = rs.person_id
    left join lateral (select l.clock_in, l.clock_out from public.labor_shifts l where l.rota_shift_id = rs.id order by l.clock_in limit 1) ls on true
   where rs.status = 'published'
  union all
  select ls.entity_id, 'shift', ls.id,
         coalesce(tm.name, 'Shift') || coalesce(' · ' || nullif(ls.station, ''), ' · ' || nullif(ls.role, ''), '') || ' (unplanned)',
         ls.notes,
         coalesce(ls.scheduled_start, ls.clock_in),
         case when coalesce(ls.scheduled_end, ls.clock_out) >= coalesce(ls.scheduled_start, ls.clock_in) then coalesce(ls.scheduled_end, ls.clock_out) end,
         false, coalesce(e.timezone, 'Europe/Madrid'), coalesce(e.accent_color, '#2B3A45'), null,
         coalesce(array(select t.id from public.team_members t where t.auth_user_id = ls.user_id), '{}'::uuid[]),
         case when ls.clock_out is not null then 'done' when ls.clock_in is not null then 'on' else 'planned' end,
         jsonb_build_object('planned', false, 'clock_in', ls.clock_in, 'clock_out', ls.clock_out, 'role', ls.role, 'station', ls.station)
    from public.labor_shifts ls
    join public.entities e on e.id = ls.entity_id
    left join lateral (select t.name from public.team_members t where t.auth_user_id = ls.user_id limit 1) tm on true
   where ls.rota_shift_id is null and coalesce(ls.scheduled_start, ls.clock_in) is not null;

drop trigger if exists events_sync on public.rota_shifts;
create trigger events_sync after insert or update or delete on public.rota_shifts
  for each row execute function public.events_sync_trg('shift');

-- 6) week cost, live ---------------------------------------------------------
create or replace function public.fn_rota_week_cost(p_entity uuid, p_week_start date)
returns table (planned_minutes bigint, planned_eur numeric, shifts int, unpriced int, foh_minutes bigint, boh_minutes bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(planned_minutes),0)::bigint,
         round(coalesce(sum(planned_minutes * coalesce(hourly_cost,0) / 60.0),0), 2),
         count(*)::int,
         count(*) filter (where hourly_cost is null)::int,
         coalesce(sum(planned_minutes) filter (where area='foh'),0)::bigint,
         coalesce(sum(planned_minutes) filter (where area='boh'),0)::bigint
    from public.rota_shifts
   where entity_id = p_entity and service_date >= p_week_start and service_date < p_week_start + 7
     and status <> 'cancelled'
     and public.fn_is_entity_member(auth.uid(), p_entity);
$$;

-- 7) copy last week (the default action) ------------------------------------
create or replace function public.fn_rota_copy_week(p_entity uuid, p_from_week date, p_to_week date)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not public.fn_is_entity_manager(auth.uid(), p_entity) then raise exception 'manager required'; end if;
  insert into public.rota_shifts (entity_id, person_id, service_date, start_time, end_time, role, station, area, status, notes, created_by)
  select s.entity_id, s.person_id, s.service_date + (p_to_week - p_from_week), s.start_time, s.end_time, s.role, s.station, s.area, 'planned', null, auth.uid()
    from public.rota_shifts s
    join public.team_members tm on tm.id = s.person_id and coalesce(tm.status,'') <> 'archived'
   where s.entity_id = p_entity and s.service_date >= p_from_week and s.service_date < p_from_week + 7 and s.status <> 'cancelled'
     and not exists (select 1 from public.rota_shifts x where x.entity_id = s.entity_id and x.person_id = s.person_id
                      and x.service_date = s.service_date + (p_to_week - p_from_week) and x.start_time = s.start_time and x.status <> 'cancelled');
  get diagnostics n = row_count;
  insert into public.rota_weeks (entity_id, week_start, budget_eur, budget_pct)
  select p_entity, p_to_week, w.budget_eur, w.budget_pct from public.rota_weeks w where w.entity_id = p_entity and w.week_start = p_from_week
  on conflict (entity_id, week_start) do nothing;
  return n;
end $$;

-- 8) publish = the tick ------------------------------------------------------
create or replace function public.fn_rota_publish_week(p_entity uuid, p_week_start date)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not public.fn_is_entity_manager(auth.uid(), p_entity) then raise exception 'manager required'; end if;
  update public.rota_shifts set status = 'published'
   where entity_id = p_entity and service_date >= p_week_start and service_date < p_week_start + 7 and status = 'planned';
  get diagnostics n = row_count;
  insert into public.rota_weeks (entity_id, week_start, status, published_at, published_by)
  values (p_entity, p_week_start, 'published', now(), auth.uid())
  on conflict (entity_id, week_start) do update set status = 'published', published_at = now(), published_by = auth.uid(), updated_at = now();
  return n;
end $$;

grant execute on function public.fn_rota_settings(uuid), public.fn_person_rate(uuid,uuid,date), public.fn_rota_week_cost(uuid,date),
  public.fn_rota_copy_week(uuid,date,date), public.fn_rota_publish_week(uuid,date) to authenticated;
