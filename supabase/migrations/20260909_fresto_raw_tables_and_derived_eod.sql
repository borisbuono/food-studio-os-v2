-- Fresto raw tables + derived eod_pos columns.
--
-- Boris walk 2026-08-31 (audit) → shipped 2026-09-09.
--
-- Two changes in one migration:
--
-- 1) Nine raw ingest tables land whole Fresto API responses (`raw jsonb`
--    + `pulled_at`) so we can re-derive any column without re-hitting the
--    live API. Every day of every venue keeps its full body; masters carry
--    one row per entity/fresto_id and refresh on each pull.
--
-- 2) `eod_pos` grows the derived slots the Studio card and the finance
--    reports actually read — hourly split, payment mix, salepoint / product
--    group split, guests_daily + booked + walkin, peak hour, avg-spend,
--    turnover ratio. These are computable from orderlines + z-reports +
--    bookings/daily and get written by the same nightly cron.
--
-- Sizing: BM's busiest days have ~250 orderlines; a full year is ~90k rows
-- per venue and comfortably indexed on (entity_code, business_date). Master
-- tables are tiny.
--
-- IMPORTANT — businessDate shifted server-side on 2026-09-07
-- (see memory: fresto_businessdate_field_fixed_2026-09-07). Post-fix labels
-- are truth. Pre-fix cached NI dumps were one day early — the writer applies
-- the offset via `resolveTradingDate(pulledAt, businessDateLabel)` in
-- lib/integrations/pos/fresto.ts before mapping raw rows to trading dates.

-- ============================================================================
-- 1) Raw ingest tables
-- ============================================================================

-- Every raw table shares:
--   id           uuid pk
--   entity_code  'BM' | 'IFL' | 'BBH'
--   fresto_id    the id in the payload (line id / order id / z id / etc.)
--   business_date date (where applicable — null for masters)
--   raw          jsonb — the full response body for the row
--   pulled_at    timestamptz — when we fetched it (drives the offset helper)
--   trading_date date (where applicable) — the businessDate after offset fix
--
-- Uniqueness is (entity_code, business_date, fresto_id) for daily tables and
-- (entity_code, fresto_id) for masters, so an idempotent re-import upserts.

create table if not exists public.fresto_orders_raw (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  fresto_id text not null,
  business_date date,          -- as Fresto reported it (post-fix = truth)
  trading_date date,           -- offset-corrected (pre-09-07 dumps only)
  table_id text,
  order_slug text,
  cancelled boolean default false,
  revenue_eur numeric,
  quantity_items numeric,
  raw jsonb not null,
  pulled_at timestamptz not null default now(),
  unique (entity_code, business_date, fresto_id)
);
create index if not exists idx_fresto_orders_raw_entity_date
  on public.fresto_orders_raw(entity_code, trading_date);
create index if not exists idx_fresto_orders_raw_entity_bdate
  on public.fresto_orders_raw(entity_code, business_date);

create table if not exists public.fresto_orderlines_raw (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  fresto_id text not null,          -- orderline.id
  order_id text,
  business_date date,
  trading_date date,
  is_revenue boolean default true,
  cancelled boolean default false,
  price_eur numeric,                -- already extended (never × qty)
  quantity numeric,
  vat_pct numeric,
  product_id text,
  product_group_id text,
  sale_point_id text,
  user_id text,                     -- waiter
  raw jsonb not null,
  pulled_at timestamptz not null default now(),
  -- Per fresto_orderlines_1000_cap: dedup on (id, orderID), never id alone.
  unique (entity_code, business_date, fresto_id, order_id)
);
create index if not exists idx_fresto_orderlines_raw_entity_date
  on public.fresto_orderlines_raw(entity_code, trading_date);
create index if not exists idx_fresto_orderlines_raw_entity_bdate
  on public.fresto_orderlines_raw(entity_code, business_date);
create index if not exists idx_fresto_orderlines_raw_order
  on public.fresto_orderlines_raw(order_id);

create table if not exists public.fresto_z_reports_raw (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  fresto_id text not null,          -- z-report id
  from_date timestamptz,
  to_date timestamptz,
  business_date date,               -- inferred: from_date::date (Madrid)
  trading_date date,
  spans_days boolean default false, -- from.date != to.date
  revenue_eur numeric,
  cash_revenue_eur numeric,
  cards_total_eur numeric,
  online_cards_total_eur numeric,
  tips_eur numeric,
  vat_amount_eur numeric,
  quantity numeric,
  raw jsonb not null,
  pulled_at timestamptz not null default now(),
  unique (entity_code, fresto_id)
);
create index if not exists idx_fresto_z_reports_raw_entity_date
  on public.fresto_z_reports_raw(entity_code, trading_date);

create table if not exists public.fresto_bookings_raw (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  fresto_id text not null,          -- booking id
  business_date date,
  trading_date date,
  guests int,
  status text,                      -- 'approved' | 'closed' | 'cancelled' | ...
  booking_ts timestamptz,           -- start
  table_id text,
  raw jsonb not null,
  pulled_at timestamptz not null default now(),
  unique (entity_code, fresto_id)
);
create index if not exists idx_fresto_bookings_raw_entity_date
  on public.fresto_bookings_raw(entity_code, trading_date);

create table if not exists public.fresto_bookings_daily_raw (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  business_date date not null,
  trading_date date,
  guests_daily int,                 -- physical people that walked in that day
  guests_booked int,                -- sum(bookings.guests) accepted/closed
  guests_walkins int,               -- daily - booked
  raw jsonb not null,
  pulled_at timestamptz not null default now(),
  unique (entity_code, business_date)
);
create index if not exists idx_fresto_bookings_daily_raw_entity_date
  on public.fresto_bookings_daily_raw(entity_code, trading_date);

create table if not exists public.fresto_salepoints_kpi_raw (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  business_date date not null,
  trading_date date,
  sale_point_id text not null,
  sale_point_name text,
  revenue_eur numeric,
  orders int,
  items int,
  raw jsonb not null,
  pulled_at timestamptz not null default now(),
  unique (entity_code, business_date, sale_point_id)
);
create index if not exists idx_fresto_salepoints_kpi_raw_entity_date
  on public.fresto_salepoints_kpi_raw(entity_code, trading_date);

create table if not exists public.fresto_tables_master (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  fresto_id text not null,
  name text,
  capacity int,
  sale_point_id text,
  raw jsonb not null,
  pulled_at timestamptz not null default now(),
  unique (entity_code, fresto_id)
);

create table if not exists public.fresto_staff_master (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  fresto_id text not null,          -- staff / user id
  name text,
  role text,
  active boolean,
  raw jsonb not null,
  pulled_at timestamptz not null default now(),
  unique (entity_code, fresto_id)
);

create table if not exists public.fresto_menu_products_master (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  fresto_id text not null,
  name text,
  product_group_id text,
  price_eur numeric,
  cost_eur numeric,
  vat_pct numeric,
  accounting_code text,
  active boolean,
  raw jsonb not null,
  pulled_at timestamptz not null default now(),
  unique (entity_code, fresto_id)
);

create table if not exists public.fresto_menu_groups_master (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  fresto_id text not null,
  name text,
  parent_group_id text,
  raw jsonb not null,
  pulled_at timestamptz not null default now(),
  unique (entity_code, fresto_id)
);

-- RLS: authenticated read (nothing sensitive; service-role writes via cron)
do $$
declare t text;
begin
  for t in select unnest(array[
    'fresto_orders_raw','fresto_orderlines_raw','fresto_z_reports_raw',
    'fresto_bookings_raw','fresto_bookings_daily_raw','fresto_salepoints_kpi_raw',
    'fresto_tables_master','fresto_staff_master',
    'fresto_menu_products_master','fresto_menu_groups_master'
  ]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- 2) Derived eod_pos columns
-- ============================================================================
--
-- The columns already present from the 08-31 split (tickets, orders_count,
-- tables_count, guests, guests_source, guests_keyed_*, z_spans_days) stay.
-- Everything below is the 09-09 additive shape.

alter table public.eod_pos
  add column if not exists distinct_waiters int,
  add column if not exists guests_daily int,      -- from bookings/daily.guests, walk-ins included
  add column if not exists guests_booked int,     -- SUM(bookings.guests) accepted/closed
  add column if not exists guests_walkins int,    -- daily - booked
  add column if not exists avg_spend_per_guest numeric,
  add column if not exists avg_ticket_size numeric,
  add column if not exists hourly_revenue jsonb,  -- {"07":59.00,...,"22":189.00}
  add column if not exists hourly_orders jsonb,
  add column if not exists hourly_covers jsonb,   -- from bookings that touch each hour
  add column if not exists payment_mix jsonb,     -- {"Cash":484,"Offline":1943,"OnlineCard":0}
  add column if not exists salepoint_mix jsonb,
  add column if not exists productgroup_mix jsonb,
  add column if not exists turnover_ratio numeric,
  add column if not exists peak_hour text,
  add column if not exists peak_hour_revenue numeric;

comment on column public.eod_pos.guests_daily        is 'From bookings/daily.guests — walk-ins INCLUDED. Preferred over eod_pos.guests when non-null.';
comment on column public.eod_pos.hourly_revenue      is 'Revenue per opening hour, keyed by "HH" (Madrid). Derived from orderlines.timeslot.';
comment on column public.eod_pos.payment_mix         is 'Amounts per payment method from z-report totals. Keys: Cash, Cards, OnlineCards, Offline, Tips.';
comment on column public.eod_pos.peak_hour           is 'HH of the peak revenue hour (Madrid).';
comment on column public.eod_pos.turnover_ratio      is 'Tables turned = orders_count / tables_count (when both present).';
