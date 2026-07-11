-- Bank reconciliation intelligence #3 — pattern learning substrate.
--
-- After the operator accepts N proposed matches that all share the same
-- (entity, pattern_type, normalised_reference, amount-band), the matcher
-- promotes them into recurring_bank_patterns. Once a pattern is learned,
-- the finder that first identified it (salary / tax / intercompany /
-- subscription) short-circuits — it returns a high-confidence candidate on
-- the first sight of a new movement that matches the pattern.
--
-- Operators can also add or disable patterns manually in
-- /administrate/finance/reconciliation/patterns. Manual patterns behave
-- exactly like learned patterns except pattern_type='manual'.
--
-- The Chef FAB reads recurring_bank_patterns for the current entity and
-- surfaces them as memory hints when asked "what does this movement look
-- like?" — patterns become the OS's institutional knowledge about how each
-- entity's bank life shapes up.

do $$ begin
  create type public.recurring_pattern_type as enum (
    'salary',
    'tax',
    'loan',
    'utility',
    'intercompany',
    'subscription',
    'manual'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recurring_pattern_frequency as enum (
    'weekly',
    'biweekly',
    'monthly',
    'quarterly',
    'yearly',
    'irregular'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.recurring_bank_patterns (
  id                    uuid primary key default gen_random_uuid(),
  entity_code           text not null check (entity_code in ('IFL','BM','BBH')),
  pattern_type          public.recurring_pattern_type not null,
  reference_regex       text not null,          -- regex applied to bank_movements.description (case-insensitive)
  expected_amount_range jsonb not null default '{}'::jsonb,   -- { "min": -1500, "max": -1200, "sign": "-"|"+" }
  expected_frequency    public.recurring_pattern_frequency not null default 'monthly',
  bank_account          text,                    -- optional — pin pattern to one bank_account
  match_type            public.bank_match_type not null default 'unknown',   -- what type the matcher should propose
  label                 text not null,           -- human label ("Payroll · Vanessa", "SolRed fuel subscription")
  learn_confidence      numeric(4,3) not null default 0.9 check (learn_confidence >= 0 and learn_confidence <= 1),
  first_seen            date,
  last_seen             date,
  times_matched         integer not null default 0,
  disabled_at           timestamptz,
  disabled_by           uuid references auth.users(id) on delete set null,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  meta                  jsonb not null default '{}'::jsonb,
  unique (entity_code, pattern_type, reference_regex)
);

create index if not exists recurring_bank_patterns_entity_idx
  on public.recurring_bank_patterns (entity_code, disabled_at, last_seen desc nulls last);
create index if not exists recurring_bank_patterns_active_idx
  on public.recurring_bank_patterns (entity_code, pattern_type)
  where disabled_at is null;

alter table public.recurring_bank_patterns enable row level security;

do $$ begin
  create policy recurring_bank_patterns_auth_read on public.recurring_bank_patterns
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy recurring_bank_patterns_auth_write on public.recurring_bank_patterns
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy recurring_bank_patterns_service_write on public.recurring_bank_patterns
    for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Convenience view — active patterns per entity, ordered by frequency of match.
create or replace view public.v_recurring_patterns_active as
  select *
  from public.recurring_bank_patterns
  where disabled_at is null
  order by times_matched desc, last_seen desc nulls last;
