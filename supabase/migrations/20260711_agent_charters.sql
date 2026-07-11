-- PA integration Sprint 2 — Agent Task Charter as a first-class artifact.
--
-- The Cowork-side PA orchestrator scopes every agent-task via the Charter
-- template at 06_PA/Systems/Agent_Task_Charter_TEMPLATE.md — the lesson
-- from the Holded-audit spiral. This migration brings that contract into
-- the OS so every agent spawned FROM the OS gets a charter row BEFORE it
-- runs. The charter IS the contract — objective, scope, constraints,
-- success criteria, deliverables.
--
-- Additive. The template still lives in Cowork; this table is the
-- structured version that the Assistant orchestrator + /administrate can
-- read + write.

create table if not exists agent_charters (
  id uuid primary key default gen_random_uuid(),
  entity_code text check (entity_code is null or entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%'),
  -- What kind of agent is running? research / build / write / pa / other.
  agent_type text not null default 'research'
    check (agent_type in ('research','build','write','pa','other')),
  -- The four pillars of the charter.
  objective text not null,
  scope text,
  constraints text,
  success_criteria text,
  -- Structured deliverables — { type, description, delivered_at? } array.
  deliverables jsonb not null default '[]'::jsonb,
  -- Optional link to a related master_todos row so a charter and the
  -- todo it services stay tied together.
  related_todo_id uuid references master_todos(id) on delete set null,
  -- Runner state.
  status text not null default 'draft'
    check (status in ('draft','ready','running','completed','abandoned','failed')),
  started_at timestamptz,
  completed_at timestamptz,
  -- What the agent actually did — the closing summary.
  output_summary text,
  spawned_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_charters_entity_status_idx on agent_charters (entity_code, status);
create index if not exists agent_charters_type_idx          on agent_charters (agent_type);
create index if not exists agent_charters_todo_idx          on agent_charters (related_todo_id);

alter table agent_charters enable row level security;
create policy "agent_charters_auth_read" on agent_charters
  for select to authenticated using (true);
create policy "agent_charters_auth_write" on agent_charters
  for all to authenticated using (true) with check (true);
create policy "agent_charters_service_all" on agent_charters
  for all to service_role using (true) with check (true);

create or replace function agent_charters_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists agent_charters_touch_updated_at on agent_charters;
create trigger agent_charters_touch_updated_at
  before update on agent_charters
  for each row execute function agent_charters_touch_updated_at();
