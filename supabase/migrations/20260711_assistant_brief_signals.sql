-- Assistant Polish #2 — Daily Brief signal weaving.
--
-- The Sprint 2 brief stored body text only. Polish #2 keeps that column
-- (the model's editorial prose) and adds two things next to it:
--
--   - signals jsonb    — the pre-brief structured context assembly:
--                        priorities, signals, money, handled. The Home
--                        panel renders these as micro-labels under the
--                        prose sections.
--   - headline text    — a one-sentence summary line the panel shows
--                        above the paragraphs.
--
-- All additive. Legacy briefs with signals=NULL fall through to prose-only
-- rendering. Widen the entity_code check to advisory codes to match the
-- rest of the Assistant Layer (already loose on config/playbooks).

alter table if exists assistant_briefs
  add column if not exists signals  jsonb,
  add column if not exists headline text;

alter table if exists assistant_briefs
  drop constraint if exists assistant_briefs_entity_code_check;
alter table if exists assistant_briefs
  add constraint assistant_briefs_entity_code_check
  check (entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%');

-- Reserve room for later — the assembly is small (< 8kb typical) but the
-- gin index keeps queries by signal category cheap when we grow filters.
create index if not exists assistant_briefs_signals_gin
  on assistant_briefs using gin (signals);
