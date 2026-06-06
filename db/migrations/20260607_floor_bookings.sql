-- Day 6 schema: floor plan + bookings + integrations
-- Apply via Supabase MCP apply_migration (project rfdsysrdoncyoytcrzpg) or SQL editor.
-- Naming: physical tables prefixed to avoid SQL-keyword ambiguity; the plan called
-- the seating table "tables" — implemented as dining_tables (note for Boris).

create table if not exists floor_zones (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  name text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists dining_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  zone_id uuid references floor_zones(id) on delete set null,
  label text not null,
  seats int not null default 2,
  shape text not null default 'round',   -- round | square | rect
  x real not null default 0.5,           -- normalised 0..1 on the floor canvas
  y real not null default 0.5,
  w real not null default 0.08,
  h real not null default 0.08,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  guest_name text,
  party_size int not null default 2,
  service_date date not null default current_date,
  service_time time,
  table_id uuid references dining_tables(id) on delete set null,
  status text not null default 'booked',  -- booked | seated | done | cancelled | noshow
  source text default 'manual',           -- manual | fresto | phone | walkin
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  provider text not null,                 -- fresto | ...
  status text not null default 'disconnected', -- disconnected | mock | connected | error
  config jsonb not null default '{}',
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (restaurant_id, provider)
);

create index if not exists idx_dining_tables_rest on dining_tables(restaurant_id);
create index if not exists idx_floor_zones_rest on floor_zones(restaurant_id);
create index if not exists idx_bookings_rest_date on bookings(restaurant_id, service_date);

alter table floor_zones    enable row level security;
alter table dining_tables  enable row level security;
alter table bookings       enable row level security;
alter table integrations   enable row level security;

-- v0: authenticated full access (matches events/supplier-products write pattern).
-- Tighten to per-venue on Day 7 read-RLS lockdown.
do $$
declare t text;
begin
  foreach t in array array['floor_zones','dining_tables','bookings','integrations'] loop
    execute format('drop policy if exists %I_auth_all on %I', t, t);
    execute format('create policy %I_auth_all on %I for all to authenticated using (true) with check (true)', t, t);
    execute format('drop policy if exists %I_anon_read on %I', t, t);
    execute format('create policy %I_anon_read on %I for select to anon using (true)', t, t);
  end loop;
end $$;

-- Seed Utopia with two zones + a handful of tables so the editor opens populated.
insert into floor_zones (restaurant_id, name, sort) values
  ('a0000000-0000-4000-8000-000000000001','Terrace',0),
  ('a0000000-0000-4000-8000-000000000001','Dining room',1)
on conflict do nothing;
