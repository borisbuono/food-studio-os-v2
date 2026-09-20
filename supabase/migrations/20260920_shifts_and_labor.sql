-- 20260920_shifts_and_labor.sql
-- Runway D2 — clock-in/out module + labor tracking.
--
-- Two tables:
--   labor_shifts        → one row per shift (scheduled + actual clock-in/out)
--   labor_hourly_rates  → user's hourly rate, with effective-from history
--
-- Naming note: the shape the spec asks for is `public.shifts` +
-- `public.team_hourly_rates`, but `public.shifts` is already taken by the
-- legacy planner table (profile_id / zone_id / start_time / end_time)
-- used by /administrate/team/schedule and /execute/pass. To avoid
-- clobbering live data we prefix with `labor_` — the routes, UI and API
-- contracts still use the "shift" concept. Rename can happen once the
-- legacy planner is deprecated.
--
-- RLS: authenticated members of an entity can read both tables for that
-- entity. Anyone authenticated may insert their own clock-in / clock-out
-- against a shift row (kiosk tap). Setting/updating rates requires a
-- manager/owner membership on the entity.

-- 1) labor_shifts ----------------------------------------------------------
create table if not exists public.labor_shifts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text,
  station text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  clock_in timestamptz,
  clock_in_by uuid references auth.users(id),
  clock_out timestamptz,
  clock_out_by uuid references auth.users(id),
  break_minutes int default 0,
  hourly_rate_eur numeric,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists labor_shifts_entity_date
  on public.labor_shifts(entity_id, ((scheduled_start at time zone 'Europe/Amsterdam')::date) desc);
create index if not exists labor_shifts_user_date
  on public.labor_shifts(user_id, ((clock_in at time zone 'Europe/Amsterdam')::date) desc);
create index if not exists labor_shifts_open
  on public.labor_shifts(entity_id, clock_out) where clock_out is null;

alter table public.labor_shifts enable row level security;

-- Helper: is `uid` an active member (any role) of `ent`?
create or replace function public.fn_is_entity_member(uid uuid, ent uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.team_members tm
      join public.memberships   m on m.person_id = tm.id
     where tm.auth_user_id = uid
       and m.entity_id     = ent
       and m.status        = 'active'
  );
$$;

-- Helper: is `uid` a manager/owner on `ent`?
create or replace function public.fn_is_entity_manager(uid uuid, ent uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.team_members tm
      join public.memberships   m on m.person_id = tm.id
     where tm.auth_user_id = uid
       and m.entity_id     = ent
       and m.status        = 'active'
       and lower(coalesce(m.role, '')) in ('owner','manager','gm','admin','director','operator')
  );
$$;

drop policy if exists labor_shifts_select on public.labor_shifts;
create policy labor_shifts_select on public.labor_shifts
  for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));

drop policy if exists labor_shifts_insert on public.labor_shifts;
create policy labor_shifts_insert on public.labor_shifts
  for insert to authenticated
  with check (
    public.fn_is_entity_member(auth.uid(), entity_id)
    and (
      user_id = auth.uid()
      or public.fn_is_entity_manager(auth.uid(), entity_id)
    )
  );

drop policy if exists labor_shifts_update on public.labor_shifts;
create policy labor_shifts_update on public.labor_shifts
  for update to authenticated
  using (
    public.fn_is_entity_member(auth.uid(), entity_id)
    and (
      user_id = auth.uid()
      or public.fn_is_entity_manager(auth.uid(), entity_id)
    )
  );

drop policy if exists labor_shifts_delete on public.labor_shifts;
create policy labor_shifts_delete on public.labor_shifts
  for delete to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id));

create or replace function public.fn_labor_shifts_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists labor_shifts_touch_updated_at on public.labor_shifts;
create trigger labor_shifts_touch_updated_at
  before update on public.labor_shifts
  for each row execute function public.fn_labor_shifts_touch_updated_at();

-- 2) labor_hourly_rates ----------------------------------------------------
create table if not exists public.labor_hourly_rates (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text,
  hourly_rate_eur numeric not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz default now(),
  unique(entity_id, user_id, effective_from)
);

create index if not exists labor_hourly_rates_lookup
  on public.labor_hourly_rates(entity_id, user_id, effective_from desc);

alter table public.labor_hourly_rates enable row level security;

drop policy if exists labor_hourly_rates_select on public.labor_hourly_rates;
create policy labor_hourly_rates_select on public.labor_hourly_rates
  for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));

drop policy if exists labor_hourly_rates_insert on public.labor_hourly_rates;
create policy labor_hourly_rates_insert on public.labor_hourly_rates
  for insert to authenticated
  with check (public.fn_is_entity_manager(auth.uid(), entity_id));

drop policy if exists labor_hourly_rates_update on public.labor_hourly_rates;
create policy labor_hourly_rates_update on public.labor_hourly_rates
  for update to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id));

drop policy if exists labor_hourly_rates_delete on public.labor_hourly_rates;
create policy labor_hourly_rates_delete on public.labor_hourly_rates
  for delete to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id));
