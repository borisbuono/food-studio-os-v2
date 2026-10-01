-- 20261001_rota_s6_swaps.sql
-- Rota S6 — shift swaps (Boris's ruling A, 2026-10-01).
--
-- A person offers one of their PUBLISHED, future shifts. A colleague on the
-- same house with the same eligibility (same area, or same role) takes it.
-- A manager ticks. Only then does rota_shifts.person_id move; the row trigger
-- re-prices the shift, the events trigger re-syncs the calendar (both people's
-- /me/today), and any undecided settlement for the shift is dropped so it is
-- re-settled against the new person. No swap without the tick. Every step is
-- a row in shift_swap_log.
--
-- RLS: a person sees swaps they are part of plus open offers on their houses
-- (to take one); managers see everything on their entity. Writes only via RPCs.
-- Nothing here writes to observations (Foundation §5).

create table if not exists public.shift_swaps (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.entities(id) on delete cascade,
  shift_id      uuid not null references public.rota_shifts(id) on delete cascade,
  from_person   uuid not null references public.team_members(id) on delete cascade,
  to_person     uuid references public.team_members(id) on delete set null,
  status        text not null default 'offered' check (status in ('offered','claimed','approved','rejected','cancelled')),
  note          text,
  offered_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  decided_at    timestamptz,
  decided_by    uuid references auth.users(id),
  decision_note text,
  created_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now()
);
create unique index if not exists shift_swaps_one_open on public.shift_swaps(shift_id) where status in ('offered','claimed');
create index if not exists shift_swaps_entity_status on public.shift_swaps(entity_id, status);
create index if not exists shift_swaps_people on public.shift_swaps(from_person, to_person);
alter table public.shift_swaps enable row level security;
drop policy if exists shift_swaps_select on public.shift_swaps;
create policy shift_swaps_select on public.shift_swaps for select to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id)
         or from_person in (select public.app_my_person_ids())
         or to_person in (select public.app_my_person_ids())
         or (status = 'offered' and public.fn_is_entity_member(auth.uid(), entity_id)));
-- no insert/update policy: writes go through the definer RPCs below

create table if not exists public.shift_swap_log (
  id        bigserial primary key,
  swap_id   uuid not null references public.shift_swaps(id) on delete cascade,
  action    text not null,                 -- offered | claimed | unclaimed | approved | rejected | cancelled
  actor     uuid,                          -- auth.users.id
  person_id uuid,                          -- team_members.id of the actor when known
  detail    jsonb not null default '{}'::jsonb,
  at        timestamptz not null default now()
);
create index if not exists shift_swap_log_swap on public.shift_swap_log(swap_id, at);
alter table public.shift_swap_log enable row level security;
drop policy if exists shift_swap_log_select on public.shift_swap_log;
create policy shift_swap_log_select on public.shift_swap_log for select to authenticated
  using (exists (select 1 from public.shift_swaps s where s.id = swap_id));   -- same visibility as the swap row

create or replace function public._swap_log(p_swap uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.shift_swap_log (swap_id, action, actor, person_id, detail)
  values (p_swap, p_action, auth.uid(), (select tm.id from public.team_members tm where tm.auth_user_id = auth.uid() limit 1), coalesce(p_detail, '{}'::jsonb));
$$;

-- helper: the shift's start as an instant
create or replace function public._rota_shift_start(p_shift uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select (rs.service_date::text || ' ' || rs.start_time::text)::timestamp at time zone coalesce(e.timezone, 'Europe/Madrid')
    from public.rota_shifts rs join public.entities e on e.id = rs.entity_id where rs.id = p_shift;
$$;

-- 1) offer ---------------------------------------------------------------------
create or replace function public.fn_swap_offer(p_shift uuid, p_note text default null)
returns public.shift_swaps language plpgsql security definer set search_path = public, pg_temp as $$
declare rs public.rota_shifts; sw public.shift_swaps; mine boolean; mgr boolean;
begin
  select * into rs from public.rota_shifts where id = p_shift;
  if rs.id is null then raise exception 'shift not found'; end if;
  mine := rs.person_id in (select public.app_my_person_ids());
  mgr  := public.fn_is_entity_manager(auth.uid(), rs.entity_id);
  if not (mine or mgr) then raise exception 'only the person on the shift (or a manager) can offer it'; end if;
  if rs.status <> 'published' then raise exception 'only a published shift can be offered'; end if;
  if public._rota_shift_start(p_shift) <= now() then raise exception 'the shift has already started'; end if;
  if exists (select 1 from public.shift_swaps x where x.shift_id = p_shift and x.status in ('offered','claimed')) then raise exception 'this shift is already offered'; end if;
  insert into public.shift_swaps (entity_id, shift_id, from_person, status, note, created_by)
  values (rs.entity_id, rs.id, rs.person_id, 'offered', nullif(left(coalesce(p_note, ''), 200), ''), auth.uid()) returning * into sw;
  perform public._swap_log(sw.id, 'offered', jsonb_build_object('by_manager', mgr and not mine));
  return sw;
end $$;

-- 2) take it (claim) -------------------------------------------------------------
-- Eligibility: active member of the entity, not the offerer, same area as the
-- shift or same role as the shift, and no overlapping shift of their own that
-- day. A claim replaces nothing: the manager still decides.
create or replace function public.fn_swap_claim(p_swap uuid)
returns public.shift_swaps language plpgsql security definer set search_path = public, pg_temp as $$
declare sw public.shift_swaps; rs public.rota_shifts; me uuid; my_role text; my_area text; ok boolean := false;
begin
  select * into sw from public.shift_swaps where id = p_swap;
  if sw.id is null then raise exception 'swap not found'; end if;
  if sw.status <> 'offered' then raise exception 'this shift is no longer open'; end if;
  select * into rs from public.rota_shifts where id = sw.shift_id;
  if public._rota_shift_start(rs.id) <= now() then raise exception 'the shift has already started'; end if;
  select tm.id into me from public.team_members tm join public.memberships m on m.person_id = tm.id and m.entity_id = sw.entity_id and m.status = 'active'
   where tm.auth_user_id = auth.uid() limit 1;
  if me is null then raise exception 'you are not on this team'; end if;
  if me = sw.from_person then raise exception 'you cannot take your own shift'; end if;
  select lower(coalesce(m.role, tm.default_role, '')), lower(coalesce(m.area, tm.default_area, '')) into my_role, my_area
    from public.memberships m join public.team_members tm on tm.id = m.person_id where m.person_id = me and m.entity_id = sw.entity_id limit 1;
  -- same area, or same role; a manager-set role on the shift wins over the area guess
  ok := (my_area <> '' and my_area = rs.area)
     or (rs.role is not null and my_role <> '' and my_role = lower(rs.role))
     or (my_area = '' and rs.role is null);     -- nothing to compare on: let the manager judge
  if not ok then raise exception 'this shift needs % — your role is %', coalesce(rs.role, upper(rs.area)), coalesce(nullif(my_role, ''), 'not set'); end if;
  if exists (select 1 from public.rota_shifts x where x.person_id = me and x.service_date = rs.service_date and x.status <> 'cancelled' and x.entity_id = rs.entity_id
               and x.start_time < rs.end_time and x.end_time > rs.start_time) then
    raise exception 'you already work that service';
  end if;
  update public.shift_swaps set to_person = me, status = 'claimed', claimed_at = now(), updated_at = now() where id = sw.id returning * into sw;
  perform public._swap_log(sw.id, 'claimed', jsonb_build_object('to_person', me));
  return sw;
end $$;

-- a claimer can step back while the manager has not decided
create or replace function public.fn_swap_unclaim(p_swap uuid)
returns public.shift_swaps language plpgsql security definer set search_path = public, pg_temp as $$
declare sw public.shift_swaps;
begin
  select * into sw from public.shift_swaps where id = p_swap;
  if sw.id is null or sw.status <> 'claimed' then raise exception 'nothing to step back from'; end if;
  if not (sw.to_person in (select public.app_my_person_ids()) or public.fn_is_entity_manager(auth.uid(), sw.entity_id)) then raise exception 'not yours'; end if;
  update public.shift_swaps set to_person = null, status = 'offered', claimed_at = null, updated_at = now() where id = sw.id returning * into sw;
  perform public._swap_log(sw.id, 'unclaimed');
  return sw;
end $$;

-- 3) cancel an offer (the offerer or a manager) ---------------------------------
create or replace function public.fn_swap_cancel(p_swap uuid)
returns public.shift_swaps language plpgsql security definer set search_path = public, pg_temp as $$
declare sw public.shift_swaps;
begin
  select * into sw from public.shift_swaps where id = p_swap;
  if sw.id is null then raise exception 'swap not found'; end if;
  if sw.status not in ('offered','claimed') then raise exception 'already decided'; end if;
  if not (sw.from_person in (select public.app_my_person_ids()) or public.fn_is_entity_manager(auth.uid(), sw.entity_id)) then raise exception 'only the offerer or a manager can withdraw it'; end if;
  update public.shift_swaps set status = 'cancelled', decided_at = now(), decided_by = auth.uid(), updated_at = now() where id = sw.id returning * into sw;
  perform public._swap_log(sw.id, 'cancelled');
  return sw;
end $$;

-- 4) the tick: approve / reject --------------------------------------------------
create or replace function public.fn_swap_decide(p_swap uuid, p_approve boolean, p_note text default null)
returns public.shift_swaps language plpgsql security definer set search_path = public, pg_temp as $$
declare sw public.shift_swaps; rs public.rota_shifts; old_person uuid;
begin
  select * into sw from public.shift_swaps where id = p_swap for update;
  if sw.id is null then raise exception 'swap not found'; end if;
  if not public.fn_is_entity_manager(auth.uid(), sw.entity_id) then raise exception 'manager required'; end if;
  if sw.status <> 'claimed' then raise exception 'nobody has taken this shift yet'; end if;
  select * into rs from public.rota_shifts where id = sw.shift_id for update;
  if p_approve then
    if rs.status <> 'published' then raise exception 'the shift is no longer published'; end if;
    if rs.person_id <> sw.from_person then raise exception 'the shift changed hands since the offer'; end if;
    if exists (select 1 from public.shift_settlements ss where ss.rota_shift_id = rs.id and ss.decided_at is not null) then raise exception 'this shift is already settled and decided'; end if;
    old_person := rs.person_id;
    -- the move: person_id → row trigger re-prices (hourly_cost null → fn_person_rate for the new person); events trigger re-syncs the calendar
    update public.rota_shifts set person_id = sw.to_person, hourly_cost = null,
           notes = left(coalesce(notes || ' · ', '') || 'swap from ' || coalesce((select name from public.team_members where id = old_person), '—'), 300)
     where id = rs.id;
    -- an undecided settlement (e.g. an early no-show pass) belongs to the old person: drop it, the nightly settle re-creates it for the new one
    delete from public.shift_settlements where rota_shift_id = rs.id and decided_at is null;
    -- clock rows matched to this plan by the old person no longer belong to it
    update public.labor_shifts l set rota_shift_id = null where l.rota_shift_id = rs.id
       and l.user_id is distinct from (select auth_user_id from public.team_members where id = sw.to_person);
    update public.shift_swaps set status = 'approved', decided_at = now(), decided_by = auth.uid(), decision_note = nullif(left(coalesce(p_note, ''), 200), ''), updated_at = now() where id = sw.id returning * into sw;
    perform public._swap_log(sw.id, 'approved', jsonb_build_object('shift_id', rs.id, 'from', old_person, 'to', sw.to_person));
  else
    update public.shift_swaps set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = nullif(left(coalesce(p_note, ''), 200), ''), updated_at = now() where id = sw.id returning * into sw;
    perform public._swap_log(sw.id, 'rejected');
  end if;
  return sw;
end $$;

grant execute on function public.fn_swap_offer(uuid, text), public.fn_swap_claim(uuid), public.fn_swap_unclaim(uuid), public.fn_swap_cancel(uuid), public.fn_swap_decide(uuid, boolean, text) to authenticated;
revoke execute on function public._swap_log(uuid, text, jsonb), public._rota_shift_start(uuid) from public, anon, authenticated;
