-- Applied live 2026-06-27 via Supabase MCP. Captured here for repo provenance.
-- Chef FAB v2 — foundation tables: conversations + memory + actions + classifications.

create table if not exists chef_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  entity_id text, route text, session_id uuid,
  turn_role text not null check (turn_role in ('user','assistant','sys')),
  text text, intent text, confidence numeric, did_action jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chef_conversations_user_created_idx on chef_conversations (user_id, created_at desc);
create index if not exists chef_conversations_session_idx on chef_conversations (session_id);
alter table chef_conversations enable row level security;
create policy "chef_conversations_own_select" on chef_conversations for select to authenticated using (user_id = auth.uid());
create policy "chef_conversations_own_insert" on chef_conversations for insert to authenticated with check (user_id = auth.uid());

create table if not exists chef_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  fact text not null,
  source_conversation_id uuid references chef_conversations(id) on delete set null,
  scope text default 'global', confidence numeric,
  confirmed_at timestamptz default now(), retired_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chef_memory_user_active_idx on chef_memory (user_id) where retired_at is null;
alter table chef_memory enable row level security;
create policy "chef_memory_own_select" on chef_memory for select to authenticated using (user_id = auth.uid());
create policy "chef_memory_own_write" on chef_memory for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists chef_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  conversation_id uuid references chef_conversations(id) on delete set null,
  action_type text not null, target_table text, target_id text,
  payload jsonb, reversible boolean not null default false, undone_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chef_actions_user_created_idx on chef_actions (user_id, created_at desc);
create index if not exists chef_actions_target_idx on chef_actions (target_table, target_id);
alter table chef_actions enable row level security;
create policy "chef_actions_own_select" on chef_actions for select to authenticated using (user_id = auth.uid());
create policy "chef_actions_own_insert" on chef_actions for insert to authenticated with check (user_id = auth.uid());

create table if not exists intent_classifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  text text not null, classified_intent text, confirmed_intent text,
  classifier_confidence numeric, language text,
  created_at timestamptz not null default now()
);
create index if not exists intent_classifications_user_idx on intent_classifications (user_id, created_at desc);
alter table intent_classifications enable row level security;
create policy "intent_classifications_own_select" on intent_classifications for select to authenticated using (user_id = auth.uid());
create policy "intent_classifications_own_write" on intent_classifications for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
