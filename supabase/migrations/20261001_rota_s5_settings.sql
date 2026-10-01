-- 20261001_rota_s5_settings.sql
-- Rota S5 — the settings screen (Team › Rota › Settings), 2026-10-01.
--
-- One page where Boris sets everything S1–S4 needs but had no home for:
-- pay rate per person (labor_hourly_rates with person_id), the weekly budget
-- (EUR or % of forecast revenue), overtime rate, tolerance, staffing bands
-- (min FOH/BOH per cover band) and the entity's special days (feeds the
-- forecast in S7). Every write goes through a manager-checked definer RPC.
-- Staff data stays in the smallest circle (Foundation §5): members read their
-- own rate, managers everything; nothing here touches observations.

-- 1) settings columns the screen edits -----------------------------------------
alter table public.rota_settings add column if not exists weekly_budget_eur numeric;           -- default weekly budget, new weeks inherit it
alter table public.rota_settings add column if not exists spend_per_cover numeric;             -- EUR net per cover, used to estimate covers from revenue when the till has no guest count
alter table public.rota_settings add column if not exists lunch_share numeric not null default 0.4;  -- share of the day's covers at lunch when hourly data is missing
alter table public.rota_settings add column if not exists holiday_uplift jsonb not null default '{"national":1.15,"regional":1.15,"local":1.3,"special":1.4}'::jsonb;

-- fn_rota_settings must return the full row incl. the new columns (row() in S1 had 7 fields)
create or replace function public.fn_rota_settings(p_entity uuid)
returns public.rota_settings language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.rota_settings;
begin
  select * into s from public.rota_settings where entity_id = p_entity;
  if s.entity_id is null then
    s.entity_id := p_entity; s.overtime_rate := 1.25; s.tolerance_minutes := 10; s.default_budget_pct := null;
    s.staffing_bands := '[{"max_covers":0,"foh":0,"boh":0},{"max_covers":30,"foh":1,"boh":1},{"max_covers":60,"foh":2,"boh":2},{"max_covers":999,"foh":3,"boh":3}]'::jsonb;
    s.updated_at := now(); s.weekly_budget_eur := null; s.spend_per_cover := null; s.lunch_share := 0.4;
    s.holiday_uplift := '{"national":1.15,"regional":1.15,"local":1.3,"special":1.4}'::jsonb;
  end if;
  return s;
end $$;

-- 2) save settings (manager tick) ---------------------------------------------
create or replace function public.fn_rota_settings_save(p_entity uuid, p_patch jsonb)
returns public.rota_settings language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.rota_settings; b jsonb; i int := 0;
begin
  if not public.fn_is_entity_manager(auth.uid(), p_entity) then raise exception 'manager required'; end if;
  s := public.fn_rota_settings(p_entity);
  if p_patch ? 'overtime_rate'      then s.overtime_rate := greatest(1, least(3, (p_patch->>'overtime_rate')::numeric)); end if;
  if p_patch ? 'tolerance_minutes'  then s.tolerance_minutes := greatest(0, least(120, (p_patch->>'tolerance_minutes')::int)); end if;
  if p_patch ? 'default_budget_pct' then s.default_budget_pct := nullif(p_patch->>'default_budget_pct', '')::numeric; end if;
  if p_patch ? 'weekly_budget_eur'  then s.weekly_budget_eur := nullif(p_patch->>'weekly_budget_eur', '')::numeric; end if;
  if p_patch ? 'spend_per_cover'    then s.spend_per_cover := nullif(p_patch->>'spend_per_cover', '')::numeric; end if;
  if p_patch ? 'lunch_share'        then s.lunch_share := greatest(0, least(1, coalesce(nullif(p_patch->>'lunch_share','')::numeric, 0.4))); end if;
  if p_patch ? 'holiday_uplift' and jsonb_typeof(p_patch->'holiday_uplift') = 'object' then s.holiday_uplift := s.holiday_uplift || (p_patch->'holiday_uplift'); end if;
  if p_patch ? 'staffing_bands' and jsonb_typeof(p_patch->'staffing_bands') = 'array' then
    -- validate: every band has max_covers, foh, boh as non-negative ints; sort by max_covers
    for b in select * from jsonb_array_elements(p_patch->'staffing_bands') loop
      if (b->>'max_covers') is null or (b->>'foh') is null or (b->>'boh') is null then raise exception 'band % needs max_covers, foh, boh', i; end if;
      if (b->>'max_covers')::int < 0 or (b->>'foh')::int < 0 or (b->>'boh')::int < 0 then raise exception 'band values must be >= 0'; end if;
      i := i + 1;
    end loop;
    if i = 0 then raise exception 'at least one band'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('max_covers', (x->>'max_covers')::int, 'foh', (x->>'foh')::int, 'boh', (x->>'boh')::int) order by (x->>'max_covers')::int), '[]'::jsonb)
      into s.staffing_bands from jsonb_array_elements(p_patch->'staffing_bands') x;
  end if;
  s.updated_at := now(); s.updated_by := auth.uid();
  insert into public.rota_settings select (s).*
  on conflict (entity_id) do update set
    overtime_rate = excluded.overtime_rate, tolerance_minutes = excluded.tolerance_minutes, default_budget_pct = excluded.default_budget_pct,
    staffing_bands = excluded.staffing_bands, weekly_budget_eur = excluded.weekly_budget_eur, spend_per_cover = excluded.spend_per_cover,
    lunch_share = excluded.lunch_share, holiday_uplift = excluded.holiday_uplift, updated_at = now(), updated_by = auth.uid();
  return s;
end $$;

-- 3) pay rate per PERSON (team_members.id) ------------------------------------
-- labor_hourly_rates' unique key is (entity, user_id, effective_from); with a
-- null user_id that key does not bite, so add the person-keyed one.
create unique index if not exists labor_hourly_rates_person_from on public.labor_hourly_rates(entity_id, person_id, effective_from) where person_id is not null;

create or replace function public.fn_rota_rate_set(p_entity uuid, p_person uuid, p_rate numeric, p_from date default null, p_role text default null)
returns public.labor_hourly_rates language plpgsql security definer set search_path = public, pg_temp as $$
declare tz text; d date; uid uuid; r public.labor_hourly_rates;
begin
  if not public.fn_is_entity_manager(auth.uid(), p_entity) then raise exception 'manager required'; end if;
  if p_rate is null or p_rate < 0 or p_rate > 500 then raise exception 'rate must be between 0 and 500'; end if;
  if not exists (select 1 from public.memberships m where m.entity_id = p_entity and m.person_id = p_person) then raise exception 'person is not on this team'; end if;
  select coalesce(e.timezone, 'Europe/Madrid') into tz from public.entities e where e.id = p_entity;
  d := coalesce(p_from, (now() at time zone tz)::date);
  select auth_user_id into uid from public.team_members where id = p_person;
  -- seal every open earlier row for this person (by person_id or by their auth user)
  update public.labor_hourly_rates set effective_to = d - 1
   where entity_id = p_entity and effective_to is null and effective_from < d
     and (person_id = p_person or (uid is not null and user_id = uid));
  -- a row already starting on d (either key) is replaced
  delete from public.labor_hourly_rates where entity_id = p_entity and effective_from = d and (person_id = p_person or (uid is not null and user_id = uid));
  insert into public.labor_hourly_rates (entity_id, user_id, person_id, role, hourly_rate_eur, effective_from)
  values (p_entity, uid, p_person, nullif(left(coalesce(p_role, ''), 40), ''), round(p_rate, 2), d) returning * into r;
  -- future planned shifts of this person pick up the new rate (the row trigger re-snapshots when hourly_cost is null)
  update public.rota_shifts set hourly_cost = null where entity_id = p_entity and person_id = p_person and service_date >= d and status <> 'cancelled';
  return r;
end $$;

-- 4) special days per entity (feeds the forecast in S7) ------------------------
create table if not exists public.entity_special_days (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.entities(id) on delete cascade,
  date        date not null,
  name        text not null,
  kind        text not null default 'special' check (kind in ('special','closed','quiet')),  -- special = busier than normal; closed = no service; quiet = slower
  uplift      numeric,                      -- optional override of rota_settings.holiday_uplift->kind
  notes       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (entity_id, date, name)
);
alter table public.entity_special_days enable row level security;
drop policy if exists entity_special_days_select on public.entity_special_days;
create policy entity_special_days_select on public.entity_special_days for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));
drop policy if exists entity_special_days_write on public.entity_special_days;
create policy entity_special_days_write on public.entity_special_days for all to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id))
  with check (public.fn_is_entity_manager(auth.uid(), entity_id));

-- seed: Nit de Sant Joan for the two Ibiza houses (Boris can delete or edit)
insert into public.entity_special_days (entity_id, date, name, kind, notes)
select e.id, d::date, 'Nit de Sant Joan', 'special', 'seeded 2026-10-01 — edit in Team › Rota › Settings'
  from public.entities e cross join (values ('2026-06-23'), ('2027-06-23')) v(d)
 where e.slug in ('bm', 'taller')
on conflict do nothing;

grant execute on function public.fn_rota_settings(uuid), public.fn_rota_settings_save(uuid, jsonb), public.fn_rota_rate_set(uuid, uuid, numeric, date, text) to authenticated;
