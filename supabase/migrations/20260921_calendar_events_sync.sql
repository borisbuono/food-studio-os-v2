-- calendar: _sync — one normalising view per source + one idempotent refresher
-- (2026-09-21). Source tables stay authoritative; `events` mirrors them.
--   refresh_events_from_<source>(entity, from, to, id)  -> upsert + prune
--   AFTER INSERT/UPDATE/DELETE triggers on each source  -> real time
--   pg_cron 'events-nightly' 03:15 UTC                  -> catch-up
--   refresh_events(source|'all', entity, from, to)      -> manual repair (managers)
-- A sync failure NEVER blocks the source write (triggers swallow + WARN).

create or replace function public._entity_id_for_key(k text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.entities where slug = case upper(coalesce(k,'BBH'))
      when 'BM' then 'bm' when 'IFL' then 'taller' when 'IFS' then 'taller'
      when 'TALLER' then 'taller' when 'BBH' then 'holdings' when 'HOLDINGS' then 'holdings'
      else lower(k) end
  limit 1;
$$;

create or replace function public._entity_tz(e uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select timezone from public.entities where id = e), 'Europe/Madrid');
$$;

-- ---------------------------------------------------------------- views
create or replace view public.events_src_shift as
select ls.entity_id, 'shift'::text source_type, ls.id source_id,
  coalesce(tm.name, 'Shift') || coalesce(' · ' || nullif(ls.station,''), ' · ' || nullif(ls.role,''), '') title,
  ls.notes description,
  coalesce(ls.scheduled_start, ls.clock_in) start_ts,
  case when coalesce(ls.scheduled_end, ls.clock_out) >= coalesce(ls.scheduled_start, ls.clock_in)
       then coalesce(ls.scheduled_end, ls.clock_out) end end_ts,
  false all_day, coalesce(e.timezone,'Europe/Madrid') timezone, coalesce(e.accent_color,'#2B3A45') colour,
  null::text location,
  coalesce(array(select t.id from public.team_members t where t.auth_user_id = ls.user_id), '{}'::uuid[]) person_ids,
  case when ls.clock_out is not null then 'done' when ls.clock_in is not null then 'on' else 'planned' end status,
  jsonb_build_object('clock_in', ls.clock_in, 'clock_out', ls.clock_out, 'role', ls.role, 'station', ls.station) meta
from public.labor_shifts ls
join public.entities e on e.id = ls.entity_id
left join lateral (select t.name from public.team_members t where t.auth_user_id = ls.user_id limit 1) tm on true
where coalesce(ls.scheduled_start, ls.clock_in) is not null;

create or replace view public.events_src_booking as
select r.entity_id, 'booking'::text source_type, b.id source_id,
  coalesce(nullif(b.guest_name,''), 'Booking') || ' · ' || coalesce(b.party_size::text, '?') || 'p' title,
  b.notes description,
  case when b.service_time is null then (b.service_date::timestamp at time zone z.tz)
       else ((b.service_date + b.service_time) at time zone z.tz) end start_ts,
  case when b.service_time is null then null
       else ((b.service_date + b.service_time) at time zone z.tz) + interval '2 hours' end end_ts,
  b.service_time is null all_day, z.tz timezone, '#C9B38A'::text colour, r.name location,
  '{}'::uuid[] person_ids, b.status,
  jsonb_build_object('party_size', b.party_size, 'source', b.source, 'restaurant_id', b.restaurant_id) meta
from public.bookings b
join public.restaurants r on r.id = b.restaurant_id
join public.entities e on e.id = r.entity_id
cross join lateral (select coalesce(r.timezone, e.timezone, 'Europe/Madrid') tz) z
where b.service_date is not null and lower(coalesce(b.status,'')) not in ('cancelled','canceled');

create or replace view public.events_src_interview as
select c.entity_id, 'interview'::text source_type, i.id source_id,
  'Interview · ' || c.name title, i.notes description,
  i.scheduled_at start_ts, i.scheduled_at + interval '45 minutes' end_ts,
  false all_day, coalesce(e.timezone,'Europe/Madrid') timezone, '#D98E04'::text colour, i.location,
  coalesce(array(select t.id from public.team_members t
                  where t.id = any(i.interviewer_ids) or t.auth_user_id = any(i.interviewer_ids)), '{}'::uuid[]) person_ids,
  i.status,
  jsonb_build_object('candidate_id', c.id, 'format', i.format) meta
from public.interviews i
join public.candidates c on c.id = i.candidate_id
join public.entities e on e.id = c.entity_id
where i.scheduled_at is not null and lower(coalesce(i.status,'')) not in ('cancelled','canceled');

create or replace view public.events_src_task as
select public._entity_id_for_key(t.entity_code) entity_id, 'task'::text source_type, t.id source_id,
  t.title, t.description, t.due_at start_ts, null::timestamptz end_ts,
  false all_day, public._entity_tz(public._entity_id_for_key(t.entity_code)) timezone, '#4A6FA5'::text colour,
  null::text location,
  coalesce(array(select m.id from public.team_members m where m.auth_user_id = t.assignee_user_id), '{}'::uuid[]) person_ids,
  t.status, jsonb_build_object('priority', t.priority, 'entity_code', t.entity_code) meta
from public.master_todos t
where t.due_at is not null and lower(coalesce(t.status,'')) not in ('completed','done','cancelled','canceled','archived');

create or replace view public.events_src_social as
select public._entity_id_for_key(s.entity_code) entity_id, 'social'::text source_type, s.id source_id,
  upper(coalesce(s.channel,'post')) || ' · ' || coalesce(nullif(s.title,''), left(coalesce(s.body,''), 60)) title,
  null::text description, s.scheduled_at start_ts, null::timestamptz end_ts,
  false all_day, public._entity_tz(public._entity_id_for_key(s.entity_code)) timezone, '#6B7A3A'::text colour,
  null::text location, '{}'::uuid[] person_ids, s.status,
  jsonb_build_object('approved', s.approved_by_boris, 'media_type', s.media_type, 'permalink', s.permalink) meta
from public.social_posts s
where s.scheduled_at is not null;

create or replace view public.events_src_sales_event as
select coalesce(se.entity_id, r.entity_id) entity_id, 'sales_event'::text source_type, se.id source_id,
  coalesce(nullif(se.title,''), initcap(replace(coalesce(se.event_type,'event'),'_',' ')) || coalesce(' · ' || se.client_name,'')) title,
  se.dietary_notes description,
  case when se.service_window_start is null then (se.event_date::timestamp at time zone z.tz)
       else ((se.event_date + se.service_window_start) at time zone z.tz) end start_ts,
  case when se.service_window_start is null or se.service_window_end is null then null
       when se.service_window_end >= se.service_window_start then (se.event_date + se.service_window_end) at time zone z.tz
       else ((se.event_date + 1) + se.service_window_end) at time zone z.tz end end_ts,
  se.service_window_start is null all_day, z.tz timezone, '#D2452F'::text colour, r.name location,
  coalesce(array(select m.id from public.team_members m where m.auth_user_id = se.assigned_to), '{}'::uuid[]) person_ids,
  se.status,
  jsonb_build_object('guests', se.guests_count, 'client', se.client_name, 'type', se.event_type) meta
from public.sales_events se
left join public.restaurants r on r.id = se.restaurant_id
left join public.entities e on e.id = coalesce(se.entity_id, r.entity_id)
cross join lateral (select coalesce(r.timezone, e.timezone, 'Europe/Madrid') tz) z
where se.event_date is not null
  and lower(coalesce(se.status,'')) not in ('template','cancelled','canceled','lost','declined');

-- prep = ONE all-day row per (entity, service_date); id is deterministic.
create or replace function public._prep_event_id(e uuid, d date) returns uuid
language sql immutable as $$ select md5('prep:' || e::text || ':' || d::text)::uuid $$;

create or replace view public.events_src_prep as
select p.entity_id, 'prep'::text source_type, public._prep_event_id(p.entity_id, p.service_date) source_id,
  'Prep · ' || count(*) filter (where p.status not in ('done','skipped')) || ' open / ' || count(*) title,
  string_agg(distinct p.station, ', ') description,
  (p.service_date::timestamp at time zone public._entity_tz(p.entity_id)) start_ts, null::timestamptz end_ts,
  true all_day, public._entity_tz(p.entity_id) timezone, '#8A8A8A'::text colour, null::text location,
  '{}'::uuid[] person_ids,
  case when bool_and(p.status in ('done','skipped')) then 'done' else 'open' end status,
  jsonb_build_object('items', count(*), 'service_date', p.service_date) meta
from public.prep_lists p
where p.service_date is not null and p.entity_id is not null
group by p.entity_id, p.service_date;

create or replace view public.events_src_haccp as
select r.entity_id, 'haccp'::text source_type, h.id source_id,
  'Service due · ' || h.equipment_name title, h.contractor description,
  (h.next_service_due::timestamp at time zone coalesce(r.timezone,'Europe/Madrid')) start_ts, null::timestamptz end_ts,
  true all_day, coalesce(r.timezone,'Europe/Madrid') timezone, '#8A8A8A'::text colour, r.name location,
  '{}'::uuid[] person_ids, null::text status,
  jsonb_build_object('equipment_type', h.equipment_type, 'last_service', h.service_date) meta
from public.haccp_maintenance_log h
join public.restaurants r on r.id = h.restaurant_id
where h.next_service_due is not null and r.entity_id is not null;

create or replace view public.events_src_commercial as
select r.entity_id, 'commercial'::text source_type, c.id source_id,
  coalesce(nullif(c.title,''), initcap(coalesce(c.type,'promo'))) title, c.description,
  c.starts_at start_ts, c.ends_at end_ts,
  (c.ends_at is not null and c.ends_at - c.starts_at > interval '1 day') all_day,
  coalesce(r.timezone,'Europe/Madrid') timezone, '#B5651D'::text colour, r.name location,
  '{}'::uuid[] person_ids, case when c.active then 'active' else 'inactive' end status,
  jsonb_build_object('type', c.type) meta
from public.commercials c
join public.restaurants r on r.id = c.restaurant_id
where c.starts_at is not null and coalesce(c.active, true) and r.entity_id is not null
  and (c.ends_at is null or c.ends_at >= c.starts_at);

-- views are internal plumbing; nobody but definer functions reads them
do $$ declare v text; begin
  foreach v in array array['shift','booking','interview','task','social','sales_event','prep','haccp','commercial'] loop
    execute format('alter view public.events_src_%s set (security_invoker = true)', v);
    execute format('revoke all on public.events_src_%s from public, anon, authenticated', v);
  end loop; end $$;

-- ---------------------------------------------------------------- refresher
create or replace function public.refresh_events_from(
  p_source text, p_entity uuid default null, p_from timestamptz default null,
  p_to timestamptz default null, p_id uuid default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text; n int := 0;
begin
  if p_source not in ('shift','booking','interview','task','social','sales_event','prep','haccp','commercial') then
    raise exception 'unknown event source %', p_source;
  end if;
  v := 'public.events_src_' || p_source;
  execute format($q$
    insert into public.events as ev (entity_id, source_type, source_id, title, description, start_ts, end_ts,
                                     all_day, timezone, colour, location, person_ids, status, meta)
    select s.entity_id, s.source_type, s.source_id, s.title, s.description, s.start_ts, s.end_ts,
           s.all_day, s.timezone, s.colour, s.location, s.person_ids, s.status, s.meta
      from %s s
     where ($1::uuid is null or s.entity_id = $1) and ($2::timestamptz is null or s.start_ts >= $2)
       and ($3::timestamptz is null or s.start_ts < $3) and ($4::uuid is null or s.source_id = $4)
    on conflict (source_type, source_id) do update set
       entity_id = excluded.entity_id, title = excluded.title, description = excluded.description,
       start_ts = excluded.start_ts, end_ts = excluded.end_ts, all_day = excluded.all_day,
       timezone = excluded.timezone, colour = excluded.colour, location = excluded.location,
       person_ids = excluded.person_ids, status = excluded.status, meta = excluded.meta
     where (ev.entity_id, ev.title, ev.description, ev.start_ts, ev.end_ts, ev.all_day, ev.timezone,
            ev.colour, ev.location, ev.person_ids, ev.status, ev.meta)
           is distinct from
           (excluded.entity_id, excluded.title, excluded.description, excluded.start_ts, excluded.end_ts,
            excluded.all_day, excluded.timezone, excluded.colour, excluded.location, excluded.person_ids,
            excluded.status, excluded.meta)
  $q$, v) using p_entity, p_from, p_to, p_id;
  get diagnostics n = row_count;
  -- prune overlay rows whose source row is gone or no longer qualifies
  execute format($q$
    delete from public.events e
     where e.source_type = $5
       and ($1::uuid is null or e.entity_id = $1) and ($2::timestamptz is null or e.start_ts >= $2)
       and ($3::timestamptz is null or e.start_ts < $3) and ($4::uuid is null or e.source_id = $4)
       and not exists (select 1 from %s s where s.source_id = e.source_id)
  $q$, v) using p_entity, p_from, p_to, p_id, p_source;
  return n;
end $$;

-- the spec's per-source names
do $$ declare v text; begin
  foreach v in array array['shift','booking','interview','task','social','sales_event','prep','haccp','commercial'] loop
    execute format($f$
      create or replace function public.refresh_events_from_%1$s(p_entity uuid default null,
        p_from timestamptz default null, p_to timestamptz default null, p_id uuid default null)
      returns integer language sql security definer set search_path = public, pg_temp as
      $b$ select public.refresh_events_from(%2$L, p_entity, p_from, p_to, p_id) $b$ $f$, v, v);
    execute format('revoke all on function public.refresh_events_from_%s(uuid,timestamptz,timestamptz,uuid) from public, anon, authenticated', v);
  end loop; end $$;
revoke all on function public.refresh_events_from(text,uuid,timestamptz,timestamptz,uuid) from public, anon, authenticated;

create or replace function public.refresh_events_all(p_entity uuid default null,
  p_from timestamptz default null, p_to timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text; out jsonb := '{}'::jsonb;
begin
  foreach v in array array['shift','booking','interview','task','social','sales_event','prep','haccp','commercial'] loop
    out := out || jsonb_build_object(v, public.refresh_events_from(v, p_entity, p_from, p_to, null));
  end loop;
  return out;
end $$;
revoke all on function public.refresh_events_all(uuid,timestamptz,timestamptz) from public, anon, authenticated;

-- manual repair for the app: managers only, one entity at a time
create or replace function public.refresh_events(p_source text, p_entity uuid,
  p_from timestamptz default now() - interval '30 days', p_to timestamptz default now() + interval '90 days')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_entity is null or p_entity not in (select public.app_my_managed_entities()) then
    raise exception 'not a manager of this entity' using errcode = '42501';
  end if;
  if p_source = 'all' then return public.refresh_events_all(p_entity, p_from, p_to); end if;
  return jsonb_build_object(p_source, public.refresh_events_from(p_source, p_entity, p_from, p_to, null));
end $$;
revoke all on function public.refresh_events(text,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.refresh_events(text,uuid,timestamptz,timestamptz) to authenticated;

-- ---------------------------------------------------------------- triggers
create or replace function public.events_sync_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare src text := tg_argv[0];
begin
  begin
    if src = 'prep' then
      if tg_op in ('UPDATE','DELETE') and old.entity_id is not null and old.service_date is not null then
        perform public.refresh_events_from('prep', null, null, null, public._prep_event_id(old.entity_id, old.service_date));
      end if;
      if tg_op in ('INSERT','UPDATE') and new.entity_id is not null and new.service_date is not null then
        perform public.refresh_events_from('prep', null, null, null, public._prep_event_id(new.entity_id, new.service_date));
      end if;
    elsif tg_op = 'DELETE' then
      delete from public.events where source_type = src and source_id = old.id;
    else
      perform public.refresh_events_from(src, null, null, null, new.id);
    end if;
  exception when others then
    raise warning 'events sync (%) failed: %', src, sqlerrm;   -- never block the source write
  end;
  return null;
end $$;
revoke all on function public.events_sync_trg() from public, anon, authenticated;

do $$ declare r record; begin
  for r in select * from (values
      ('labor_shifts','shift'), ('bookings','booking'), ('interviews','interview'),
      ('master_todos','task'), ('social_posts','social'), ('sales_events','sales_event'),
      ('prep_lists','prep'), ('haccp_maintenance_log','haccp'), ('commercials','commercial')) t(tbl, src)
  loop
    execute format('drop trigger if exists events_sync on public.%I', r.tbl);
    execute format('create trigger events_sync after insert or update or delete on public.%I
                    for each row execute function public.events_sync_trg(%L)', r.tbl, r.src);
  end loop; end $$;

-- nightly catch-up (names/renames on team_members & candidates, window drift)
select cron.unschedule('events-nightly') where exists (select 1 from cron.job where jobname = 'events-nightly');
select cron.schedule('events-nightly', '15 3 * * *',
  $$select public.refresh_events_all(null, now() - interval '30 days', now() + interval '120 days')$$);

-- backfill: last 30 days + everything ahead
select public.refresh_events_all(null, now() - interval '30 days', null);
