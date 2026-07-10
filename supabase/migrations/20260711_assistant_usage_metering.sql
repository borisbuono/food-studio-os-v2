-- Assistant Layer Sprint 6 — usage metering + billing infrastructure.
--
-- Every /api/assistant/generate call already writes a row to
-- assistant_actions (renamed from chef_actions in the Sprint 1 foundation).
-- Sprint 6 enriches that row with the columns billing needs: entity_code,
-- cost_eur, latency_ms, model, input_tokens, output_tokens, action_kind.
-- Then two views aggregate it — daily + monthly — plus a per-tier cap so
-- the orchestrator can refuse a call when an entity has burned through the
-- month's allowance.
--
-- All additive. The Sprint 1 policies stay in place (assistant_actions is
-- already RLS-scoped by user_id). New tables get their own policies.

-- =========================================================================
-- 1. Enrich assistant_actions with the billing columns.
-- =========================================================================

alter table if exists assistant_actions
  add column if not exists entity_code   text,
  add column if not exists cost_eur      numeric(12,6),
  add column if not exists latency_ms    int,
  add column if not exists model         text,
  add column if not exists input_tokens  int,
  add column if not exists output_tokens int,
  add column if not exists action_kind   text;

alter table if exists assistant_actions
  drop constraint if exists assistant_actions_action_kind_check;
alter table if exists assistant_actions
  add constraint assistant_actions_action_kind_check
  check (action_kind is null or action_kind in
    ('chat','brief','draft','triage','send','webhook_receive'));

alter table if exists assistant_actions
  drop constraint if exists assistant_actions_entity_code_check;
alter table if exists assistant_actions
  add constraint assistant_actions_entity_code_check
  check (entity_code is null or entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%');

create index if not exists assistant_actions_entity_kind_created_idx
  on assistant_actions (entity_code, action_kind, created_at desc);

create index if not exists assistant_actions_entity_month_idx
  on assistant_actions (entity_code, date_trunc('month', created_at));

-- =========================================================================
-- 2. Aggregation views — read by /administrate/holdings/console/assistant.
-- =========================================================================

create or replace view v_assistant_usage_daily as
select
  entity_code,
  user_id,
  coalesce(action_kind, 'other')             as action_kind,
  (created_at at time zone 'Europe/Madrid')::date as day,
  count(*)                                   as actions,
  sum(coalesce(cost_eur, 0))                 as cost_eur,
  avg(coalesce(latency_ms, 0))::int          as avg_latency_ms,
  sum(coalesce(input_tokens, 0))             as input_tokens,
  sum(coalesce(output_tokens, 0))            as output_tokens
from assistant_actions
where entity_code is not null
group by entity_code, user_id, coalesce(action_kind, 'other'),
         (created_at at time zone 'Europe/Madrid')::date;

create or replace view v_assistant_usage_monthly as
select
  entity_code,
  user_id,
  coalesce(action_kind, 'other')             as action_kind,
  date_trunc('month', created_at at time zone 'Europe/Madrid')::date as month,
  count(*)                                   as actions,
  sum(coalesce(cost_eur, 0))                 as cost_eur,
  avg(coalesce(latency_ms, 0))::int          as avg_latency_ms,
  sum(coalesce(input_tokens, 0))             as input_tokens,
  sum(coalesce(output_tokens, 0))            as output_tokens
from assistant_actions
where entity_code is not null
group by entity_code, user_id, coalesce(action_kind, 'other'),
         date_trunc('month', created_at at time zone 'Europe/Madrid')::date;

-- =========================================================================
-- 3. Billing tiers — one row per named plan. Advisory = white-label per
--    external client, distinct from the internal group's Pro tier.
-- =========================================================================

create table if not exists assistant_billing_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name in ('starter','pro','enterprise','advisory')),
  monthly_action_cap int not null,
  monthly_cost_cap_eur numeric(12,2) not null,
  features jsonb not null default
    '{"daily_brief":true,"email_triage":false,"wa_business":false,"wa_desktop":false,"playbooks":true,"multi_user":false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table assistant_billing_tiers enable row level security;
create policy "assistant_billing_tiers_read"
  on assistant_billing_tiers for select to authenticated using (true);
create policy "assistant_billing_tiers_write"
  on assistant_billing_tiers for all    to authenticated using (true) with check (true);

insert into assistant_billing_tiers (name, monthly_action_cap, monthly_cost_cap_eur, features) values
  ('starter',    500,   10,
   '{"daily_brief":true,"email_triage":false,"wa_business":false,"wa_desktop":false,"playbooks":true,"multi_user":false}'::jsonb),
  ('pro',       5000,  100,
   '{"daily_brief":true,"email_triage":true,"wa_business":false,"wa_desktop":true,"playbooks":true,"multi_user":true}'::jsonb),
  ('enterprise',25000, 500,
   '{"daily_brief":true,"email_triage":true,"wa_business":true,"wa_desktop":true,"playbooks":true,"multi_user":true}'::jsonb),
  ('advisory',  2000,   60,
   '{"daily_brief":true,"email_triage":true,"wa_business":false,"wa_desktop":true,"playbooks":true,"multi_user":false}'::jsonb)
on conflict (name) do nothing;

-- =========================================================================
-- 4. Wire assistant_config to a tier. Default 'pro' for the internal group.
-- =========================================================================

alter table if exists assistant_config
  add column if not exists billing_tier text
    references assistant_billing_tiers(name) on delete set null;

update assistant_config
  set billing_tier = 'pro'
  where billing_tier is null and entity_code in ('IFL','BM','BBH');

-- =========================================================================
-- 5. Helper — month-to-date usage per entity. Used by the orchestrator's
--    cap check and the Holdings admin surface.
-- =========================================================================

create or replace view v_assistant_entity_mtd as
select
  a.entity_code,
  count(*)                            as actions,
  sum(coalesce(a.cost_eur, 0))        as cost_eur,
  avg(coalesce(a.latency_ms, 0))::int as avg_latency_ms
from assistant_actions a
where a.entity_code is not null
  and date_trunc('month', a.created_at at time zone 'Europe/Madrid')
    = date_trunc('month', now() at time zone 'Europe/Madrid')
group by a.entity_code;
