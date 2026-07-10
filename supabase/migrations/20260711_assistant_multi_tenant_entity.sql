-- Assistant Layer Sprint 6 — multi-tenant entity code widening.
--
-- The Sprint 1 foundation constrained assistant_config, assistant_playbooks
-- and assistant_briefs to entity_code in ('IFL','BM','BBH'). Sprint 6 opens
-- the door for advisory clients + partner venues — they use codes of the
-- form ADV-<slug>. This migration loosens the CHECK constraints across the
-- three tables so the onboarding wizard can insert without a schema fight.
--
-- RLS is unchanged. All rows are still authenticated-read; the write path
-- through /api/assistant/onboard scopes new advisory rows by user.

alter table if exists assistant_config
  drop constraint if exists assistant_config_entity_code_check;
alter table if exists assistant_config
  add constraint assistant_config_entity_code_check
  check (entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%');

alter table if exists assistant_playbooks
  drop constraint if exists assistant_playbooks_entity_code_check;
alter table if exists assistant_playbooks
  add constraint assistant_playbooks_entity_code_check
  check (entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%');

alter table if exists assistant_briefs
  drop constraint if exists assistant_briefs_entity_code_check;
alter table if exists assistant_briefs
  add constraint assistant_briefs_entity_code_check
  check (entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%');

-- A slim registry of advisory clients so the top switcher can list them.
-- Sits alongside the pre-existing entities table (which models the internal
-- group). Advisory clients are separate — they are white-label operators
-- Boris advises, not subsidiaries of BBH.
create table if not exists assistant_advisory_clients (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null unique check (entity_code like 'ADV-%'),
  name text not null,
  city text,
  country text,
  billing_tier text references assistant_billing_tiers(name) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_advisory_clients_active_idx
  on assistant_advisory_clients (is_active, name);

alter table assistant_advisory_clients enable row level security;
create policy "assistant_advisory_clients_read"
  on assistant_advisory_clients for select to authenticated using (true);
create policy "assistant_advisory_clients_write"
  on assistant_advisory_clients for all    to authenticated
  using (owner_user_id = auth.uid() or owner_user_id is null)
  with check (owner_user_id = auth.uid() or owner_user_id is null);
