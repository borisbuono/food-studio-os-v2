-- Bank reconciliation intelligence #1 — matching substrate.
--
-- Extends the bank_movements substrate with:
--   * bank_match_candidates — proposed matches from the matcher, one row per
--     (movement, candidate). The matcher can propose several and the operator
--     picks one; the losers stay for audit (status='rejected' or 'proposed'
--     until superseded). Confidence 0..1 is set by the finder that produced
--     the candidate; anything >= 0.9 lights up green in the triage UI.
--   * bank_movements.reconciled_status — matcher-level state, kept next to
--     the older bank_movements.reconciled_to so we don't disrupt what the
--     existing reconciliation page reads.
--
-- Six candidate finders live in lib/finance/bank-matcher.ts:
--   1. invoice          — amount + supplier alias / merchant string match
--   2. eod              — POS daily aggregate lands on entity-scoped account
--                         (IFL POS lands ONLY on CaixaBank 6484 rule)
--   3. asiento          — mirror asiento produced by the internal ledger
--   4. intercompany     — BBH<->BM known intercompany pattern
--   5. salary           — recurring monthly to the same reference
--   6. tax              — modelo amount to AEAT
--   7. self-transfer    — paired opposite-sign same-day movements
-- The finder that returns nothing >= 0.8 hands the movement to the assistant
-- orchestrator in "match_reason" flavour (mode=extract), and the AI candidate
-- is upserted at whatever confidence it self-reports (clamped to <= 0.75 so an
-- operator always sees it before it flips to matched).
--
-- Idempotency: every insert is upserted on
--   (bank_movement_id, match_type, match_target_id, finder)
-- so re-running the matcher just refreshes candidates in place; already-
-- accepted matches (status='accepted') are never rewritten.

do $$ begin
  create type public.bank_match_type as enum (
    'invoice',
    'eod',
    'asiento',
    'intercompany',
    'salary',
    'tax',
    'self-transfer',
    'unknown'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bank_match_status as enum (
    'proposed',
    'accepted',
    'rejected',
    'manual'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bank_reconciled_status as enum (
    'unmatched',
    'matched',
    'needs_review',
    'reconciled_manual'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.bank_match_candidates (
  id                 uuid primary key default gen_random_uuid(),
  entity_code        text not null check (entity_code in ('IFL','BM','BBH')),
  bank_movement_id   uuid not null references public.bank_movements(id) on delete cascade,
  match_type         public.bank_match_type not null,
  match_target_id    text,
  match_target_label text,
  finder             text not null,
  confidence         numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  rationale          text not null,
  status             public.bank_match_status not null default 'proposed',
  meta               jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz,
  decided_by         uuid references auth.users(id) on delete set null,
  unique (bank_movement_id, match_type, match_target_id, finder)
);

create index if not exists bank_match_candidates_movement_idx
  on public.bank_match_candidates (bank_movement_id, confidence desc);
create index if not exists bank_match_candidates_status_idx
  on public.bank_match_candidates (entity_code, status, confidence desc);
create index if not exists bank_match_candidates_proposed_idx
  on public.bank_match_candidates (entity_code, confidence desc, created_at desc)
  where status = 'proposed';

alter table public.bank_match_candidates enable row level security;

do $$ begin
  create policy bank_match_candidates_auth_read on public.bank_match_candidates
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy bank_match_candidates_auth_write on public.bank_match_candidates
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy bank_match_candidates_service_write on public.bank_match_candidates
    for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;

alter table if exists public.bank_movements
  add column if not exists reconciled_status public.bank_reconciled_status not null default 'unmatched',
  add column if not exists matched_at        timestamptz;

create index if not exists bank_movements_reconciled_status_idx
  on public.bank_movements (entity_id, reconciled_status, movement_date desc);

create or replace view public.v_bank_matches_open as
  select
    bm.id                        as movement_id,
    bm.entity_id                 as entity_code,
    bm.bank_account,
    bm.movement_date,
    bm.amount_eur,
    bm.description,
    bm.reconciled_status,
    bmc.id                       as top_candidate_id,
    bmc.match_type               as top_match_type,
    bmc.match_target_id          as top_match_target_id,
    bmc.match_target_label       as top_match_target_label,
    bmc.finder                   as top_finder,
    bmc.confidence               as top_confidence,
    bmc.rationale                as top_rationale
  from public.bank_movements bm
  left join lateral (
    select *
    from public.bank_match_candidates c
    where c.bank_movement_id = bm.id and c.status = 'proposed'
    order by c.confidence desc, c.created_at desc
    limit 1
  ) bmc on true
  where bm.reconciled_status in ('unmatched','needs_review');
