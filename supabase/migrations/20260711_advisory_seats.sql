-- Advisory Sprint #1 — entity/venue/seat model with strict RLS isolation.
--
-- Productises the advisory-client path for Food Studios OS. Boris advises
-- external groups (Santa Gertrudis / Michael, Cala Boix / Ralf, Serena's
-- referrals). Each advisory client is a separate universe: their own venues,
-- their own team seats, their own Assistant Layer voice + memory. Cross-
-- client isolation is the moat — RLS gates every read.
--
-- Sits alongside the pre-existing assistant_advisory_clients (from the
-- Sprint 6 onboarding wizard) but is richer: this is the productised
-- entity, with a status funnel, an advisor of record, and a venue/seat
-- graph. The two are joined 1:1 by entity_code.
--
-- Additive. Nothing here touches IFL/BM/BBH data.

-- =========================================================================
-- 1. advisory_clients — one row per external group Boris advises.
-- =========================================================================
create table if not exists advisory_clients (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null unique check (entity_code like 'ADV-%'),

  -- The identity of the client
  name text not null,                             -- "Santa Gertrudis Group", "Cala Boix"
  fiscal_name text,                               -- legal SL name if incorporated
  cif text,                                       -- Spanish tax ID (nullable — pre-incorporation is normal)

  -- The relationship
  contact_email text,
  contact_phone text,
  primary_advisor_user_id uuid references auth.users(id) on delete set null,

  -- The funnel — where in the journey are they
  status text not null default 'prospect'
    check (status in ('prospect','onboarding','active','paused','churned')),
  tier text not null default 'advisory'
    check (tier in ('advisory','pro','enterprise')),

  -- Book-keeping
  notes text,
  created_at   timestamptz not null default now(),
  activated_at timestamptz,
  paused_at    timestamptz,
  updated_at   timestamptz not null default now()
);

create index if not exists advisory_clients_status_idx  on advisory_clients (status, name);
create index if not exists advisory_clients_advisor_idx on advisory_clients (primary_advisor_user_id);

-- =========================================================================
-- 2. advisory_venues — venues that belong to an advisory client.
--    A single client can have multiple venues. Each venue binds to a
--    restaurant_id in the existing OS so all the surfaces work.
-- =========================================================================
create table if not exists advisory_venues (
  id uuid primary key default gen_random_uuid(),
  advisory_client_id uuid not null references advisory_clients(id) on delete cascade,

  name text not null,                             -- "Bistrot du Monde", "Cala Boix Cliff"
  brand text,
  restaurant_id uuid unique,                      -- link into the OS restaurant graph
  city text,
  country text default 'Spain',

  operational_since date,
  opens_at date,
  seats int,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists advisory_venues_client_idx on advisory_venues (advisory_client_id);

-- =========================================================================
-- 3. advisory_seats — a user seat on an advisory client. This is the auth
--    join: only users with an accepted seat (or the primary advisor) can
--    read that client's data.
-- =========================================================================
create table if not exists advisory_seats (
  id uuid primary key default gen_random_uuid(),
  advisory_client_id uuid not null references advisory_clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,

  email text not null,
  role text not null default 'staff'
    check (role in ('owner','manager','staff','advisor_readonly')),

  invited_at   timestamptz not null default now(),
  invited_by   uuid references auth.users(id) on delete set null,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  invite_token text unique,

  unique (advisory_client_id, email)
);

create index if not exists advisory_seats_client_idx on advisory_seats (advisory_client_id) where revoked_at is null;
create index if not exists advisory_seats_user_idx   on advisory_seats (user_id) where revoked_at is null;
create index if not exists advisory_seats_token_idx  on advisory_seats (invite_token) where invite_token is not null;

-- =========================================================================
-- 4. Row-level security — the moat.
-- =========================================================================

alter table advisory_clients enable row level security;
alter table advisory_venues  enable row level security;
alter table advisory_seats   enable row level security;

drop policy if exists advisory_clients_read on advisory_clients;
create policy advisory_clients_read on advisory_clients
  for select to authenticated using (
    primary_advisor_user_id = auth.uid()
    or exists (
      select 1 from advisory_seats s
      where s.advisory_client_id = advisory_clients.id
        and s.user_id = auth.uid()
        and s.accepted_at is not null
        and s.revoked_at is null
    )
  );

drop policy if exists advisory_clients_write on advisory_clients;
create policy advisory_clients_write on advisory_clients
  for all to authenticated
  using (primary_advisor_user_id = auth.uid() or primary_advisor_user_id is null)
  with check (primary_advisor_user_id = auth.uid() or primary_advisor_user_id is null);

drop policy if exists advisory_venues_read on advisory_venues;
create policy advisory_venues_read on advisory_venues
  for select to authenticated using (
    exists (
      select 1 from advisory_clients c
      where c.id = advisory_venues.advisory_client_id
        and (
          c.primary_advisor_user_id = auth.uid()
          or exists (
            select 1 from advisory_seats s
            where s.advisory_client_id = c.id
              and s.user_id = auth.uid()
              and s.accepted_at is not null
              and s.revoked_at is null
          )
        )
    )
  );

drop policy if exists advisory_venues_write on advisory_venues;
create policy advisory_venues_write on advisory_venues
  for all to authenticated
  using (
    exists (
      select 1 from advisory_clients c
      where c.id = advisory_venues.advisory_client_id
        and c.primary_advisor_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from advisory_clients c
      where c.id = advisory_venues.advisory_client_id
        and c.primary_advisor_user_id = auth.uid()
    )
  );

drop policy if exists advisory_seats_read on advisory_seats;
create policy advisory_seats_read on advisory_seats
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from advisory_clients c
      where c.id = advisory_seats.advisory_client_id
        and c.primary_advisor_user_id = auth.uid()
    )
  );

drop policy if exists advisory_seats_write on advisory_seats;
create policy advisory_seats_write on advisory_seats
  for all to authenticated
  using (
    exists (
      select 1 from advisory_clients c
      where c.id = advisory_seats.advisory_client_id
        and c.primary_advisor_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from advisory_clients c
      where c.id = advisory_seats.advisory_client_id
        and c.primary_advisor_user_id = auth.uid()
    )
  );

-- =========================================================================
-- 5. Bridge — sync into assistant_advisory_clients (Sprint 6 registry).
-- =========================================================================

create or replace function _advisory_sync_assistant_registry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') then
    insert into assistant_advisory_clients (entity_code, name, owner_user_id, billing_tier, is_active)
    values (
      new.entity_code,
      new.name,
      new.primary_advisor_user_id,
      new.tier,
      new.status in ('onboarding','active')
    )
    on conflict (entity_code) do update
      set name          = excluded.name,
          owner_user_id = excluded.owner_user_id,
          billing_tier  = excluded.billing_tier,
          is_active     = excluded.is_active,
          updated_at    = now();
  end if;
  return new;
end $$;

drop trigger if exists advisory_sync_assistant_registry on advisory_clients;
create trigger advisory_sync_assistant_registry
  after insert or update on advisory_clients
  for each row execute function _advisory_sync_assistant_registry();

-- =========================================================================
-- 6. Convenience view — one row per client with counts.
-- =========================================================================
create or replace view v_advisory_clients_overview as
select
  c.id,
  c.entity_code,
  c.name,
  c.fiscal_name,
  c.status,
  c.tier,
  c.primary_advisor_user_id,
  c.contact_email,
  c.contact_phone,
  c.created_at,
  c.activated_at,
  (select count(*) from advisory_venues v where v.advisory_client_id = c.id)                                                          as venues_count,
  (select count(*) from advisory_seats  s where s.advisory_client_id = c.id and s.accepted_at is not null and s.revoked_at is null)   as accepted_seats,
  (select count(*) from advisory_seats  s where s.advisory_client_id = c.id and s.accepted_at is null    and s.revoked_at is null)    as pending_invites
from advisory_clients c;
