-- Assistant Layer foundation — Sprint 1 (schema).
--
-- Renames the Chef FAB v2 tables to their long-lived Assistant Layer names,
-- then adds three new config-as-data tables: assistant_config (per entity),
-- assistant_channels (per user), assistant_playbooks (per entity).
--
-- Data-preserving. ALTER TABLE RENAME keeps rows, indexes, sequences, RLS
-- and existing policies intact — Postgres re-points policies at the new
-- table name automatically. The policy display names still reference "chef_*"
-- which is cosmetic; we leave them alone to keep the migration small.

-- =========================================================================
-- 1. Rename the four Chef FAB tables to assistant_*.
-- =========================================================================

alter table if exists chef_conversations    rename to assistant_conversations;
alter table if exists chef_memory           rename to assistant_memory;
alter table if exists chef_actions          rename to assistant_actions;
alter table if exists intent_classifications rename to assistant_intents;

-- Rename indexes to match (Postgres keeps the old names otherwise).
alter index if exists chef_conversations_user_created_idx rename to assistant_conversations_user_created_idx;
alter index if exists chef_conversations_session_idx      rename to assistant_conversations_session_idx;
alter index if exists chef_memory_user_active_idx         rename to assistant_memory_user_active_idx;
alter index if exists chef_actions_user_created_idx       rename to assistant_actions_user_created_idx;
alter index if exists chef_actions_target_idx             rename to assistant_actions_target_idx;
alter index if exists intent_classifications_user_idx     rename to assistant_intents_user_idx;

-- Foreign keys that pointed at chef_conversations follow the rename.

-- =========================================================================
-- 2. assistant_config — one row per entity. Voice, personality, timezone,
--    working hours. Read on every /api/assistant/generate call.
-- =========================================================================

create table if not exists assistant_config (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null check (entity_code in ('IFL','BM','BBH')),
  voice_profile text,
  personality_dials jsonb not null default '{"formality":0.4,"warmth":0.7,"brevity":0.6}'::jsonb,
  timezone text not null default 'Europe/Madrid',
  working_hours jsonb not null default '{"mon":{"start":"09:00","end":"23:00"},"tue":{"start":"09:00","end":"23:00"},"wed":{"start":"09:00","end":"23:00"},"thu":{"start":"09:00","end":"23:00"},"fri":{"start":"09:00","end":"23:30"},"sat":{"start":"09:00","end":"23:30"},"sun":{"start":"09:00","end":"22:30"}}'::jsonb,
  quiet_hours jsonb not null default '{"start":"23:30","end":"08:00"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists assistant_config_entity_idx on assistant_config (entity_code);

alter table assistant_config enable row level security;
-- Any authenticated operator can read; writes gated by the Office role at API layer.
create policy "assistant_config_read" on assistant_config for select to authenticated using (true);
create policy "assistant_config_write" on assistant_config for all to authenticated using (true) with check (true);

-- =========================================================================
-- 3. assistant_channels — one row per (user, channel).
-- =========================================================================

create table if not exists assistant_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_type text not null check (channel_type in ('gmail','whatsapp_personal','whatsapp_business')),
  account_ref text not null,
  auth_ref text,
  settings jsonb not null default '{"triage_enabled":false,"auto_draft":true,"quiet_hours_override":false}'::jsonb,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists assistant_channels_user_idx on assistant_channels (user_id) where revoked_at is null;

alter table assistant_channels enable row level security;
create policy "assistant_channels_own_select" on assistant_channels for select to authenticated using (user_id = auth.uid());
create policy "assistant_channels_own_write"  on assistant_channels for all    to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- 4. assistant_playbooks — one row per triage rule set (per entity).
-- =========================================================================

create table if not exists assistant_playbooks (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null check (entity_code in ('IFL','BM','BBH')),
  name text not null,
  description text,
  priority int not null default 100,
  triage_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_playbooks_entity_priority_idx on assistant_playbooks (entity_code, priority);

alter table assistant_playbooks enable row level security;
create policy "assistant_playbooks_read"  on assistant_playbooks for select to authenticated using (true);
create policy "assistant_playbooks_write" on assistant_playbooks for all    to authenticated using (true) with check (true);

-- =========================================================================
-- 5. Seed default config rows for IFL + BM. Voice_profile pulled from the
--    brand architecture: Bistro Mondo = folk warmth, tomato voice; Taller
--    Sa Penya = modernist, quiet, slate voice. Adjustable in Settings.
-- =========================================================================

insert into assistant_config (entity_code, voice_profile, personality_dials)
values
  ('IFL',
   'Modernist and quiet. Chef-owned. Serif prose, never salesy. Warm but sparse. Ibiza + Barcelona + a little Nordic restraint. When drafting: hairlines not exclamation marks. When speaking: like a head chef who has already thought about it for a week.',
   '{"formality":0.5,"warmth":0.65,"brevity":0.75}'::jsonb),
  ('BM',
   'Folk warmth. Tomato-red voice. Trattoria confidence — the food is Italian-Iberian, the tone is a friend who cooks for you. Use italic serifs and a little humor. Never corporate. Meet the guest at the table.',
   '{"formality":0.3,"warmth":0.85,"brevity":0.55}'::jsonb),
  ('BBH',
   'Holdings-neutral. Facts first, no atmosphere. Used only when speaking to Boris + the office about numbers, contracts, tax. Serif but sober.',
   '{"formality":0.7,"warmth":0.35,"brevity":0.8}'::jsonb)
on conflict (entity_code) do nothing;
