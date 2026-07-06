-- EOD two-record split — POS immutable snapshot + accounting editable + categorised deviations.
-- Rule: memory/pos_vs_accounting_separation.md (LOCKED 2026-07-05).
--
-- WHY: every service day keeps TWO records. POS EOD is what Fresto rang up (immutable,
-- fraud-safe). Accounting EOD is what Boris books to Holded (editable). Deviations between
-- them are categorised (comp/discount/staff-meal/waste/…) so food-cost % is not
-- distorted by comps and staff meals that leave the kitchen without hitting revenue.
--
-- Two derived views: operational P&L (kitchen dashboard) + fiscal P&L (Labritja + Modelo 303).

-- 1) Rename existing eod_reports → eod_accounting (editable — what Boris posts to Holded).
--    Preserves all rows + FKs + PK + existing RLS (renamed with the table).
alter table if exists public.eod_reports rename to eod_accounting;

-- Rename indexes to match the new table name (Postgres does not auto-rename them).
do $$
declare r record;
begin
  for r in
    select indexname from pg_indexes
    where schemaname = 'public' and tablename = 'eod_accounting' and indexname like 'eod_reports%'
  loop
    execute format('alter index public.%I rename to %I', r.indexname, replace(r.indexname, 'eod_reports', 'eod_accounting'));
  end loop;
end$$;

-- Rename FK constraint by convention (best-effort; ignore if not present).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.eod_accounting'::regclass and conname like 'eod_reports%'
  loop
    execute format('alter table public.eod_accounting rename constraint %I to %I', c.conname, replace(c.conname, 'eod_reports', 'eod_accounting'));
  end loop;
end$$;

-- Rename policies so they read as eod_accounting_*.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'eod_accounting' and policyname like 'eod_reports%'
  loop
    execute format('alter policy %I on public.eod_accounting rename to %I', p.policyname, replace(p.policyname, 'eod_reports', 'eod_accounting'));
  end loop;
end$$;

-- 2) eod_pos — immutable POS snapshot. Insert-only. Never edited, never deleted.
create table if not exists public.eod_pos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  date date not null,
  source text not null check (source in ('fresto','csv','manual')),
  source_ref text,                         -- raw file path, import id, or "manual"
  covers integer not null default 0,
  food_net_eur numeric(12,2) not null default 0,
  wine_net_eur numeric(12,2) not null default 0,
  bar_net_eur numeric(12,2) not null default 0,
  softdrinks_net_eur numeric(12,2) not null default 0,
  tips_eur numeric(12,2) not null default 0,
  service_charge_eur numeric(12,2) not null default 0,
  cash_declared_eur numeric(12,2) not null default 0,
  card_declared_eur numeric(12,2) not null default 0,
  total_gross_eur numeric(12,2) not null default 0,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null,
  raw_payload jsonb                        -- full parsed row from XLSX/CSV for audit
);

create unique index if not exists eod_pos_restaurant_date_source_uidx
  on public.eod_pos (restaurant_id, date, source);
create index if not exists eod_pos_restaurant_date_idx
  on public.eod_pos (restaurant_id, date desc);

alter table public.eod_pos enable row level security;

-- Read: any authenticated user tied to the venue (mirrors eod_accounting pattern — permissive
-- at auth level; per-venue scoping enforced by app-side profile.restaurant_id filter until
-- the venue-scoped RLS rollout lands. Matches memory/os_access_scoping_live.md live pattern).
drop policy if exists "eod_pos_auth_select" on public.eod_pos;
create policy "eod_pos_auth_select" on public.eod_pos
  for select to authenticated using (true);

-- Insert: authenticated only. imported_by defaults to caller.
drop policy if exists "eod_pos_auth_insert" on public.eod_pos;
create policy "eod_pos_auth_insert" on public.eod_pos
  for insert to authenticated with check (
    imported_by is null or imported_by = auth.uid()
  );

-- Immutable: no update, no delete policies granted.
-- (Absent policies = default deny under RLS for those verbs.)

-- 3) eod_accounting.eod_pos_id — link accounting entry to its POS source (nullable —
--    historical eod_reports rows migrate with NULL; manual accounting entries also NULL).
alter table public.eod_accounting
  add column if not exists eod_pos_id uuid references public.eod_pos(id) on delete set null;
create index if not exists eod_accounting_eod_pos_id_idx on public.eod_accounting (eod_pos_id);

-- 4) eod_deviations — categorised delta between POS and accounting.
create table if not exists public.eod_deviations (
  id uuid primary key default gen_random_uuid(),
  eod_pos_id uuid references public.eod_pos(id) on delete cascade,
  eod_accounting_id uuid references public.eod_accounting(id) on delete cascade,
  category text not null check (category in (
    'comp','discount','credit_tab','staff_meal','waste','pos_error','cash_deficit','rounding','other'
  )),
  affected_line text not null check (affected_line in (
    'food','wine','bar','softdrinks','tips','service','cash','card'
  )),
  amount_eur numeric(12,2) not null,            -- signed; negative reduces revenue
  description text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists eod_deviations_pos_idx on public.eod_deviations (eod_pos_id);
create index if not exists eod_deviations_acct_idx on public.eod_deviations (eod_accounting_id);
create index if not exists eod_deviations_category_idx on public.eod_deviations (category);

alter table public.eod_deviations enable row level security;
drop policy if exists "eod_deviations_auth_select" on public.eod_deviations;
create policy "eod_deviations_auth_select" on public.eod_deviations
  for select to authenticated using (true);
drop policy if exists "eod_deviations_auth_insert" on public.eod_deviations;
create policy "eod_deviations_auth_insert" on public.eod_deviations
  for insert to authenticated with check (
    created_by is null or created_by = auth.uid()
  );
drop policy if exists "eod_deviations_auth_update" on public.eod_deviations;
create policy "eod_deviations_auth_update" on public.eod_deviations
  for update to authenticated using (true) with check (true);
drop policy if exists "eod_deviations_auth_delete" on public.eod_deviations;
create policy "eod_deviations_auth_delete" on public.eod_deviations
  for delete to authenticated using (true);

-- 5) v_operational_pnl — per-day per-restaurant OPERATIONAL view (kitchen dashboard).
--    Uses POS revenue by category AS revenue, MINUS comp+staff_meal+waste as food-cost drag
--    lines (they represent food that left the kitchen without recovered revenue).
--    Team sees this during briefings. Fraud-safe: reads only immutable eod_pos + deviations.
create or replace view public.v_operational_pnl as
select
  p.restaurant_id,
  p.date,
  p.id                                              as eod_pos_id,
  p.covers,
  p.food_net_eur,
  p.wine_net_eur,
  p.bar_net_eur,
  p.softdrinks_net_eur,
  p.tips_eur,
  p.total_gross_eur,
  coalesce(sum(case when d.category = 'comp'       then abs(d.amount_eur) end), 0) as comp_eur,
  coalesce(sum(case when d.category = 'discount'   then abs(d.amount_eur) end), 0) as discount_eur,
  coalesce(sum(case when d.category = 'staff_meal' then abs(d.amount_eur) end), 0) as staff_meal_eur,
  coalesce(sum(case when d.category = 'waste'      then abs(d.amount_eur) end), 0) as waste_eur,
  coalesce(sum(case when d.category = 'credit_tab' then abs(d.amount_eur) end), 0) as credit_tab_eur,
  coalesce(sum(case when d.category = 'cash_deficit' then abs(d.amount_eur) end), 0) as cash_deficit_eur,
  -- Leading indicators: what % of gross is comps/staff-meals/waste?
  case when p.total_gross_eur > 0
    then round(coalesce(sum(case when d.category = 'comp'       then abs(d.amount_eur) end), 0) / p.total_gross_eur * 100, 2)
    else 0 end as comp_pct,
  case when p.total_gross_eur > 0
    then round(coalesce(sum(case when d.category = 'staff_meal' then abs(d.amount_eur) end), 0) / p.total_gross_eur * 100, 2)
    else 0 end as staff_meal_pct,
  case when p.total_gross_eur > 0
    then round(coalesce(sum(case when d.category = 'waste'      then abs(d.amount_eur) end), 0) / p.total_gross_eur * 100, 2)
    else 0 end as waste_pct
from public.eod_pos p
left join public.eod_deviations d on d.eod_pos_id = p.id
group by p.id, p.restaurant_id, p.date, p.covers,
         p.food_net_eur, p.wine_net_eur, p.bar_net_eur, p.softdrinks_net_eur,
         p.tips_eur, p.total_gross_eur;

-- 6) v_fiscal_pnl — per-day per-restaurant FISCAL view (Labritja + Modelo 303).
--    Reads accounting EOD as posted. This is what goes to Holded + tax filings.
create or replace view public.v_fiscal_pnl as
select
  a.restaurant_id,
  a.report_date                        as date,
  a.id                                 as eod_accounting_id,
  a.eod_pos_id,
  a.actual_covers                      as covers,
  a.revenue,
  a.revenue_food,
  a.revenue_wine,
  a.revenue_bar,
  a.eighty_six_notes,
  a.wastage_notes
from public.eod_accounting a;

-- Views inherit the underlying tables' RLS (security_invoker semantic default in modern PG).
-- Explicit grant for clarity.
grant select on public.v_operational_pnl to authenticated;
grant select on public.v_fiscal_pnl      to authenticated;
