-- 20261002_cleaning_s1_templates_runs.sql
-- Cleaning S1 — templates + daily list (Boris authorised 2026-10-02, cruise mode).
--
-- What Sanidad (APPCC) needs and nothing more: a daily record that each
-- cleaning task was done, by whom, when, with a responsible person's sign-off,
-- kept and exportable. The printed sheets (Bistro_Mondo_FOH_Checklists.pdf,
-- Bistro_Mondo_Task_Lists_STAGING.md, Taller_Task_Lists_STAGING.md) become
-- cleaning_templates; every day the active templates become cleaning_runs
-- with one cleaning_run_items row per line.
--
-- Rules carried into the DB:
--   * ticks and sign-offs go through definer RPCs so done_by / signed_by is
--     ALWAYS the caller (auth.uid()) and the name is snapshotted — the record
--     Sanidad wants, readable even after the person leaves the team;
--   * nothing auto-ticks; a materialised run starts with every item open;
--   * no DELETE for authenticated on runs/items — kept 2 years minimum;
--   * staff names live here, never in observations (Foundation §5.5).
--
-- Reuse, not duplicate: haccp_temperature_logs is wired in S2 (temp items).

-- 1) templates --------------------------------------------------------------
create table if not exists public.cleaning_templates (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.entities(id) on delete cascade,
  name        text not null,
  area        text,                                  -- Cocina · Pica · Sala · Bar · Baños …
  frequency   text not null check (frequency in ('daily','weekly','monthly','opening','closing')),
  weekday     smallint check (weekday between 1 and 7),   -- ISO: 1 = Monday … 7 = Sunday (weekly only)
  items       jsonb not null default '[]'::jsonb,   -- [{label, order, kind?: 'task'|'temp', equipment?, equipment_type?, min_c?, max_c?}]
  active      boolean not null default true,
  sort_order  int not null default 100,
  metadata    jsonb not null default '{}'::jsonb,   -- {source, needs_boris_review, …}
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);
create index if not exists cleaning_templates_entity on public.cleaning_templates(entity_id, active);
alter table public.cleaning_templates enable row level security;
drop policy if exists cleaning_templates_select on public.cleaning_templates;
create policy cleaning_templates_select on public.cleaning_templates for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));
drop policy if exists cleaning_templates_write on public.cleaning_templates;
create policy cleaning_templates_write on public.cleaning_templates for all to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id))
  with check (public.fn_is_entity_manager(auth.uid(), entity_id));

-- 2) runs -------------------------------------------------------------------
create table if not exists public.cleaning_runs (
  id             uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references public.entities(id) on delete cascade,
  template_id    uuid references public.cleaning_templates(id) on delete set null,
  template_name  text not null,                     -- snapshot: the record outlives template edits
  area           text,
  service_date   date not null,
  shift          text not null check (shift in ('opening','closing','daily','weekly','monthly')),
  status         text not null default 'open' check (status in ('open','signed')),
  signed_by      uuid references auth.users(id),
  signed_by_name text,
  signed_at      timestamptz,
  created_at     timestamptz not null default now()
);
create unique index if not exists cleaning_runs_one_per_day on public.cleaning_runs(template_id, service_date) where template_id is not null;
create index if not exists cleaning_runs_entity_date on public.cleaning_runs(entity_id, service_date desc);
alter table public.cleaning_runs enable row level security;
drop policy if exists cleaning_runs_select on public.cleaning_runs;
create policy cleaning_runs_select on public.cleaning_runs for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));
-- no insert/update/delete policies: writes go through the RPCs below.
revoke delete on public.cleaning_runs from authenticated, anon;

-- 3) run items --------------------------------------------------------------
create table if not exists public.cleaning_run_items (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.cleaning_runs(id) on delete cascade,
  entity_id    uuid not null references public.entities(id) on delete cascade,
  label        text not null,
  sort_order   int not null default 0,
  kind         text not null default 'task' check (kind in ('task','temp','corrective')),
  done         boolean not null default false,
  done_by      uuid references auth.users(id),
  done_by_name text,
  done_at      timestamptz,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists cleaning_run_items_run on public.cleaning_run_items(run_id, sort_order);
create index if not exists cleaning_run_items_entity on public.cleaning_run_items(entity_id, done);
alter table public.cleaning_run_items enable row level security;
drop policy if exists cleaning_run_items_select on public.cleaning_run_items;
create policy cleaning_run_items_select on public.cleaning_run_items for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));
revoke delete on public.cleaning_run_items from authenticated, anon;

-- 4) who am I, by name (snapshot for the record) ---------------------------
create or replace function public.fn_cleaning_actor_name(p_uid uuid, p_entity uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select tm.name from public.team_members tm where tm.auth_user_id = p_uid and tm.name is not null and tm.name <> '' order by (tm.operator_entity_id = p_entity) desc nulls last limit 1),
    (select u.email from auth.users u where u.id = p_uid),
    p_uid::text);
$$;

-- 5) materialise today's runs from the active templates --------------------
-- Idempotent (unique template_id + service_date). p_date null = the venue's
-- local day from entities.timezone (derived once, here). p_entity null = all.
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
        insert into public.cleaning_run_items(run_id, entity_id, label, sort_order, kind)
        values (rid, e.id, coalesce(it->>'label', '—'), i, case when it->>'kind' = 'temp' then 'temp' else 'task' end);
      end loop;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.fn_cleaning_materialise(uuid, date) from public;
grant execute on function public.fn_cleaning_materialise(uuid, date) to authenticated, service_role;

-- 6) tick / untick ----------------------------------------------------------
-- Any member of the entity. done_by is the caller, always. Refused on a
-- signed run (the record is closed) — the manager re-opens by not signing.
create or replace function public.cleaning_tick(p_item uuid, p_done boolean default true, p_note text default null)
returns public.cleaning_run_items language plpgsql security definer set search_path = public, pg_temp as $$
declare it public.cleaning_run_items; r public.cleaning_runs;
begin
  select * into it from public.cleaning_run_items where id = p_item;
  if it.id is null then raise exception 'item not found'; end if;
  if not public.fn_is_entity_member(auth.uid(), it.entity_id) then raise exception 'not a member of this house'; end if;
  select * into r from public.cleaning_runs where id = it.run_id;
  if r.status = 'signed' then raise exception 'run already signed'; end if;
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
revoke all on function public.cleaning_tick(uuid, boolean, text) from public;
grant execute on function public.cleaning_tick(uuid, boolean, text) to authenticated;

-- note only (reason for an undone line, or the corrective action text in S2)
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
  return it;
end $$;
revoke all on function public.cleaning_note(uuid, text) from public;
grant execute on function public.cleaning_note(uuid, text) to authenticated;

-- 7) sign-off (managers) ----------------------------------------------------
-- The responsible person's signature. Allowed with open items — an honest
-- "14 of 16 done, signed by X" is the record; the UI shows the count first.
-- S2 adds the one hard block: an unanswered corrective action.
create or replace function public.cleaning_sign(p_run uuid)
returns public.cleaning_runs language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.cleaning_runs; n_corr int;
begin
  select * into r from public.cleaning_runs where id = p_run;
  if r.id is null then raise exception 'run not found'; end if;
  if not public.fn_is_entity_manager(auth.uid(), r.entity_id) then raise exception 'managers only'; end if;
  if r.status = 'signed' then return r; end if;
  select count(*) into n_corr from public.cleaning_run_items i where i.run_id = p_run and i.kind = 'corrective' and (i.note is null or not i.done);
  if n_corr > 0 then raise exception 'corrective action pending'; end if;
  update public.cleaning_runs
     set status = 'signed', signed_by = auth.uid(), signed_at = now(),
         signed_by_name = public.fn_cleaning_actor_name(auth.uid(), r.entity_id)
   where id = p_run returning * into r;
  return r;
end $$;
revoke all on function public.cleaning_sign(uuid) from public;
grant execute on function public.cleaning_sign(uuid) to authenticated;

-- 8) the daily job ----------------------------------------------------------
-- 04:50 UTC = 06:50 Madrid / 06:50 Amsterdam (after rota_forecast_nightly).
-- The page also calls fn_cleaning_materialise on open, so an early cook never
-- sees an empty day.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cleaning_materialise_daily';
    perform cron.schedule('cleaning_materialise_daily', '50 4 * * *', $job$select public.fn_cleaning_materialise()$job$);
  end if;
end $$;
