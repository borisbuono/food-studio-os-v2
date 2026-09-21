-- 2026-09-21 — Fresto per-centre income + cron heartbeat + menu master fields
--
-- WHY (walk 2026-09-21):
--   1) Task #25 "per-centre income" had no home. `fresto_salepoints_kpi_raw`
--      was fed from GET /sales/salepoints, which 404s on both tenants (probed
--      live 2026-09-21) — that is why it holds 16 BM rows and nothing for IFL.
--      Fresto's real salepoints are only NONE + ONLINE (system), so the
--      meaningful income centre is the PRODUCT GROUP (A35/A37 etc.), keyed on
--      ID (memory: fresto_product_groups_renamed_key_on_id), with salepoint as
--      a second dimension. Derived from orderlines, queryable on its own —
--      no eod_pos join needed.
--   2) The nightly Fresto sync had no provable heartbeat: assistant_actions
--      held zero pos_sync rows and eod_pos had not moved since 2026-09-13, so
--      "did it run?" could not be answered. cron_runs answers it.
--   3) fresto_menu_products_master was seeded with names only (1,366 rows,
--      every price/cost/vat/accounting column NULL) because the mapper read
--      p.name / p.price / p.vatPct / p.productAccountingCode, while the API
--      returns title / (no price at all) / reportingCodes.vatPct /
--      reportingCodes.productAccountingCode. Columns added here carry the
--      fields that DO exist; selling price is observed from orderlines in a
--      view, because the product master has no price field.
--
-- Applied to the live project 2026-09-21 via the Supabase MCP; this file is
-- the record of it.

create table if not exists public.fresto_income_centres_daily (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  business_date date not null,
  trading_date date,
  product_group_id text not null,
  product_group_name text,
  sale_point_id text not null default 'NONE',
  revenue_eur numeric not null default 0,
  items numeric not null default 0,
  orderlines_count integer not null default 0,
  orders_count integer,
  vat_eur numeric,
  pulled_at timestamptz not null default now()
);
create unique index if not exists fresto_income_centres_daily_key
  on public.fresto_income_centres_daily (entity_code, business_date, product_group_id, sale_point_id);
create index if not exists fresto_income_centres_daily_trading
  on public.fresto_income_centres_daily (entity_code, trading_date);
alter table public.fresto_income_centres_daily enable row level security;
drop policy if exists income_centres_service_all on public.fresto_income_centres_daily;
create policy income_centres_service_all on public.fresto_income_centres_daily for all to service_role using (true) with check (true);
drop policy if exists income_centres_auth_read on public.fresto_income_centres_daily;
create policy income_centres_auth_read on public.fresto_income_centres_daily for select to authenticated using (true);

create table if not exists public.fresto_salepoints_master (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  sale_point_id text not null,
  title text,
  active boolean,
  is_system boolean,
  raw jsonb,
  pulled_at timestamptz not null default now()
);
create unique index if not exists fresto_salepoints_master_key on public.fresto_salepoints_master (entity_code, sale_point_id);
alter table public.fresto_salepoints_master enable row level security;
drop policy if exists salepoints_master_service_all on public.fresto_salepoints_master;
create policy salepoints_master_service_all on public.fresto_salepoints_master for all to service_role using (true) with check (true);
drop policy if exists salepoints_master_auth_read on public.fresto_salepoints_master;
create policy salepoints_master_auth_read on public.fresto_salepoints_master for select to authenticated using (true);

-- Rollups bucket on trading_date (the basis BM August was tied on — memory:
-- bm_aug_revenue_tie_green_trading_basis), falling back to business_date.
create or replace view public.v_income_centre_daily as
select c.entity_code,
  coalesce(c.trading_date, c.business_date) as trading_date,
  c.business_date, c.product_group_id,
  coalesce(nullif(c.product_group_name, ''), g.name, c.product_group_id) as centre,
  c.sale_point_id, c.revenue_eur, c.items, c.orderlines_count, c.vat_eur, c.pulled_at
from public.fresto_income_centres_daily c
left join public.fresto_menu_groups_master g on g.entity_code = c.entity_code and g.fresto_id = c.product_group_id;

create or replace view public.v_income_centre_monthly as
select entity_code, date_trunc('month', trading_date)::date as month, centre, product_group_id,
  sum(revenue_eur) as revenue_eur, sum(items) as items, count(distinct trading_date) as trading_days
from public.v_income_centre_daily group by 1,2,3,4;

-- Fresto's /menu/products has no price field; orderlines carry an EXTENDED
-- price (memory: fresto_orderlines_price_is_extended), so unit = price / qty.
create or replace view public.v_menu_product_observed_price as
select ol.entity_code, ol.product_id as fresto_id, max(p.name) as name,
  round(avg(ol.price_eur / nullif(ol.quantity,0))::numeric, 2) as avg_unit_price_eur,
  (array_agg(round((ol.price_eur / nullif(ol.quantity,0))::numeric, 2) order by ol.business_date desc))[1] as last_unit_price_eur,
  max(ol.business_date) as last_sold_on, count(*) as lines_seen
from public.fresto_orderlines_raw ol
left join public.fresto_menu_products_master p on p.entity_code = ol.entity_code and p.fresto_id = ol.product_id
where ol.is_revenue and not ol.cancelled and coalesce(ol.quantity,0) <> 0
group by ol.entity_code, ol.product_id;

alter table public.fresto_menu_products_master
  add column if not exists is_bar boolean,
  add column if not exists vat_accounting_code text,
  add column if not exists system_product boolean;

create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  triggered_by text,
  detail jsonb,
  error text
);
create index if not exists cron_runs_job_started on public.cron_runs (job, started_at desc);
alter table public.cron_runs enable row level security;
drop policy if exists cron_runs_service_all on public.cron_runs;
create policy cron_runs_service_all on public.cron_runs for all to service_role using (true) with check (true);
drop policy if exists cron_runs_auth_read on public.cron_runs;
create policy cron_runs_auth_read on public.cron_runs for select to authenticated using (true);

-- The one-line answer to "is the cron alive?".
create or replace view public.v_cron_health as
select distinct on (job) job, started_at, finished_at, ok, triggered_by, error, (now() - started_at) as age
from public.cron_runs order by job, started_at desc;
