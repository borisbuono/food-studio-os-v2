-- Advisory Sprint #3 — activation checklist + template metadata.
--
-- Extends the Sprint #1 schema with the productised onboarding surface:
--   • advisory_clients.template_key — remembers which template seeded the
--     client so future runs can compare deltas.
--   • advisory_checklist_items — one row per activation step, per client.
--     Owned by the primary advisor, updated as onboarding proceeds. When
--     all steps are done the client flips to 'active' automatically.
--
-- Additive. Isolation continues to piggy-back off advisory_clients RLS.

alter table if exists advisory_clients
  add column if not exists template_key text;

create table if not exists advisory_checklist_items (
  id uuid primary key default gen_random_uuid(),
  advisory_client_id uuid not null references advisory_clients(id) on delete cascade,

  step_key text not null,                     -- e.g. 'entity_created', 'holded_connected'
  label    text not null,
  hint     text,
  status   text not null default 'todo'
    check (status in ('todo','in_progress','done','skipped','blocked')),
  owner_user_id uuid references auth.users(id) on delete set null,
  notes text,
  sort_order int not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,

  unique (advisory_client_id, step_key)
);

create index if not exists advisory_checklist_client_idx
  on advisory_checklist_items (advisory_client_id, sort_order);

alter table advisory_checklist_items enable row level security;

drop policy if exists advisory_checklist_read on advisory_checklist_items;
create policy advisory_checklist_read on advisory_checklist_items
  for select to authenticated using (
    exists (
      select 1 from advisory_clients c
      where c.id = advisory_checklist_items.advisory_client_id
        and (
          c.primary_advisor_user_id = auth.uid()
          or exists (
            select 1 from advisory_seats s
            where s.advisory_client_id = c.id
              and s.user_id = auth.uid()
              and s.accepted_at is not null
              and s.revoked_at is null
          )
        )
    )
  );

drop policy if exists advisory_checklist_write on advisory_checklist_items;
create policy advisory_checklist_write on advisory_checklist_items
  for all to authenticated
  using (
    exists (
      select 1 from advisory_clients c
      where c.id = advisory_checklist_items.advisory_client_id
        and c.primary_advisor_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from advisory_clients c
      where c.id = advisory_checklist_items.advisory_client_id
        and c.primary_advisor_user_id = auth.uid()
    )
  );

-- =========================================================================
-- Auto-flip status to 'active' when every checklist row is done.
-- The trigger runs after an update on advisory_checklist_items and, if
-- every row for that client is 'done' or 'skipped', promotes the parent
-- client. Non-blocking — a repeated activation is a no-op.
-- =========================================================================
create or replace function _advisory_checklist_promote()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  todo_count int;
begin
  select count(*) into todo_count
  from advisory_checklist_items
  where advisory_client_id = new.advisory_client_id
    and status not in ('done','skipped');

  if todo_count = 0 then
    update advisory_clients
      set status       = 'active',
          activated_at = coalesce(activated_at, now()),
          updated_at   = now()
      where id = new.advisory_client_id
        and status in ('prospect','onboarding');
  end if;
  return new;
end $$;

drop trigger if exists advisory_checklist_promote on advisory_checklist_items;
create trigger advisory_checklist_promote
  after insert or update of status on advisory_checklist_items
  for each row execute function _advisory_checklist_promote();
