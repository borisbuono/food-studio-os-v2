-- calendar: _schema — unified OS calendar overlay (2026-09-21)
-- One `events` row per source row (shift, booking, interview, task, social,
-- sales_event, prep, haccp, commercial) plus first-class meeting/external rows.
-- Source tables stay authoritative; events is a read-optimised overlay kept in
-- step by refresh_events_from_<source>() (see calendar_events_sync).

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities(id) on delete cascade,
  source_type text not null check (source_type in
    ('shift','booking','interview','task','social','sales_event','meeting','prep','haccp','commercial','external')),
  source_id uuid,
  title text not null,
  description text,
  start_ts timestamptz not null,
  end_ts timestamptz,
  all_day boolean not null default false,
  timezone text,
  colour text,
  location text,
  person_ids uuid[] not null default '{}',
  external_ref text,
  status text,
  meta jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_source_unique unique (source_type, source_id),
  constraint events_end_after_start check (end_ts is null or end_ts >= start_ts)
);

create index if not exists events_entity_ts on public.events (entity_id, start_ts desc);
create index if not exists events_person on public.events using gin (person_ids);
create index if not exists events_source on public.events (source_type, source_id);
create index if not exists events_start on public.events (start_ts);
-- external rows are unique per (person, google id)
create unique index if not exists events_external_ref_uq on public.events (external_ref) where external_ref is not null;

create or replace function public.events_touch_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.events_touch_updated_at();

-- team_members.id(s) of the signed-in user. Definer so the events policy does
-- not recurse through team_members' own policy.
create or replace function public.app_my_person_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select tm.id from public.team_members tm where tm.auth_user_id = auth.uid();
$$;
revoke all on function public.app_my_person_ids() from public, anon;
grant execute on function public.app_my_person_ids() to authenticated;

alter table public.events enable row level security;

-- READ: venue members see venue rows; meetings/external only by explicit person_ids.
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated using (
  (source_type not in ('meeting','external')
     and entity_id in (select public.current_person_entities()))
  or person_ids && array(select public.app_my_person_ids())
  or created_by = auth.uid()
);

-- WRITE: managers of the entity; a person may also write their own meetings.
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated with check (
  entity_id in (select public.app_my_managed_entities())
  or (source_type = 'meeting' and created_by = auth.uid()
      and (entity_id is null or entity_id in (select public.current_person_entities())))
);
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (entity_id in (select public.app_my_managed_entities())
         or (source_type = 'meeting' and created_by = auth.uid()))
  with check (entity_id in (select public.app_my_managed_entities())
         or (source_type = 'meeting' and created_by = auth.uid()));
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
  using (entity_id in (select public.app_my_managed_entities())
         or (source_type = 'meeting' and created_by = auth.uid()));

revoke all on public.events from anon;
revoke truncate on public.events from authenticated;
grant select, insert, update, delete on public.events to authenticated;
