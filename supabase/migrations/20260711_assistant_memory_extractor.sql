-- Assistant Polish #1 — memory extractor pipeline.
--
-- The Sprint 1 foundation shipped assistant_memory as a text-only fact
-- store. Polish #1 adds enough structure so the extractor can dedupe
-- and the curation UI can filter by kind:
--   - subject / predicate / object    — atomic triple form
--   - kind                            — person / place / preference / allergy / relationship / reminder / birthday / other
--   - entity_code                     — per-entity memory (IFL / BM / BBH / ADV-*)
--   - tags                            — free-form tags the surface can filter by
--
-- All columns nullable so legacy rows survive. Fact text is preserved as
-- the human-readable rendering — the triple is only used for dedup and
-- the curation UI. Insert path is at lib/assistant/memory/extractor.ts.
--
-- assistant_actions.action_kind is widened to include 'memory_extract'
-- so the extractor's meter row lands correctly.

-- =========================================================================
-- 1. Enrich assistant_memory with structured columns.
-- =========================================================================

alter table if exists assistant_memory
  add column if not exists subject     text,
  add column if not exists predicate   text,
  add column if not exists object      text,
  add column if not exists kind        text,
  add column if not exists entity_code text,
  add column if not exists tags        text[];

alter table if exists assistant_memory
  drop constraint if exists assistant_memory_kind_check;
alter table if exists assistant_memory
  add constraint assistant_memory_kind_check
  check (kind is null or kind in
    ('person','place','thing','preference','allergy','relationship','reminder','birthday','upcoming','other'));

alter table if exists assistant_memory
  drop constraint if exists assistant_memory_entity_code_check;
alter table if exists assistant_memory
  add constraint assistant_memory_entity_code_check
  check (entity_code is null or entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%');

-- Dedup helper — the extractor checks for an existing row per
-- (user_id, entity_code, subject, predicate) before inserting.
create index if not exists assistant_memory_dedup_idx
  on assistant_memory (user_id, entity_code, subject, predicate)
  where retired_at is null;

-- Kind + tag filters for the curation UI.
create index if not exists assistant_memory_user_kind_idx
  on assistant_memory (user_id, kind)
  where retired_at is null;

create index if not exists assistant_memory_tags_idx
  on assistant_memory using gin (tags);

-- =========================================================================
-- 2. Widen assistant_actions.action_kind to include 'memory_extract'.
-- =========================================================================

alter table if exists assistant_actions
  drop constraint if exists assistant_actions_action_kind_check;
alter table if exists assistant_actions
  add constraint assistant_actions_action_kind_check
  check (action_kind is null or action_kind in
    ('chat','brief','draft','triage','send','webhook_receive','memory_extract'));

-- =========================================================================
-- 3. Track extraction runs so a session isn't re-distilled every navigation.
--    One row per (session_id, run_at). Extractor short-circuits if a run
--    happened for this session in the last 5 minutes.
-- =========================================================================

create table if not exists assistant_memory_extractions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid references auth.users(id) on delete cascade,
  entity_code text,
  turn_count int not null default 0,
  facts_extracted int not null default 0,
  facts_inserted int not null default 0,
  cost_eur numeric(12,6),
  latency_ms int,
  model text,
  input_tokens int,
  output_tokens int,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists assistant_memory_extractions_session_idx
  on assistant_memory_extractions (session_id, created_at desc);
create index if not exists assistant_memory_extractions_user_recent_idx
  on assistant_memory_extractions (user_id, created_at desc);

alter table assistant_memory_extractions enable row level security;
create policy "assistant_memory_extractions_own_select"
  on assistant_memory_extractions for select to authenticated
  using (user_id = auth.uid());
create policy "assistant_memory_extractions_own_write"
  on assistant_memory_extractions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
