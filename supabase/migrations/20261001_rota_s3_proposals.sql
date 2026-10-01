-- 20261001_rota_s3_proposals.sql
-- Rota S3 — the reverse of ruling 1: given the forecast, propose a cheaper rota
-- for the same service. A SUGGESTION: the manager accepts per change; nothing
-- is applied automatically. The arithmetic is SQL; a model may only phrase the
-- explanation.
--
-- Forecast per day = bookings (party_size) vs. the average guests of the same
-- weekday over the last 4 weeks of eod_pos, whichever is higher. Required
-- heads per area come from rota_settings.staffing_bands (min FOH / BOH per
-- cover band). A planned shift counts as one head on its day. Surplus heads
-- are proposed for cancellation, most expensive first; days under cover are
-- flagged (never "fixed" by the OS).

-- forecast ------------------------------------------------------------------
create or replace function public.fn_rota_forecast(p_entity uuid, p_week_start date)
returns table (service_date date, booked_covers int, avg_covers_4w numeric, forecast_covers int, forecast_revenue numeric, basis text)
language sql stable security definer set search_path = public, pg_temp as $$
  with days as (select (p_week_start + i)::date d from generate_series(0, 6) i),
  rids as (select r.id from public.restaurants r where r.entity_id = p_entity),
  bk as (
    select b.service_date d, coalesce(sum(b.party_size), 0)::int covers
      from public.bookings b where b.restaurant_id in (select id from rids)
       and b.service_date >= p_week_start and b.service_date < p_week_start + 7
       and lower(coalesce(b.status, '')) not in ('cancelled','no_show','noshow')
     group by 1),
  hist as (
    select extract(isodow from ep.date)::int dow,
           avg(coalesce(nullif(ep.guests, 0), nullif(ep.guests_daily, 0), ep.covers, 0)) avg_covers,
           avg(coalesce(ep.food_net_eur,0) + coalesce(ep.wine_net_eur,0) + coalesce(ep.bar_net_eur,0) + coalesce(ep.softdrinks_net_eur,0)) avg_rev,
           count(*) n
      from public.eod_pos ep where ep.restaurant_id in (select id from rids)
       and ep.date >= p_week_start - 28 and ep.date < p_week_start
     group by 1)
  select d.d, coalesce(bk.covers, 0), round(coalesce(h.avg_covers, 0), 1),
         greatest(coalesce(bk.covers, 0), round(coalesce(h.avg_covers, 0))::int),
         round(coalesce(h.avg_rev, 0), 2),
         case when coalesce(bk.covers,0) >= round(coalesce(h.avg_covers,0)) and coalesce(bk.covers,0) > 0 then 'bookings'
              when coalesce(h.n, 0) > 0 then 'last ' || h.n || ' ' || to_char(d.d, 'Dy') || 's' else 'no data' end
    from days d
    left join bk on bk.d = d.d
    left join hist h on h.dow = extract(isodow from d.d)::int
   where public.fn_is_entity_member(auth.uid(), p_entity)
   order by d.d;
$$;

-- required heads for a cover count --------------------------------------------
create or replace function public.fn_rota_required(p_bands jsonb, p_covers int, p_area text)
returns int language sql immutable as $$
  select coalesce((select (b->>p_area)::int from jsonb_array_elements(p_bands) b
                    where (b->>'max_covers')::int >= p_covers
                    order by (b->>'max_covers')::int limit 1),
                  (select (b->>p_area)::int from jsonb_array_elements(p_bands) b order by (b->>'max_covers')::int desc limit 1), 0);
$$;

-- proposals -----------------------------------------------------------------
create table if not exists public.rota_proposals (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.entities(id) on delete cascade,
  week_start  date not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  before_eur  numeric not null default 0,
  after_eur   numeric not null default 0,
  forecast    jsonb not null default '[]'::jsonb,
  items       jsonb not null default '[]'::jsonb,   -- [{shift_id, person_id, name, service_date, area, start, end, saving_eur, reason, status}]
  warnings    jsonb not null default '[]'::jsonb,   -- days under the minimum
  explanation text,
  status      text not null default 'open' check (status in ('open','closed'))
);
create index if not exists rota_proposals_week on public.rota_proposals(entity_id, week_start, created_at desc);
alter table public.rota_proposals enable row level security;
drop policy if exists rota_proposals_select on public.rota_proposals;
create policy rota_proposals_select on public.rota_proposals for select to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id));
-- writes only via the RPCs

create or replace function public.fn_rota_propose(p_entity uuid, p_week_start date)
returns public.rota_proposals language plpgsql security definer set search_path = public, pg_temp as $$
declare st public.rota_settings; f record; items jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb; fc jsonb := '[]'::jsonb;
        before_eur numeric := 0; saving numeric := 0; need_foh int; need_boh int; have_foh int; have_boh int; r record; cut int; p public.rota_proposals;
        week_rev numeric := 0;
begin
  if not public.fn_is_entity_manager(auth.uid(), p_entity) then raise exception 'manager required'; end if;
  st := public.fn_rota_settings(p_entity);
  select coalesce(sum(planned_minutes * coalesce(hourly_cost, 0) / 60.0), 0) into before_eur
    from public.rota_shifts where entity_id = p_entity and service_date >= p_week_start and service_date < p_week_start + 7 and status <> 'cancelled';

  for f in select * from public.fn_rota_forecast(p_entity, p_week_start) loop
    week_rev := week_rev + coalesce(f.forecast_revenue, 0);
    fc := fc || jsonb_build_object('service_date', f.service_date, 'booked', f.booked_covers, 'avg_4w', f.avg_covers_4w, 'covers', f.forecast_covers, 'revenue', f.forecast_revenue, 'basis', f.basis);
    need_foh := public.fn_rota_required(st.staffing_bands, f.forecast_covers, 'foh');
    need_boh := public.fn_rota_required(st.staffing_bands, f.forecast_covers, 'boh');
    select count(*) filter (where area = 'foh'), count(*) filter (where area = 'boh') into have_foh, have_boh
      from public.rota_shifts where entity_id = p_entity and service_date = f.service_date and status <> 'cancelled';
    if have_foh < need_foh then warns := warns || jsonb_build_object('service_date', f.service_date, 'area', 'foh', 'have', have_foh, 'need', need_foh, 'covers', f.forecast_covers); end if;
    if have_boh < need_boh then warns := warns || jsonb_build_object('service_date', f.service_date, 'area', 'boh', 'have', have_boh, 'need', need_boh, 'covers', f.forecast_covers); end if;
    -- surplus: drop the most expensive shifts first, down to the minimum
    for r in
      select s.id, s.person_id, tm.name, s.area, s.start_time, s.end_time, s.planned_minutes, s.hourly_cost,
             row_number() over (partition by s.area order by s.planned_minutes * coalesce(s.hourly_cost, 0) desc, s.start_time) rn,
             count(*) over (partition by s.area) n_area
        from public.rota_shifts s left join public.team_members tm on tm.id = s.person_id
       where s.entity_id = p_entity and s.service_date = f.service_date and s.status <> 'cancelled' and s.area in ('foh','boh')
    loop
      cut := r.n_area - case when r.area = 'foh' then need_foh else need_boh end;
      if cut > 0 and r.rn <= cut then
        saving := saving + r.planned_minutes * coalesce(r.hourly_cost, 0) / 60.0;
        items := items || jsonb_build_object('shift_id', r.id, 'person_id', r.person_id, 'name', r.name, 'service_date', f.service_date, 'area', r.area,
                   'start', to_char(r.start_time, 'HH24:MI'), 'end', to_char(r.end_time, 'HH24:MI'),
                   'saving_eur', round(r.planned_minutes * coalesce(r.hourly_cost, 0) / 60.0, 2),
                   'reason', format('%s covers forecast (%s) → %s %s needed, %s planned', f.forecast_covers, f.basis, case when r.area='foh' then need_foh else need_boh end, upper(r.area), r.n_area),
                   'status', 'proposed');
      end if;
    end loop;
  end loop;

  insert into public.rota_proposals (entity_id, week_start, created_by, before_eur, after_eur, forecast, items, warnings)
  values (p_entity, p_week_start, auth.uid(), round(before_eur, 2), round(before_eur - saving, 2), fc, items, warns)
  returning * into p;
  -- the week's forecast revenue, if nobody typed one
  insert into public.rota_weeks (entity_id, week_start, forecast_revenue) values (p_entity, p_week_start, round(week_rev, 2))
  on conflict (entity_id, week_start) do update set forecast_revenue = coalesce(public.rota_weeks.forecast_revenue, excluded.forecast_revenue), updated_at = now();
  return p;
end $$;

-- accept ONE change (the manager's tick) --------------------------------------
create or replace function public.fn_rota_proposal_accept(p_proposal uuid, p_shift uuid, p_accept boolean default true)
returns public.rota_proposals language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.rota_proposals; it jsonb; new_items jsonb := '[]'::jsonb; found boolean := false;
begin
  select * into p from public.rota_proposals where id = p_proposal;
  if p.id is null then raise exception 'proposal not found'; end if;
  if not public.fn_is_entity_manager(auth.uid(), p.entity_id) then raise exception 'manager required'; end if;
  for it in select * from jsonb_array_elements(p.items) loop
    if (it->>'shift_id')::uuid = p_shift and it->>'status' = 'proposed' then
      found := true;
      if p_accept then
        update public.rota_shifts set status = 'cancelled' where id = p_shift and entity_id = p.entity_id;
        it := it || jsonb_build_object('status', 'accepted', 'decided_at', now());
      else
        it := it || jsonb_build_object('status', 'declined', 'decided_at', now());
      end if;
    end if;
    new_items := new_items || it;
  end loop;
  if not found then raise exception 'change not open on this proposal'; end if;
  update public.rota_proposals set items = new_items,
         status = case when not exists (select 1 from jsonb_array_elements(new_items) x where x->>'status' = 'proposed') then 'closed' else 'open' end
   where id = p.id returning * into p;
  return p;
end $$;

create or replace function public.fn_rota_proposal_explain(p_proposal uuid, p_text text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.rota_proposals set explanation = left(p_text, 600) where id = p_proposal and public.fn_is_entity_manager(auth.uid(), entity_id);
$$;

grant execute on function public.fn_rota_forecast(uuid,date), public.fn_rota_propose(uuid,date), public.fn_rota_proposal_accept(uuid,uuid,boolean), public.fn_rota_proposal_explain(uuid,text) to authenticated;
