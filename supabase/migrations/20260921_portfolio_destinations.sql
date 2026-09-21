-- 20260921_portfolio_destinations.sql
-- Tasks #34 (advisory / partners / landlords destination pages) + #52 (Utopia demo).
-- APPLIED to prod 2026-09-21 via Supabase apply_migration.
--
-- One small schema, keyed on entities.id, shared by the three Studio
-- destination pages:
--   portfolio_contracts           engagements, JVs, revenue shares, licences, leases
--   portfolio_time_entries        advisory hours (billed / unbilled)
--   portfolio_revenue_share_lines monthly partner revenue-share statements
--   portfolio_rent_payments       landlord rent ledger (one row per period paid)
--   portfolio_maintenance_issues  landlord / premises issues
--
-- Demo rows (is_demo = true) hang off the Utopia sandbox entity and use
-- obviously fictional counterparty names suffixed "(demo)". They never show
-- on live views: pages read is_demo = false unless ?demo=1 is set.
--
-- RLS: read = owner OR member of the row's entity. Write = owner OR manager
-- of the row's entity.

create table if not exists public.portfolio_contracts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  counterparty_name text,
  kind text not null check (kind in ('advisory_engagement','joint_venture','revenue_share','licence','lease','catering','other')),
  title text not null,
  status text not null default 'active' check (status in ('draft','active','paused','ended')),
  start_date date,
  end_date date,
  notice_days int,
  fee_eur numeric,
  fee_cadence text check (fee_cadence in ('one_off','monthly','quarterly','annual','hourly')),
  hourly_rate_eur numeric,
  revenue_share_pct numeric check (revenue_share_pct is null or (revenue_share_pct >= 0 and revenue_share_pct <= 100)),
  equity_pct numeric check (equity_pct is null or (equity_pct >= 0 and equity_pct <= 100)),
  rent_eur numeric,
  rent_due_day int check (rent_due_day is null or rent_due_day between 1 and 31),
  next_review_on date,
  doc_url text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portfolio_contracts_entity on public.portfolio_contracts(entity_id, kind, status);

create table if not exists public.portfolio_time_entries (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.portfolio_contracts(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  worked_on date not null,
  hours numeric not null check (hours > 0),
  rate_eur numeric,
  billed_at timestamptz,
  invoice_ref text,
  note text,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists portfolio_time_entries_contract on public.portfolio_time_entries(contract_id, worked_on);

create table if not exists public.portfolio_revenue_share_lines (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.portfolio_contracts(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  period_month date not null,             -- first day of month
  gross_eur numeric not null default 0,
  share_eur numeric not null default 0,
  settled_on date,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (contract_id, period_month)
);

create table if not exists public.portfolio_rent_payments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.portfolio_contracts(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  period_month date not null,             -- first day of the month the rent covers
  amount_eur numeric not null,
  paid_on date,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (contract_id, period_month)
);

create table if not exists public.portfolio_maintenance_issues (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.portfolio_contracts(id) on delete set null,
  entity_id uuid not null references public.entities(id) on delete cascade,
  title text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting','done')),
  responsible text check (responsible in ('landlord','tenant','shared')),
  reported_on date not null default current_date,
  resolved_on date,
  cost_eur numeric,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portfolio_maintenance_open on public.portfolio_maintenance_issues(entity_id, status);

-- RLS ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['portfolio_contracts','portfolio_time_entries','portfolio_revenue_share_lines','portfolio_rent_payments','portfolio_maintenance_issues'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.current_person_is_owner() or public.fn_is_entity_member(auth.uid(), entity_id))', t||'_select', t);
    execute format('drop policy if exists %I on public.%I', t||'_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.current_person_is_owner() or public.fn_is_entity_manager(auth.uid(), entity_id)) with check (public.current_person_is_owner() or public.fn_is_entity_manager(auth.uid(), entity_id))', t||'_write', t);
  end loop;
end $$;

-- Utopia demo seed (task #52) ----------------------------------------------
-- Idempotent: wipes and re-seeds demo rows only. Dates are relative to the
-- day the migration runs so the demo has live-looking "due" and "next review".
do $$
declare
  u uuid;
  a1 uuid; a2 uuid; a3 uuid;
  p1 uuid; p2 uuid; p3 uuid;
  l1 uuid; l2 uuid;
  m0 date := date_trunc('month', current_date)::date;
begin
  select id into u from public.entities where name = 'Utopia' limit 1;
  if u is null then raise notice 'Utopia entity missing; demo seed skipped'; return; end if;

  delete from public.portfolio_contracts where is_demo and entity_id = u;
  delete from public.portfolio_maintenance_issues where is_demo and entity_id = u;

  -- Advisory
  insert into public.portfolio_contracts (entity_id,counterparty_name,kind,title,status,start_date,end_date,fee_eur,fee_cadence,hourly_rate_eur,next_review_on,is_demo)
    values (u,'Casa Albahaca (demo)','advisory_engagement','Menu engineering + kitchen reset','active',m0 - interval '4 months',m0 + interval '2 months',2400,'monthly',95,current_date + 6,true) returning id into a1;
  insert into public.portfolio_contracts (entity_id,counterparty_name,kind,title,status,start_date,end_date,fee_eur,fee_cadence,hourly_rate_eur,next_review_on,is_demo)
    values (u,'Bodega Norte (demo)','advisory_engagement','Pre-opening: concept to soft launch','active',m0 - interval '2 months',m0 + interval '4 months',null,'hourly',110,current_date + 13,true) returning id into a2;
  insert into public.portfolio_contracts (entity_id,counterparty_name,kind,title,status,start_date,end_date,fee_eur,fee_cadence,hourly_rate_eur,next_review_on,is_demo)
    values (u,'Salitre Beach Club (demo)','advisory_engagement','Season review + staffing plan','paused',m0 - interval '7 months',null,1800,'one_off',95,current_date + 40,true) returning id into a3;

  insert into public.portfolio_time_entries (contract_id,entity_id,worked_on,hours,rate_eur,billed_at,invoice_ref,note,is_demo) values
    (a1,u,current_date - 26,3.5,95,now() - interval '20 days','DEMO-0101','Menu costing workshop',true),
    (a1,u,current_date - 19,2,95,now() - interval '12 days','DEMO-0102','Supplier review',true),
    (a1,u,current_date - 9,4,95,null,null,'Line walk + prep flow',true),
    (a1,u,current_date - 3,1.5,95,null,null,'Call with head chef',true),
    (a2,u,current_date - 30,6,110,now() - interval '25 days','DEMO-0201','Concept deck',true),
    (a2,u,current_date - 16,5,110,now() - interval '10 days','DEMO-0202','Kitchen layout',true),
    (a2,u,current_date - 5,3,110,null,null,'Equipment list',true),
    (a3,u,current_date - 70,8,95,now() - interval '60 days','DEMO-0301','End-of-season audit',true);

  -- Partners
  insert into public.portfolio_contracts (entity_id,counterparty_name,kind,title,status,start_date,end_date,notice_days,revenue_share_pct,equity_pct,next_review_on,is_demo)
    values (u,'Villa Marès (demo)','joint_venture','Private-dining JV — villa season','active',m0 - interval '5 months',m0 + interval '7 months',60,null,40,current_date + 21,true) returning id into p1;
  insert into public.portfolio_contracts (entity_id,counterparty_name,kind,title,status,start_date,end_date,notice_days,revenue_share_pct,next_review_on,is_demo)
    values (u,'Olivar Catering (demo)','revenue_share','Overflow catering referrals','active',m0 - interval '8 months',null,30,12,current_date + 9,true) returning id into p2;
  insert into public.portfolio_contracts (entity_id,counterparty_name,kind,title,status,start_date,end_date,notice_days,fee_eur,fee_cadence,is_demo)
    values (u,'Pan de Roca (demo)','licence','Bread recipe licence','active',m0 - interval '14 months',current_date + 25,30,300,'monthly',true) returning id into p3;

  insert into public.portfolio_revenue_share_lines (contract_id,entity_id,period_month,gross_eur,share_eur,settled_on,is_demo) values
    (p1,u,(m0 - interval '3 months')::date,18400,7360,(m0 - interval '2 months')::date + 10,true),
    (p1,u,(m0 - interval '2 months')::date,22100,8840,(m0 - interval '1 months')::date + 10,true),
    (p1,u,(m0 - interval '1 months')::date,19750,7900,null,true),
    (p2,u,(m0 - interval '2 months')::date,6200,744,(m0 - interval '1 months')::date + 5,true),
    (p2,u,(m0 - interval '1 months')::date,4800,576,null,true);

  -- Landlords
  insert into public.portfolio_contracts (entity_id,counterparty_name,kind,title,status,start_date,end_date,notice_days,rent_eur,rent_due_day,next_review_on,is_demo)
    values (u,'Inmobiliaria Sal (demo)','lease','Utopia premises — ground floor','active','2024-04-01',current_date + 75,90,3200,5,current_date + 45,true) returning id into l1;
  insert into public.portfolio_contracts (entity_id,counterparty_name,kind,title,status,start_date,end_date,notice_days,rent_eur,rent_due_day,is_demo)
    values (u,'Nave Can Ferrer (demo)','lease','Dry-store unit','active','2025-01-01','2027-12-31',60,450,1,true) returning id into l2;

  insert into public.portfolio_rent_payments (contract_id,entity_id,period_month,amount_eur,paid_on,is_demo) values
    (l1,u,(m0 - interval '2 months')::date,3200,(m0 - interval '2 months')::date + 4,true),
    (l1,u,(m0 - interval '1 months')::date,3200,(m0 - interval '1 months')::date + 6,true),
    (l2,u,(m0 - interval '1 months')::date,450,(m0 - interval '1 months')::date,true),
    (l2,u,m0,450,m0,true);

  insert into public.portfolio_maintenance_issues (contract_id,entity_id,title,severity,status,responsible,reported_on,cost_eur,is_demo) values
    (l1,u,'Extraction hood motor noisy','high','open','landlord',current_date - 4,null,true),
    (l1,u,'Terrace awning torn','medium','waiting','landlord',current_date - 18,380,true),
    (l2,u,'Roller door sticks','low','in_progress','shared',current_date - 9,null,true),
    (l1,u,'Grease trap service','medium','done','tenant',current_date - 40,220,true);
end $$;
