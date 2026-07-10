-- Finance intelligence #1 — anomaly detection substrate.
--
-- Nine detectors run against the finance tables (eod_pos, eod_accounting,
-- eod_deviations, bank_movements, invoice_inbox, holded mirror asientos) and
-- upsert their findings here. Each row is a distinct anomaly, keyed by
-- (entity_code, kind, meta_hash) so re-running the detector is idempotent —
-- an anomaly that's still there stays open; one that's cleared falls off the
-- unresolved queue naturally next scan.
--
-- The triage UI (/administrate/finance/anomalies) reads unresolved rows and
-- lets the operator resolve, snooze, or link into the source row. The Home
-- compass alerts strip adds unresolved anomaly count as a signal source.
-- The Chef FAB reads unresolved rows for the current entity so a
-- conversational "any anomalies today?" gets a real answer.

do $$ begin
  create type public.finance_anomaly_kind as enum (
    'eod_cash_ratio_high',
    'eod_no_source',
    'bank_movement_unmatched_long',
    'invoice_missing_supplier',
    'invoice_amount_outlier',
    'duplicate_asiento',
    'posting_before_bank',
    'vat_ratio_deviation',
    'intercompany_ghost'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.finance_anomalies (
  id                uuid primary key default gen_random_uuid(),
  entity_code       text not null check (entity_code in ('IFL','BM','BBH')),
  kind              public.finance_anomaly_kind not null,
  description       text not null,
  severity          smallint not null default 2 check (severity between 1 and 5),
  detected_at       timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by       uuid references auth.users(id) on delete set null,
  snoozed_until     timestamptz,
  meta              jsonb not null default '{}'::jsonb,
  meta_hash         text not null,
  first_seen_date   date not null default current_date,
  last_seen_date    date not null default current_date,
  source_table      text,
  source_id         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (entity_code, kind, meta_hash)
);

create index if not exists finance_anomalies_entity_idx
  on public.finance_anomalies (entity_code, resolved_at, severity desc, last_seen_date desc);
create index if not exists finance_anomalies_unresolved_idx
  on public.finance_anomalies (entity_code, kind)
  where resolved_at is null;
create index if not exists finance_anomalies_kind_idx
  on public.finance_anomalies (kind, last_seen_date desc);

alter table public.finance_anomalies enable row level security;

do $$ begin
  create policy finance_anomalies_auth_read on public.finance_anomalies
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy finance_anomalies_auth_update on public.finance_anomalies
    for update to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy finance_anomalies_service_write on public.finance_anomalies
    for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Widen the assistant_actions action_kind vocabulary to admit the audit
-- rows emitted by the anomaly scan and the Gmail payment scan (Commit #3).
alter table if exists public.assistant_actions
  drop constraint if exists assistant_actions_action_kind_check;
alter table if exists public.assistant_actions
  add constraint assistant_actions_action_kind_check
  check (action_kind is null or action_kind in
    ('chat','brief','draft','triage','send','webhook_receive',
     'memory_extract','anomaly_scan','payment_scan_gmail'));

-- Open queue for the UI + FAB. Snoozed rows fall off until the snooze
-- expires; severest first, most recently observed second.
create or replace view public.v_finance_anomalies_open as
  select id, entity_code, kind, description, severity, detected_at,
         first_seen_date, last_seen_date, meta, source_table, source_id
  from public.finance_anomalies
  where resolved_at is null
    and (snoozed_until is null or snoozed_until <= now())
  order by severity desc, last_seen_date desc, detected_at desc;
