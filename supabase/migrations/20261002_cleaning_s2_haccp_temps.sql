-- 20261002_cleaning_s2_haccp_temps.sql
-- Cleaning S2 — HACCP temperatures on the same list.
--
-- A fridge / freezer reading is a line on the opening (and closing) run: tap →
-- type the number → the reading is written to haccp_temperature_logs (the
-- table that has been silent since 20-Aug — reused, not duplicated) and the
-- line is done by me, now. Out of range: the line goes red and a "corrective
-- action" line appears under it; it must carry a note before the run can be
-- signed (cleaning_sign already refuses while one is open).

-- 1) temp columns on the run items -------------------------------------------
alter table public.cleaning_run_items
  add column if not exists equipment_name text,
  add column if not exists equipment_type text,
  add column if not exists target_min_c numeric,
  add column if not exists target_max_c numeric,
  add column if not exists temperature_c numeric,
  add column if not exists in_range boolean,
  add column if not exists temp_log_id uuid references public.haccp_temperature_logs(id) on delete set null,
  add column if not exists parent_item_id uuid references public.cleaning_run_items(id) on delete cascade;

-- 2) materialise copies the band from the template item ----------------------
create or replace function public.fn_cleaning_materialise(p_entity uuid default null, p_date date default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e record; t record; d date; n int := 0; rid uuid; it jsonb; i int;
begin
  for e in select id, timezone from public.entities where (p_entity is null or id = p_entity) and is_active loop
    d := coalesce(p_date, (now() at time zone coalesce(e.timezone, 'Europe/Madrid'))::date);
    for t in
      select * from public.cleaning_templates ct
       where ct.entity_id = e.id and ct.active
         and (ct.frequency in ('opening','closing','daily')
              or (ct.frequency = 'weekly'  and ct.weekday = extract(isodow from d)::int)
              or (ct.frequency = 'monthly' and extract(day from d)::int = 1))
         and not exists (select 1 from public.cleaning_runs r where r.template_id = ct.id and r.service_date = d)
    loop
      insert into public.cleaning_runs(entity_id, template_id, template_name, area, service_date, shift)
      values (e.id, t.id, t.name, t.area, d, t.frequency)
      returning id into rid;
      i := 0;
      for it in select * from jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) order by coalesce((value->>'order')::int, 9999), value->>'label' loop
        i := i + 1;
        insert into public.cleaning_run_items(run_id, entity_id, label, sort_order, kind, equipment_name, equipment_type, target_min_c, target_max_c)
        values (rid, e.id, coalesce(it->>'label', '—'), i,
                case when it->>'kind' = 'temp' then 'temp' else 'task' end,
                case when it->>'kind' = 'temp' then coalesce(it->>'equipment', it->>'label') end,
                case when it->>'kind' = 'temp' then coalesce(it->>'equipment_type', 'fridge') end,
                case when it->>'kind' = 'temp' then nullif(it->>'min_c','')::numeric end,
                case when it->>'kind' = 'temp' then nullif(it->>'max_c','')::numeric end);
      end loop;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- 3) the reading ---------------------------------------------------------------
create or replace function public.cleaning_temp(p_item uuid, p_temp numeric)
returns public.cleaning_run_items language plpgsql security definer set search_path = public, pg_temp as $$
declare
  it public.cleaning_run_items; r public.cleaning_runs; rid uuid; ok boolean; lid uuid; nm text; corr_exists boolean;
begin
  select * into it from public.cleaning_run_items where id = p_item;
  if it.id is null then raise exception 'item not found'; end if;
  if it.kind <> 'temp' then raise exception 'not a temperature line'; end if;
  if not public.fn_is_entity_member(auth.uid(), it.entity_id) then raise exception 'not a member of this house'; end if;
  select * into r from public.cleaning_runs where id = it.run_id;
  if r.status = 'signed' then raise exception 'run already signed'; end if;
  if p_temp is null or p_temp < -60 or p_temp > 120 then raise exception 'temperature out of bounds'; end if;

  ok := (it.target_min_c is null or p_temp >= it.target_min_c) and (it.target_max_c is null or p_temp <= it.target_max_c);
  nm := public.fn_cleaning_actor_name(auth.uid(), it.entity_id);
  select id into rid from public.restaurants where entity_id = it.entity_id and (archived_at is null) order by created_at limit 1;

  -- the HACCP log row: one per line; a re-reading corrects it in place
  if it.temp_log_id is not null then
    update public.haccp_temperature_logs
       set temperature_c = p_temp, measured_at = now(), measured_by = auth.uid(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('re_read', true, 'measured_by_name', nm)
     where id = it.temp_log_id returning id into lid;
  end if;
  if lid is null and rid is not null then
    -- is_within_range is a GENERATED column on haccp_temperature_logs — never written
    insert into public.haccp_temperature_logs(restaurant_id, equipment_name, equipment_type, measured_at, measured_by, temperature_c, target_min_c, target_max_c, metadata)
    values (rid, coalesce(it.equipment_name, it.label), coalesce(it.equipment_type, 'fridge'), now(), auth.uid(), p_temp, it.target_min_c, it.target_max_c,
            jsonb_build_object('source', 'cleaning', 'cleaning_run_item_id', it.id, 'cleaning_run_id', it.run_id, 'service_date', r.service_date, 'measured_by_name', nm))
    returning id into lid;
  end if;

  update public.cleaning_run_items
     set temperature_c = p_temp, in_range = ok, temp_log_id = coalesce(lid, temp_log_id),
         done = true, done_by = auth.uid(), done_by_name = nm, done_at = now()
   where id = p_item returning * into it;

  if not ok then
    select exists(select 1 from public.cleaning_run_items c where c.parent_item_id = it.id and c.kind = 'corrective') into corr_exists;
    if not corr_exists then
      insert into public.cleaning_run_items(run_id, entity_id, label, sort_order, kind, parent_item_id, equipment_name, temperature_c, target_min_c, target_max_c)
      values (it.run_id, it.entity_id,
              coalesce(it.equipment_name, it.label) || ' ' || p_temp || ' °C' ||
                case when it.target_min_c is not null or it.target_max_c is not null then ' (' || coalesce(it.target_min_c::text, '…') || '–' || coalesce(it.target_max_c::text, '…') || ')' else '' end,
              it.sort_order, 'corrective', it.id, it.equipment_name, p_temp, it.target_min_c, it.target_max_c);
    else
      update public.cleaning_run_items set temperature_c = p_temp where parent_item_id = it.id and kind = 'corrective' and not done;
    end if;
  end if;
  return it;
end $$;
revoke all on function public.cleaning_temp(uuid, numeric) from public;
grant execute on function public.cleaning_temp(uuid, numeric) to authenticated;

-- 4) untick of a temp line clears the reading and retracts the log row ------
create or replace function public.cleaning_tick(p_item uuid, p_done boolean default true, p_note text default null)
returns public.cleaning_run_items language plpgsql security definer set search_path = public, pg_temp as $$
declare it public.cleaning_run_items; r public.cleaning_runs;
begin
  select * into it from public.cleaning_run_items where id = p_item;
  if it.id is null then raise exception 'item not found'; end if;
  if not public.fn_is_entity_member(auth.uid(), it.entity_id) then raise exception 'not a member of this house'; end if;
  select * into r from public.cleaning_runs where id = it.run_id;
  if r.status = 'signed' then raise exception 'run already signed'; end if;
  if it.kind = 'temp' and p_done and it.temperature_c is null then raise exception 'temperature line needs a reading'; end if;
  if it.kind = 'temp' and not p_done then
    if it.temp_log_id is not null then
      update public.haccp_temperature_logs set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('retracted', true, 'retracted_at', now()) where id = it.temp_log_id;
    end if;
    update public.cleaning_run_items set temperature_c = null, in_range = null, temp_log_id = null where id = p_item;
  end if;
  -- the corrective line that a corrected reading no longer needs, if it was never answered
  if it.kind = 'temp' and not p_done then
    delete from public.cleaning_run_items c where c.parent_item_id = it.id and c.kind = 'corrective' and not c.done and c.note is null;
  end if;
  update public.cleaning_run_items
     set done = p_done,
         done_by = case when p_done then auth.uid() else null end,
         done_by_name = case when p_done then public.fn_cleaning_actor_name(auth.uid(), it.entity_id) else null end,
         done_at = case when p_done then now() else null end,
         note = coalesce(p_note, note)
   where id = p_item
   returning * into it;
  return it;
end $$;

-- 5) note on a corrective line = the action taken; ticks it ------------------
create or replace function public.cleaning_note(p_item uuid, p_note text)
returns public.cleaning_run_items language plpgsql security definer set search_path = public, pg_temp as $$
declare it public.cleaning_run_items; r public.cleaning_runs;
begin
  select * into it from public.cleaning_run_items where id = p_item;
  if it.id is null then raise exception 'item not found'; end if;
  if not public.fn_is_entity_member(auth.uid(), it.entity_id) then raise exception 'not a member of this house'; end if;
  select * into r from public.cleaning_runs where id = it.run_id;
  if r.status = 'signed' then raise exception 'run already signed'; end if;
  update public.cleaning_run_items set note = nullif(trim(p_note), '') where id = p_item returning * into it;
  if it.kind = 'corrective' and it.note is not null and not it.done then
    update public.cleaning_run_items
       set done = true, done_by = auth.uid(), done_by_name = public.fn_cleaning_actor_name(auth.uid(), it.entity_id), done_at = now()
     where id = p_item returning * into it;
    -- the action is also the corrective_action on the HACCP row
    update public.haccp_temperature_logs l set corrective_action = it.note
      from public.cleaning_run_items p where p.id = it.parent_item_id and l.id = p.temp_log_id;
  end if;
  return it;
end $$;

-- 6) seed temp lines -------------------------------------------------------------
create or replace function pg_temp._cl_temp(eq text, typ text, mn numeric, mx numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('label', eq, 'kind', 'temp', 'equipment', eq, 'equipment_type', typ, 'min_c', mn, 'max_c', mx);
$$;
create or replace function pg_temp._cl_prepend_temps(p_slug text, p_name text, p_temps jsonb, p_review text) returns void language plpgsql as $$
declare tid uuid; cur jsonb; merged jsonb; i int := 0; x jsonb;
begin
  select ct.id, ct.items into tid, cur from public.cleaning_templates ct join public.entities e on e.id = ct.entity_id where e.slug = p_slug and ct.name = p_name;
  if tid is null then return; end if;
  -- drop any previous temp lines, then prepend the new ones, renumbering
  merged := '[]'::jsonb;
  for x in select * from jsonb_array_elements(p_temps) loop i := i + 1; merged := merged || jsonb_build_array(x || jsonb_build_object('order', i)); end loop;
  for x in select * from jsonb_array_elements(cur) where value->>'kind' is distinct from 'temp' order by (value->>'order')::int loop i := i + 1; merged := merged || jsonb_build_array(x || jsonb_build_object('order', i)); end loop;
  update public.cleaning_templates set items = merged, metadata = metadata || jsonb_build_object('needs_boris_review', true, 'review', coalesce(metadata->>'review', '') || case when coalesce(metadata->>'review','') = '' then '' else ' · ' end || p_review), updated_at = now() where id = tid;
end $$;

-- BM: the four units that already have rows in haccp_temperature_logs (names and bands kept)
select pg_temp._cl_prepend_temps('bm', 'Cocina · Apertura 12:00',
  jsonb_build_array(pg_temp._cl_temp('Nevera cocina 1','fridge',2,6), pg_temp._cl_temp('Nevera pastelería','fridge',2,6), pg_temp._cl_temp('Nevera pescado','fridge',0,4), pg_temp._cl_temp('Congelador principal','freezer',-22,-18)),
  'fridge/freezer temperature lines taken from the old HACCP log — confirm the units and bands');
select pg_temp._cl_prepend_temps('bm', 'Cocina · Cierre 22:00',
  jsonb_build_array(pg_temp._cl_temp('Nevera cocina 1','fridge',2,6), pg_temp._cl_temp('Nevera pastelería','fridge',2,6), pg_temp._cl_temp('Nevera pescado','fridge',0,4), pg_temp._cl_temp('Congelador principal','freezer',-22,-18)),
  'closing temperature check added (twice daily is the usual APPCC rhythm) — drop it if once is your plan');

-- Taller: the printed fridge sheet (T2) — 8 units, bands are defaults
insert into public.cleaning_templates(entity_id, name, area, frequency, sort_order, items, metadata)
select e.id, 'Cocina · Apertura · Temperaturas', 'Cocina', 'opening', 5,
  jsonb_build_array(
    pg_temp._cl_temp('Cold','fridge',0,4) || '{"order":1}', pg_temp._cl_temp('Green','fridge',2,8) || '{"order":2}',
    pg_temp._cl_temp('Meat','fridge',0,4) || '{"order":3}', pg_temp._cl_temp('Fish','fridge',0,2) || '{"order":4}',
    pg_temp._cl_temp('Wine 1','fridge',10,16) || '{"order":5}', pg_temp._cl_temp('Wine 2','fridge',10,16) || '{"order":6}',
    pg_temp._cl_temp('Wine 3','fridge',10,16) || '{"order":7}', pg_temp._cl_temp('Water','fridge',2,8) || '{"order":8}'),
  '{"source":"Taller_Task_Lists_STAGING.md T2 fridge temperature checks (8 units, daily open, sign-off)","needs_boris_review":true,"review":"the 8 units are from the sheet; the °C bands are defaults — set the real ones"}'::jsonb
from public.entities e where e.slug = 'taller'
  and not exists (select 1 from public.cleaning_templates ct where ct.entity_id = e.id and ct.name = 'Cocina · Apertura · Temperaturas');

-- 7) today's runs were made before the temp lines existed and nobody has
-- ticked yet (Boris walks it tomorrow): rebuild today so the lines show.
delete from public.cleaning_runs r where r.service_date = (now() at time zone 'Europe/Madrid')::date
  and not exists (select 1 from public.cleaning_run_items i where i.run_id = r.id and i.done);
select public.fn_cleaning_materialise();
