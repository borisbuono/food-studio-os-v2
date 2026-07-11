-- PA integration Sprint 1 — Master_ToDo backbone.
--
-- Boris's PA orchestrator (Cowork side) has kept a live Master_ToDo list
-- since 2026-07 alongside the "highest-impact move" habit. This migration
-- brings that list INTO the OS so:
--   1. The PA orchestrator writes here via /api/master-todo (single source
--      of truth — no more chasing a markdown file that only the PA sees).
--   2. Boris + team can add todos from any surface (a supplier profile,
--      an invoice, the Chef FAB, a mobile screen).
--   3. The Home compass can lift the highest-impact open todos to the top.
--   4. The FAB voice "what's on my plate today" reads master_todos ranked
--      by impact_score.
--
-- Additive only. The Cowork-side markdown Master_ToDo stays as source of
-- truth for the PA orchestrator until the orchestrator learns to write
-- here; this table is the OS-native mirror + Boris's live composer.

-- =========================================================================
-- 1. master_todos — the live to-do list.
-- =========================================================================

create table if not exists master_todos (
  id uuid primary key default gen_random_uuid(),
  entity_code text check (entity_code is null or entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%'),
  source text not null default 'user_added'
    check (source in ('pa_orchestrator','user_added','system_generated','from_conversation')),
  title text not null,
  description text,
  status text not null default 'pending'
    check (status in ('pending','in_progress','blocked','completed','deferred')),
  priority int not null default 3 check (priority between 1 and 5),
  impact_score int not null default 3 check (impact_score between 1 and 5),
  assignee_user_id uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  related_atoms jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists master_todos_status_impact_idx  on master_todos (status, impact_score desc);
create index if not exists master_todos_entity_status_idx  on master_todos (entity_code, status);
create index if not exists master_todos_assignee_idx       on master_todos (assignee_user_id, status);
create index if not exists master_todos_source_idx         on master_todos (source);
create index if not exists master_todos_due_idx            on master_todos (due_at) where due_at is not null;

alter table master_todos enable row level security;

create policy "master_todos_auth_read" on master_todos
  for select to authenticated using (true);
create policy "master_todos_auth_write" on master_todos
  for all to authenticated using (true) with check (true);
create policy "master_todos_service_all" on master_todos
  for all to service_role using (true) with check (true);

create or replace function master_todos_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists master_todos_touch_updated_at on master_todos;
create trigger master_todos_touch_updated_at
  before update on master_todos
  for each row execute function master_todos_touch_updated_at();

-- =========================================================================
-- 2. master_todo_activity — audit log of every state change.
-- =========================================================================

create table if not exists master_todo_activity (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references master_todos(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  from_value text,
  to_value text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists master_todo_activity_todo_at_idx on master_todo_activity (todo_id, created_at desc);

alter table master_todo_activity enable row level security;
create policy "master_todo_activity_auth_read" on master_todo_activity
  for select to authenticated using (true);
create policy "master_todo_activity_auth_write" on master_todo_activity
  for insert to authenticated with check (true);
create policy "master_todo_activity_service_all" on master_todo_activity
  for all to service_role using (true) with check (true);

create or replace function master_todos_log_activity()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    insert into master_todo_activity (todo_id, actor_user_id, action, to_value)
    values (new.id, new.created_by_user_id, 'created', new.status);
  elsif TG_OP = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into master_todo_activity (todo_id, actor_user_id, action, from_value, to_value)
      values (new.id, coalesce(new.created_by_user_id, new.assignee_user_id), 'status_changed', old.status, new.status);
    end if;
    if new.assignee_user_id is distinct from old.assignee_user_id then
      insert into master_todo_activity (todo_id, actor_user_id, action, from_value, to_value)
      values (new.id, new.created_by_user_id, 'reassigned',
              coalesce(old.assignee_user_id::text,'—'),
              coalesce(new.assignee_user_id::text,'—'));
    end if;
    if new.impact_score is distinct from old.impact_score then
      insert into master_todo_activity (todo_id, actor_user_id, action, from_value, to_value)
      values (new.id, new.created_by_user_id, 'impact_changed', old.impact_score::text, new.impact_score::text);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists master_todos_log_activity_ins on master_todos;
drop trigger if exists master_todos_log_activity_upd on master_todos;
create trigger master_todos_log_activity_ins after insert on master_todos
  for each row execute function master_todos_log_activity();
create trigger master_todos_log_activity_upd after update on master_todos
  for each row execute function master_todos_log_activity();
