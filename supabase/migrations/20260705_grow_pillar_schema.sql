-- Grow pillar schema — Guest CRM + Commercials
-- Spec: 02_Build/decisions/grow_pillar_architecture_2026-07-04.md
-- Applies alongside existing bookings (db/migrations/20260607_floor_bookings.sql)
-- and the live sales_events table (defined outside this repo's migrations).

-- ---------- Guests (Grow · Relationships) ----------
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  name text not null,
  email text,
  phone text,
  allergies text,
  dietary text,
  birthday date,
  notes text,
  preferred_table uuid,                     -- FK to dining_tables when the app writes it
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  lifetime_value_eur numeric(12,2) not null default 0,
  source text not null default 'walk_in',   -- walk_in | booking | private_event | referral
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guests_source_check check (source in ('walk_in','booking','private_event','referral'))
);
create index if not exists idx_guests_rest       on public.guests(restaurant_id);
create index if not exists idx_guests_email      on public.guests(restaurant_id, email);
create index if not exists idx_guests_phone      on public.guests(restaurant_id, phone);
create index if not exists idx_guests_last_visit on public.guests(restaurant_id, last_visit_at desc);

alter table public.guests enable row level security;
do $$ begin
  create policy guests_auth_all on public.guests
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
-- Tightening to per-venue read comes with the Day-7 RLS lockdown; for now we match
-- bookings/floor_zones posture (authenticated all-access with anon read for /m guest surface).
do $$ begin
  create policy guests_anon_read on public.guests
    for select to anon using (true);
exception when duplicate_object then null; end $$;

-- ---------- Guest visits (Grow · Relationships → history) ----------
create table if not exists public.guest_visits (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  restaurant_id uuid not null,
  visit_date date not null default current_date,
  covers int not null default 1,
  spend_eur numeric(12,2) not null default 0,
  sales_event_id uuid,                       -- nullable FK — soft link to sales_events
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_guest_visits_guest on public.guest_visits(guest_id, visit_date desc);
create index if not exists idx_guest_visits_rest  on public.guest_visits(restaurant_id, visit_date desc);

alter table public.guest_visits enable row level security;
do $$ begin
  create policy guest_visits_auth_all on public.guest_visits
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ---------- Commercials (Grow · Commercials) ----------
create table if not exists public.commercials (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  type text not null,                        -- happy_hour | package | seasonal | wine_club | private_event_menu
  title text not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  rules jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercials_type_check check (type in ('happy_hour','package','seasonal','wine_club','private_event_menu'))
);
create index if not exists idx_commercials_rest_active on public.commercials(restaurant_id, active);
create index if not exists idx_commercials_window      on public.commercials(restaurant_id, starts_at, ends_at);

alter table public.commercials enable row level security;
do $$ begin
  create policy commercials_auth_all on public.commercials
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  -- Commercials publish to the /m guest menu — anon read needed for public offers.
  create policy commercials_anon_read on public.commercials
    for select to anon using (active = true);
exception when duplicate_object then null; end $$;

-- ---------- Commercial items (which menu items are in the offer, at what price) ----------
create table if not exists public.commercial_items (
  id uuid primary key default gen_random_uuid(),
  commercial_id uuid not null references public.commercials(id) on delete cascade,
  menu_item_id uuid not null,                -- soft ref; menu_items lives in the app schema
  price_override_eur numeric(12,2),          -- null = use menu price
  availability_override jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (commercial_id, menu_item_id)
);
create index if not exists idx_commercial_items_com on public.commercial_items(commercial_id);
create index if not exists idx_commercial_items_mi  on public.commercial_items(menu_item_id);

alter table public.commercial_items enable row level security;
do $$ begin
  create policy commercial_items_auth_all on public.commercial_items
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy commercial_items_anon_read on public.commercial_items
    for select to anon using (true);
exception when duplicate_object then null; end $$;

-- ---------- Extend bookings with guest_id (nullable FK) ----------
alter table public.bookings add column if not exists guest_id uuid;
do $$ begin
  alter table public.bookings
    add constraint bookings_guest_fk foreign key (guest_id) references public.guests(id) on delete set null;
exception when duplicate_object then null; when others then null; end $$;
create index if not exists idx_bookings_guest on public.bookings(guest_id);

-- ---------- Extend sales_events with primary_guest_id (nullable FK) ----------
-- sales_events lives outside this repo's migrations; guard with IF EXISTS.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'sales_events') then
    execute 'alter table public.sales_events add column if not exists primary_guest_id uuid';
    begin
      execute 'alter table public.sales_events add constraint sales_events_primary_guest_fk foreign key (primary_guest_id) references public.guests(id) on delete set null';
    exception when duplicate_object then null; when others then null; end;
    execute 'create index if not exists idx_sales_events_primary_guest on public.sales_events(primary_guest_id)';
  end if;
end $$;

-- ---------- updated_at triggers (small, reusable) ----------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
do $$ begin
  create trigger guests_updated_at before update on public.guests
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger commercials_updated_at before update on public.commercials
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
