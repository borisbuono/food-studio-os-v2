-- 20261001_rota_s7_history_holiday_forecast.sql
-- Rota S7 — the forecast learns from history + the calendar (Boris's ruling B, 2026-10-01).
--
-- fn_forecast_covers(entity, date, service) blends, in SQL, with every input kept:
--   bookings on the book (party_size) × the learned walk-in ratio,
--   the same weekday over the last 4–8 weeks (recent weeks weigh more),
--   the same weekday last year (date − 364, ±3 days fallback),
--   a holiday uplift: learned from last year's holiday vs non-holiday ratio where
--   ≥ 3 holiday days have data, otherwise the per-kind default in rota_settings.
-- Covers history is a proxy chain: till guest count → till bookings → Fresto
-- bookings → revenue ÷ spend per cover (learned or set). The source is recorded.
-- Rows are stored in rota_forecasts with their inputs so the UI can say
-- "last year this Saturday: 112 covers · holiday: Día de la Hispanidad".
--
-- Sources for the seed (cited in the ship note):
--   ES national 2026 — BOE-A-2025-21667, Resolución 17-10-2025 DG Trabajo (BOE 28-10-2025)
--   Illes Balears 2026 — Acord Consell de Govern 26-09-2025, BOIB 27-09-2025 (correccions 21-10 i 13-11-2025)
--   Eivissa / Sant Joan de Labritja 2026 locals — calendari laboral general i local Illes Balears 2026 (BOIB, via Cambra de Comerç d'Eivissa)
--   2027 — statutory dates (art. 37.2 ET) + Easter 2027; provisional until the BOE 2027 resolution (expected Oct 2026)

-- 1) holiday calendar ---------------------------------------------------------------
create table if not exists public.holiday_calendar (
  id          uuid primary key default gen_random_uuid(),
  country     text not null default 'ES',
  region      text,                -- 'Illes Balears'
  local       text,                -- municipality: 'Eivissa', 'Sant Joan de Labritja'
  date        date not null,
  name        text not null,
  kind        text not null check (kind in ('national','regional','local','special')),
  source      text,
  provisional boolean not null default false
);
create unique index if not exists holiday_calendar_key on public.holiday_calendar(country, coalesce(region, ''), coalesce(local, ''), date, name);
alter table public.holiday_calendar enable row level security;
drop policy if exists holiday_calendar_select on public.holiday_calendar;
create policy holiday_calendar_select on public.holiday_calendar for select to authenticated using (true);

insert into public.holiday_calendar (country, region, local, date, name, kind, source, provisional) values
 ('ES', null, null, '2026-01-01', 'Año Nuevo', 'national', 'BOE-A-2025-21667', false),
 ('ES', null, null, '2026-01-06', 'Epifanía del Señor', 'national', 'BOE-A-2025-21667', false),
 ('ES', null, null, '2026-04-03', 'Viernes Santo', 'national', 'BOE-A-2025-21667', false),
 ('ES', null, null, '2026-05-01', 'Fiesta del Trabajo', 'national', 'BOE-A-2025-21667', false),
 ('ES', null, null, '2026-08-15', 'Asunción de la Virgen', 'national', 'BOE-A-2025-21667', false),
 ('ES', null, null, '2026-10-12', 'Fiesta Nacional de España', 'national', 'BOE-A-2025-21667', false),
 ('ES', null, null, '2026-11-01', 'Todos los Santos', 'national', 'BOE-A-2025-21667 (Sunday)', false),
 ('ES', null, null, '2026-12-06', 'Día de la Constitución', 'national', 'BOE-A-2025-21667 (Sunday)', false),
 ('ES', null, null, '2026-12-08', 'Inmaculada Concepción', 'national', 'BOE-A-2025-21667', false),
 ('ES', null, null, '2026-12-25', 'Natividad del Señor', 'national', 'BOE-A-2025-21667', false),
 ('ES', 'Illes Balears', null, '2026-03-01', 'Dia de les Illes Balears', 'regional', 'BOIB 27-09-2025 (Sunday; Monday 2 March is the labour holiday)', false),
 ('ES', 'Illes Balears', null, '2026-03-02', 'Dilluns després del Dia de les Illes Balears', 'regional', 'BOIB 27-09-2025', false),
 ('ES', 'Illes Balears', null, '2026-04-02', 'Dijous Sant', 'regional', 'BOIB 27-09-2025', false),
 ('ES', 'Illes Balears', null, '2026-04-06', 'Dilluns de Pasqua', 'regional', 'BOIB 27-09-2025', false),
 ('ES', 'Illes Balears', null, '2026-12-26', 'Segona festa de Nadal', 'regional', 'BOIB 27-09-2025', false),
 ('ES', 'Illes Balears', 'Eivissa', '2026-08-05', 'Santa Maria de les Neus', 'local', 'calendari laboral local IB 2026', false),
 ('ES', 'Illes Balears', 'Eivissa', '2026-08-08', 'Sant Ciriac', 'local', 'calendari laboral local IB 2026', false),
 ('ES', 'Illes Balears', 'Sant Joan de Labritja', '2026-06-24', 'Sant Joan', 'local', 'calendari laboral local IB 2026', false),
 ('ES', 'Illes Balears', 'Sant Joan de Labritja', '2026-08-05', 'Mare de Déu de les Neus', 'local', 'calendari laboral local IB 2026', false),
 -- 2027: statutory + Easter (28-03-2027); provisional until the BOE resolution
 ('ES', null, null, '2027-01-01', 'Año Nuevo', 'national', 'art. 37.2 ET — provisional', true),
 ('ES', null, null, '2027-01-06', 'Epifanía del Señor', 'national', 'art. 37.2 ET — provisional', true),
 ('ES', null, null, '2027-03-26', 'Viernes Santo', 'national', 'Easter 2027 — provisional', true),
 ('ES', null, null, '2027-05-01', 'Fiesta del Trabajo', 'national', 'art. 37.2 ET — provisional', true),
 ('ES', null, null, '2027-08-15', 'Asunción de la Virgen', 'national', 'art. 37.2 ET — provisional (Sunday)', true),
 ('ES', null, null, '2027-10-12', 'Fiesta Nacional de España', 'national', 'art. 37.2 ET — provisional', true),
 ('ES', null, null, '2027-11-01', 'Todos los Santos', 'national', 'art. 37.2 ET — provisional', true),
 ('ES', null, null, '2027-12-06', 'Día de la Constitución', 'national', 'art. 37.2 ET — provisional', true),
 ('ES', null, null, '2027-12-08', 'Inmaculada Concepción', 'national', 'art. 37.2 ET — provisional', true),
 ('ES', null, null, '2027-12-25', 'Natividad del Señor', 'national', 'art. 37.2 ET — provisional', true),
 ('ES', 'Illes Balears', null, '2027-03-01', 'Dia de les Illes Balears', 'regional', 'provisional', true),
 ('ES', 'Illes Balears', null, '2027-03-25', 'Dijous Sant', 'regional', 'Easter 2027 — provisional', true),
 ('ES', 'Illes Balears', null, '2027-03-29', 'Dilluns de Pasqua', 'regional', 'Easter 2027 — provisional', true),
 ('ES', 'Illes Balears', null, '2027-12-26', 'Segona festa de Nadal', 'regional', 'provisional', true),
 ('ES', 'Illes Balears', 'Eivissa', '2027-08-05', 'Santa Maria de les Neus', 'local', 'provisional', true),
 ('ES', 'Illes Balears', 'Eivissa', '2027-08-08', 'Sant Ciriac', 'local', 'provisional', true),
 ('ES', 'Illes Balears', 'Sant Joan de Labritja', '2027-06-24', 'Sant Joan', 'local', 'provisional', true),
 ('ES', 'Illes Balears', 'Sant Joan de Labritja', '2027-08-05', 'Mare de Déu de les Neus', 'local', 'provisional', true),
 -- island-wide nights that move a room (kind special; the house's own list in entity_special_days wins when both match)
 ('ES', 'Illes Balears', null, '2026-06-23', 'Nit de Sant Joan', 'special', 'tradition', false),
 ('ES', 'Illes Balears', null, '2027-06-23', 'Nit de Sant Joan', 'special', 'tradition', false),
 ('ES', 'Illes Balears', null, '2026-01-05', 'Nit de Reis', 'special', 'tradition', false),
 ('ES', 'Illes Balears', null, '2027-01-05', 'Nit de Reis', 'special', 'tradition', false),
 ('ES', null, null, '2026-12-24', 'Nochebuena', 'special', 'tradition', false),
 ('ES', null, null, '2026-12-31', 'Nochevieja', 'special', 'tradition', false),
 ('ES', null, null, '2027-12-24', 'Nochebuena', 'special', 'tradition', false),
 ('ES', null, null, '2027-12-31', 'Nochevieja', 'special', 'tradition', false)
on conflict do nothing;

-- where each house sits (for regional/local matching); Boris can change these in settings later
alter table public.rota_settings add column if not exists holiday_region text;
alter table public.rota_settings add column if not exists holiday_local  text;
insert into public.rota_settings (entity_id, holiday_region, holiday_local)
select e.id, 'Illes Balears', case e.slug when 'bm' then 'Sant Joan de Labritja' else 'Eivissa' end from public.entities e where e.slug in ('bm','taller')
on conflict (entity_id) do update set holiday_region = coalesce(public.rota_settings.holiday_region, excluded.holiday_region), holiday_local = coalesce(public.rota_settings.holiday_local, excluded.holiday_local);

-- settings save learns the two scope fields
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
  if p_patch ? 'holiday_region'     then s.holiday_region := nullif(left(p_patch->>'holiday_region', 60), ''); end if;
  if p_patch ? 'holiday_local'      then s.holiday_local := nullif(left(p_patch->>'holiday_local', 60), ''); end if;
  if p_patch ? 'holiday_uplift' and jsonb_typeof(p_patch->'holiday_uplift') = 'object' then s.holiday_uplift := s.holiday_uplift || (p_patch->'holiday_uplift'); end if;
  if p_patch ? 'staffing_bands' and jsonb_typeof(p_patch->'staffing_bands') = 'array' then
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
    lunch_share = excluded.lunch_share, holiday_uplift = excluded.holiday_uplift, holiday_region = excluded.holiday_region, holiday_local = excluded.holiday_local,
    updated_at = now(), updated_by = auth.uid();
  return s;
end $$;

-- the holidays that apply to one house, incl. its own special days
create or replace function public.fn_entity_holidays(p_entity uuid, p_from date, p_to date)
returns table (date date, name text, kind text, scope text, uplift numeric, provisional boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from public.fn_rota_settings(p_entity)),
       e as (select coalesce(upper(country_code), 'ES') country from public.entities where id = p_entity)
  select h.date, h.name, h.kind,
         case h.kind when 'national' then h.country when 'regional' then h.region when 'local' then h.local else coalesce(h.local, h.region, h.country) end,
         null::numeric, h.provisional
    from public.holiday_calendar h, s, e
   where h.date between p_from and p_to and h.country = e.country
     and (h.region is null or h.region = s.holiday_region)
     and (h.local is null or h.local = s.holiday_local)
     and (public.fn_is_entity_member(auth.uid(), p_entity) or auth.uid() is null)
  union all
  select d.date, d.name, d.kind, 'house', d.uplift, false
    from public.entity_special_days d
   where d.entity_id = p_entity and d.date between p_from and p_to and (public.fn_is_entity_member(auth.uid(), p_entity) or auth.uid() is null)
   order by 1, 3;
$$;

-- 2) covers history (the proxy chain) ---------------------------------------------
create or replace function public._entity_fresto_code(p_entity uuid)
returns text language sql stable as $$
  select case slug when 'bm' then 'BM' when 'taller' then 'IFL' else upper(slug) end from public.entities where id = p_entity;
$$;

create or replace function public.fn_spend_per_cover(p_entity uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select spend_per_cover from public.rota_settings where entity_id = p_entity),
    (select round(least(200, greatest(15, sum(rev) / nullif(sum(g), 0))), 2)
       from (select coalesce(ep.food_net_eur,0)+coalesce(ep.wine_net_eur,0)+coalesce(ep.bar_net_eur,0)+coalesce(ep.softdrinks_net_eur,0) rev,
                    coalesce(nullif(ep.guests,0), nullif(ep.guests_daily,0)) g
               from public.eod_pos ep join public.restaurants r on r.id = ep.restaurant_id
              where r.entity_id = p_entity and ep.date >= current_date - 400) x where g > 0 and rev > 0),
    45);
$$;

create or replace function public.fn_covers_history(p_entity uuid, p_from date, p_to date)
returns table (date date, covers numeric, source text, revenue numeric, lunch_share numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with spc as (select public.fn_spend_per_cover(p_entity) v),
  pos as (
    select ep.date, sum(coalesce(ep.food_net_eur,0)+coalesce(ep.wine_net_eur,0)+coalesce(ep.bar_net_eur,0)+coalesce(ep.softdrinks_net_eur,0)) rev,
           sum(coalesce(nullif(ep.guests,0), 0)) g, sum(coalesce(nullif(ep.guests_daily,0), 0)) gd,
           -- lunch share from the hourly split when the till has one
           (sum((select coalesce(sum((v)::numeric), 0) from jsonb_each_text(coalesce(ep.hourly_revenue,'{}'::jsonb)) kv(k, v) where k ~ '^\d+$' and k::int < 17))
             / nullif(sum((select coalesce(sum((v)::numeric), 0) from jsonb_each_text(coalesce(ep.hourly_revenue,'{}'::jsonb)) kv(k, v) where k ~ '^\d+$')), 0)) ls
      from public.eod_pos ep join public.restaurants r on r.id = ep.restaurant_id
     where r.entity_id = p_entity and ep.date between p_from and p_to
     group by ep.date),
  fb as (
    select business_date d, sum(coalesce(guests_daily, 0)) g from public.fresto_bookings_daily_raw
     where entity_code = public._entity_fresto_code(p_entity) and business_date between p_from and p_to group by 1)
  select coalesce(pos.date, fb.d),
         case when coalesce(pos.g, 0) > 0 then pos.g
              when coalesce(pos.gd, 0) > 0 then pos.gd
              when coalesce(fb.g, 0) > 0 then fb.g
              when coalesce(pos.rev, 0) > 0 then round(pos.rev / spc.v)
              else null end,
         case when coalesce(pos.g, 0) > 0 then 'till guests'
              when coalesce(pos.gd, 0) > 0 then 'till bookings'
              when coalesce(fb.g, 0) > 0 then 'fresto bookings'
              when coalesce(pos.rev, 0) > 0 then 'revenue ÷ €' || spc.v::text
              else 'no data' end,
         round(coalesce(pos.rev, 0), 2), pos.ls
    from pos full join fb on fb.d = pos.date, spc
   where public.fn_is_entity_member(auth.uid(), p_entity) or auth.uid() is null;
$$;

-- 3) the forecast --------------------------------------------------------------------
create table if not exists public.rota_forecasts (
  entity_id     uuid not null references public.entities(id) on delete cascade,
  service_date  date not null,
  service       text not null check (service in ('day','lunch','dinner')),
  covers        int  not null default 0,
  revenue       numeric,
  inputs        jsonb not null default '{}'::jsonb,
  computed_at   timestamptz not null default now(),
  primary key (entity_id, service_date, service)
);
alter table public.rota_forecasts enable row level security;
drop policy if exists rota_forecasts_select on public.rota_forecasts;
create policy rota_forecasts_select on public.rota_forecasts for select to authenticated using (public.fn_is_entity_member(auth.uid(), entity_id));

create or replace function public.fn_forecast_covers(p_entity uuid, p_date date, p_service text default 'day')
returns public.rota_forecasts language plpgsql security definer set search_path = public, pg_temp as $$
declare st public.rota_settings; dow int; booked int := 0; walkin numeric; hist4 numeric; hist8 numeric; n4 int; n8 int; hist numeric; hist_basis text;
        ly numeric; ly_src text; ly_date date; ly_cov numeric; ly_rev numeric; hol record; uplift numeric := 1; uplift_src text := null; hol_name text := null; hol_kind text := null;
        base numeric; fc int; rev numeric; spc numeric; share numeric; svc_share numeric; out public.rota_forecasts; inputs jsonb; hist_rev numeric;
        hl_ratio numeric; hl_n int;
begin
  if not (public.fn_is_entity_member(auth.uid(), p_entity) or auth.uid() is null) then raise exception 'not a member'; end if;
  if p_service not in ('day','lunch','dinner') then raise exception 'service must be day|lunch|dinner'; end if;
  st := public.fn_rota_settings(p_entity);
  dow := extract(isodow from p_date)::int;
  spc := public.fn_spend_per_cover(p_entity);

  -- bookings on the book (OS bookings table; Fresto bookings for the date if newer)
  select coalesce(sum(b.party_size), 0) into booked
    from public.bookings b join public.restaurants r on r.id = b.restaurant_id
   where r.entity_id = p_entity and b.service_date = p_date and lower(coalesce(b.status,'')) not in ('cancelled','no_show','noshow')
     and (p_service = 'day' or (p_service = 'lunch' and b.service_time < '17:00') or (p_service = 'dinner' and (b.service_time is null or b.service_time >= '17:00')));
  -- walk-in ratio: final guests ÷ booked guests over the last 8 weeks where both are known
  select round(least(3, greatest(1, sum(guests_daily)::numeric / nullif(sum(guests_booked), 0))), 2) into walkin
    from public.fresto_bookings_daily_raw where entity_code = public._entity_fresto_code(p_entity) and business_date >= p_date - 56 and business_date < p_date and guests_booked > 0 and guests_daily > 0;
  walkin := coalesce(walkin, 1.2);

  -- same weekday, last 4 and last 8 weeks (holidays excluded from the base)
  with h as (
    select ch.date, ch.covers, ch.revenue, ch.lunch_share from public.fn_covers_history(p_entity, p_date - 56, p_date - 1) ch
     where extract(isodow from ch.date)::int = dow and ch.covers is not null
       and not exists (select 1 from public.fn_entity_holidays(p_entity, ch.date, ch.date)))
  select avg(covers) filter (where date >= p_date - 28), count(*) filter (where date >= p_date - 28), avg(covers), count(*), avg(revenue), avg(lunch_share)
    into hist4, n4, hist8, n8, hist_rev, share from h;
  if n4 >= 2 then hist := round(0.7 * hist4 + 0.3 * coalesce(hist8, hist4)); hist_basis := 'last ' || n8 || ' ' || to_char(p_date, 'Dy') || 's (recent 4 weigh 70 %)';
  elsif n8 > 0 then hist := round(hist8); hist_basis := 'last ' || n8 || ' ' || to_char(p_date, 'Dy') || (case when n8 = 1 then '' else 's' end);
  else hist := null; hist_basis := 'no recent ' || to_char(p_date, 'Dy') || 's'; end if;

  -- last year: the same weekday (date − 364), else the nearest same weekday within ±3 days of date − 365
  select ch.date, ch.covers, ch.revenue into ly_date, ly_cov, ly_rev from public.fn_covers_history(p_entity, p_date - 368, p_date - 361) ch
   where ch.covers is not null order by (ch.date = p_date - 364) desc, (extract(isodow from ch.date)::int = dow) desc, abs(ch.date - (p_date - 365)) limit 1;
  ly := ly_cov; ly_src := case when ly_date is null then null when ly_date = p_date - 364 then 'same ' || to_char(p_date, 'Dy') || ' last year' else to_char(ly_date, 'Dy DD Mon YYYY') end;

  -- holiday: strongest applicable match; learned ratio from last year where ≥3 holiday days have data
  select h.name, h.kind, h.uplift into hol from public.fn_entity_holidays(p_entity, p_date, p_date) h
   order by case h.kind when 'closed' then 0 when 'quiet' then 1 when 'special' then 2 when 'local' then 3 when 'regional' then 4 else 5 end limit 1;
  if hol.kind is not null then
    hol_name := hol.name; hol_kind := hol.kind;
    if hol.kind = 'closed' then uplift := 0; uplift_src := 'closed (house setting)';
    elsif hol.uplift is not null then uplift := hol.uplift; uplift_src := 'house setting';
    else
      -- learn: last year's holiday days of this kind ÷ non-holiday days of the same weekdays in the surrounding 8 weeks
      with hd as (select hh.date from public.fn_entity_holidays(p_entity, p_date - 400, p_date - 330) hh where hh.kind = hol.kind),
           hc as (select ch.date, ch.covers from public.fn_covers_history(p_entity, p_date - 430, p_date - 300) ch where ch.covers is not null),
           ratio as (
             select hc.covers / nullif((select avg(x.covers) from hc x where extract(isodow from x.date) = extract(isodow from hc.date) and x.date between hc.date - 28 and hc.date + 28
                                           and not exists (select 1 from public.fn_entity_holidays(p_entity, x.date, x.date))), 0) r
               from hc join hd on hd.date = hc.date)
      select round(avg(r), 2), count(*) into hl_ratio, hl_n from ratio where r is not null;
      if hl_n >= 3 and hl_ratio is not null then uplift := least(3, greatest(0.3, hl_ratio)); uplift_src := 'learned from ' || hl_n || ' ' || hol.kind || ' days last year';
      else uplift := coalesce((st.holiday_uplift->>hol.kind)::numeric, case hol.kind when 'quiet' then 0.7 else 1.2 end); uplift_src := 'default for ' || hol.kind; end if;
    end if;
  end if;

  -- blend
  base := case when hist is not null and ly is not null then round(0.6 * hist + 0.4 * ly)
               when hist is not null then hist when ly is not null then ly else null end;
  if base is not null then base := round(base * uplift); end if;
  fc := greatest(coalesce(round(booked * walkin)::int, 0), coalesce(base, 0)::int);
  svc_share := case p_service when 'lunch' then coalesce(share, st.lunch_share) when 'dinner' then 1 - coalesce(share, st.lunch_share) else 1 end;
  if p_service <> 'day' then fc := round(fc * svc_share)::int; end if;
  rev := case when p_service = 'day' then coalesce(hist_rev, fc * spc) else round(coalesce(hist_rev, fc * spc) * svc_share, 2) end;
  if hol_kind is not null and hist_rev is not null then rev := round(rev * uplift, 2); end if;

  inputs := jsonb_build_object(
    'booked', booked, 'walkin_ratio', walkin, 'booked_projection', round(booked * walkin),
    'avg_4w', round(coalesce(hist4, 0), 1), 'n_4w', coalesce(n4, 0), 'avg_8w', round(coalesce(hist8, 0), 1), 'n_8w', coalesce(n8, 0), 'history', hist, 'history_basis', hist_basis,
    'last_year', ly, 'last_year_date', ly_date, 'last_year_source', ly_src, 'last_year_revenue', ly_rev,
    'holiday', hol_name, 'holiday_kind', hol_kind, 'uplift', uplift, 'uplift_source', uplift_src,
    'base_before_uplift', case when base is null then null when uplift = 0 then null else round(base / uplift) end,
    'spend_per_cover', spc, 'service_share', svc_share, 'service', p_service,
    'basis', case when booked > 0 and round(booked * walkin) >= coalesce(base, 0) then 'bookings × walk-in ' || walkin
                  when hist is not null and ly is not null then 'history 60 % + last year 40 %' || case when uplift <> 1 then ' × ' || uplift else '' end
                  when hist is not null then hist_basis || case when uplift <> 1 then ' × ' || uplift else '' end
                  when ly is not null then 'last year only' || case when uplift <> 1 then ' × ' || uplift else '' end
                  else 'no data' end);
  insert into public.rota_forecasts (entity_id, service_date, service, covers, revenue, inputs, computed_at)
  values (p_entity, p_date, p_service, fc, round(rev, 2), inputs, now())
  on conflict (entity_id, service_date, service) do update set covers = excluded.covers, revenue = excluded.revenue, inputs = excluded.inputs, computed_at = now()
  returning * into out;
  return out;
end $$;

-- the week view the Rota tab reads (replaces the S3 shape; adds the inputs)
drop function if exists public.fn_rota_forecast(uuid, date);
create or replace function public.fn_rota_forecast(p_entity uuid, p_week_start date)
returns table (service_date date, booked_covers int, avg_covers_4w numeric, forecast_covers int, forecast_revenue numeric, basis text,
               last_year_covers int, last_year_source text, holiday text, holiday_kind text, uplift numeric, lunch_covers int, dinner_covers int, inputs jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare d date; f public.rota_forecasts; l public.rota_forecasts; dn public.rota_forecasts;
begin
  if not public.fn_is_entity_member(auth.uid(), p_entity) then return; end if;
  for d in select (p_week_start + i)::date from generate_series(0, 6) i loop
    f := public.fn_forecast_covers(p_entity, d, 'day'); l := public.fn_forecast_covers(p_entity, d, 'lunch'); dn := public.fn_forecast_covers(p_entity, d, 'dinner');
    service_date := d; booked_covers := (f.inputs->>'booked')::int; avg_covers_4w := (f.inputs->>'avg_4w')::numeric; forecast_covers := f.covers; forecast_revenue := f.revenue;
    basis := f.inputs->>'basis'; last_year_covers := (f.inputs->>'last_year')::int; last_year_source := f.inputs->>'last_year_source';
    holiday := f.inputs->>'holiday'; holiday_kind := f.inputs->>'holiday_kind'; uplift := (f.inputs->>'uplift')::numeric; lunch_covers := l.covers; dinner_covers := dn.covers; inputs := f.inputs;
    return next;
  end loop;
end $$;

grant execute on function public.fn_entity_holidays(uuid, date, date), public.fn_covers_history(uuid, date, date), public.fn_forecast_covers(uuid, date, text), public.fn_rota_forecast(uuid, date), public.fn_spend_per_cover(uuid) to authenticated;

-- nightly: refresh the next 14 days of forecasts for every house with a rota or a till feed
create or replace function public.fn_forecast_all()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e record; d int; n int := 0; out jsonb := '{}'::jsonb; k int;
begin
  for e in select distinct x.entity_id from (select entity_id from public.rota_shifts union select r.entity_id from public.eod_pos ep join public.restaurants r on r.id = ep.restaurant_id where ep.date >= current_date - 60) x loop
    k := 0;
    for d in 0..13 loop
      begin
        perform public.fn_forecast_covers(e.entity_id, current_date + d, 'day');
        perform public.fn_forecast_covers(e.entity_id, current_date + d, 'lunch');
        perform public.fn_forecast_covers(e.entity_id, current_date + d, 'dinner');
        k := k + 1;
      exception when others then raise warning 'forecast % %: %', e.entity_id, current_date + d, sqlerrm; end;
    end loop;
    n := n + k; out := out || jsonb_build_object(e.entity_id::text, k);
  end loop;
  begin
    insert into public.cron_runs (job, triggered_by, finished_at, ok, detail) values ('rota_forecast', 'pg_cron', now(), true, out);
  exception when others then null; end;
  return out;
end $$;
revoke execute on function public.fn_forecast_all() from public, anon, authenticated;
do $$ begin perform cron.unschedule('rota_forecast_nightly'); exception when others then null; end $$;
select cron.schedule('rota_forecast_nightly', '40 4 * * *', $$select public.fn_forecast_all()$$);
