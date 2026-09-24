-- Chef v3 Phase 1 — turn log, undo tokens and the PA inbox note queue.
--
-- chef_turns     one row per /api/ask turn (classification + outcome + cost)
-- chef_undo      a token per undoable write; /api/chef/act deletes the row on undo
-- pa_inbox_notes notes queued for the PA agent to materialise as
--                06_PA/_INBOX/<filename> (run_agent leaves the account, so the
--                request is written down rather than executed in-app)

create table if not exists public.chef_turns (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  entity_id   uuid,
  route       text,
  transcript  text,
  intent      jsonb,
  confidence  numeric,
  outcome     text,
  undo_token  uuid,
  latency_ms  int,
  cost_cents  numeric,
  voice       boolean default false,
  language    text,
  session_id  text,
  created_at  timestamptz default now()
);
create index if not exists chef_turns_user_created_idx on public.chef_turns (user_id, created_at desc);

create table if not exists public.chef_undo (
  token       uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  table_name  text not null,
  row_id      uuid not null,
  used_at     timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz default now()
);
create index if not exists chef_undo_expires_idx on public.chef_undo (expires_at);

create table if not exists public.pa_inbox_notes (
  id          uuid primary key default gen_random_uuid(),
  filename    text not null,
  body_md     text not null,
  status      text not null default 'pending' check (status in ('pending','written')),
  charter_id  uuid,
  entity_id   uuid,
  created_by  uuid,
  created_at  timestamptz default now(),
  written_at  timestamptz
);

alter table public.chef_turns     enable row level security;
alter table public.chef_undo      enable row level security;
alter table public.pa_inbox_notes enable row level security;

-- Own rows only: the turn log and undo tokens are per-user by construction.
drop policy if exists chef_turns_own_select on public.chef_turns;
drop policy if exists chef_turns_own_insert on public.chef_turns;
drop policy if exists chef_turns_own_update on public.chef_turns;
create policy chef_turns_own_select on public.chef_turns for select to authenticated using (user_id = auth.uid());
create policy chef_turns_own_insert on public.chef_turns for insert to authenticated with check (user_id = auth.uid());
create policy chef_turns_own_update on public.chef_turns for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists chef_undo_own_select on public.chef_undo;
drop policy if exists chef_undo_own_insert on public.chef_undo;
drop policy if exists chef_undo_own_update on public.chef_undo;
create policy chef_undo_own_select on public.chef_undo for select to authenticated using (user_id = auth.uid());
create policy chef_undo_own_insert on public.chef_undo for insert to authenticated with check (user_id = auth.uid());
create policy chef_undo_own_update on public.chef_undo for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Any signed-in member can read the queue (the PA runner reads it with the
-- service role anyway); writes stay tied to the author.
drop policy if exists pa_inbox_notes_select on public.pa_inbox_notes;
drop policy if exists pa_inbox_notes_own_insert on public.pa_inbox_notes;
drop policy if exists pa_inbox_notes_own_update on public.pa_inbox_notes;
create policy pa_inbox_notes_select     on public.pa_inbox_notes for select to authenticated using (true);
create policy pa_inbox_notes_own_insert on public.pa_inbox_notes for insert to authenticated with check (created_by = auth.uid());
create policy pa_inbox_notes_own_update on public.pa_inbox_notes for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

grant select, insert, update on public.chef_turns, public.chef_undo, public.pa_inbox_notes to authenticated;
