-- Fresto webhook event log.
--
-- Every webhook Fresto POSTs to us lands here first — before any downstream mutation
-- (booking upsert, EOD landing, etc.). This gives us:
--   - a replay surface (retry the effect from a stored payload if downstream failed)
--   - a signature-verification audit trail
--   - a debug surface Boris can eyeball at /administrate/finance/pos-sync when
--     something looks off
--
-- Insert-only. Signature verification is enforced at the route (not RLS) — we still
-- record verification=false rows so we can see what shape unsigned traffic takes.

create table if not exists public.fresto_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  entity_code text,                              -- IFL | BM | BBH — resolved from URL slug at receive time
  action text not null,                          -- 'booking.approved' | 'closing-report'
  fresto_id text,                                -- the id inside the payload (booking id / z-report id) when present
  business_date date,                            -- extracted for filtering
  raw_headers jsonb not null default '{}'::jsonb,
  raw_body jsonb not null,
  signature_header text,
  signature_verified boolean not null default false,
  processed_at timestamptz,                      -- set when downstream mutation is committed
  processed_ok boolean,
  processed_error text,
  downstream_ref jsonb                           -- { booking_id?, eod_pos_id?, eod_accounting_id? }
);

create index if not exists idx_fresto_webhook_events_received_at on public.fresto_webhook_events(received_at desc);
create index if not exists idx_fresto_webhook_events_entity_action on public.fresto_webhook_events(entity_code, action);
create index if not exists idx_fresto_webhook_events_business_date on public.fresto_webhook_events(business_date);

alter table public.fresto_webhook_events enable row level security;

drop policy if exists fresto_webhook_events_read on public.fresto_webhook_events;
create policy fresto_webhook_events_read on public.fresto_webhook_events
  for select to authenticated using (true);

drop policy if exists fresto_webhook_events_insert on public.fresto_webhook_events;
create policy fresto_webhook_events_insert on public.fresto_webhook_events
  for insert to authenticated with check (true);

comment on table public.fresto_webhook_events is
  'Immutable event log for every webhook POST from Fresto. See lib/integrations/pos/fresto-webhook.ts.';

-- Widen assistant_actions.action_kind so webhook receivers + sync surface can log
-- to the same audit table without violating the CHECK constraint. Additive on top
-- of what 20260711_finance_anomalies.sql last set (chat / brief / draft / triage /
-- send / webhook_receive / memory_extract / anomaly_scan / payment_scan_gmail).
alter table if exists public.assistant_actions
  drop constraint if exists assistant_actions_action_kind_check;
alter table if exists public.assistant_actions
  add constraint assistant_actions_action_kind_check
  check (action_kind is null or action_kind in
    ('chat','brief','draft','triage','send','webhook_receive',
     'memory_extract','anomaly_scan','payment_scan_gmail',
     'fresto_webhook','pos_sync'));
