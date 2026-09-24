-- Chef v3 Phase 2 — undo of updates, turn resolution, idle-chip log, PA inbox materialiser.
-- Applied to prod 2026-09-24 as migration chef_v3_phase2.
alter table public.chef_undo add column if not exists op text not null default 'delete' check (op in ('delete','update','capture'));
alter table public.chef_undo add column if not exists before jsonb;
alter table public.chef_undo add column if not exists storage_path text;

alter table public.chef_turns add column if not exists source text;          -- voice | typed | chip | headset
alter table public.chef_turns add column if not exists chip_key text;
alter table public.chef_turns add column if not exists resolution text;      -- confirmed_tap | confirmed_voice | declined | timeout | undone | done
alter table public.chef_turns add column if not exists resolved_at timestamptz;
alter table public.chef_turns add column if not exists result text;          -- card title after execution

create table if not exists public.chef_chip_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  entity_id   uuid,
  route       text,
  shown       text[] not null default '{}',
  tapped      text,
  tapped_at   timestamptz,
  created_at  timestamptz default now()
);
create index if not exists chef_chip_log_user_created_idx on public.chef_chip_log (user_id, created_at desc);
alter table public.chef_chip_log enable row level security;
drop policy if exists chef_chip_log_own_select on public.chef_chip_log;
drop policy if exists chef_chip_log_own_insert on public.chef_chip_log;
drop policy if exists chef_chip_log_own_update on public.chef_chip_log;
create policy chef_chip_log_own_select on public.chef_chip_log for select to authenticated using (user_id = auth.uid());
create policy chef_chip_log_own_insert on public.chef_chip_log for insert to authenticated with check (user_id = auth.uid());
create policy chef_chip_log_own_update on public.chef_chip_log for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.chef_chip_log to authenticated;

alter table public.pa_inbox_notes add column if not exists materialised_at timestamptz;
alter table public.pa_inbox_notes add column if not exists storage_path text;
alter table public.pa_inbox_notes add column if not exists error text;

-- Managers of the entity read the whole turn log (chef-log page); own rows stay own.
drop policy if exists chef_turns_entity_managers_select on public.chef_turns;
create policy chef_turns_entity_managers_select on public.chef_turns for select to authenticated
  using (entity_id is not null and entity_id in (select app_my_managed_entities()));

-- S7 (applied to prod as migration chef_v3_pa_inbox_bucket) — pa_inbox bucket:
-- pending pa_inbox_notes rows are materialised there as <filename>; the PA
-- session syncs them into 06_PA/_INBOX/ (Vercel cannot write to the workspace).
insert into storage.buckets (id, name, public) values ('pa_inbox', 'pa_inbox', false) on conflict (id) do nothing;
drop policy if exists pa_inbox_authenticated_insert on storage.objects;
drop policy if exists pa_inbox_authenticated_select on storage.objects;
drop policy if exists pa_inbox_authenticated_update on storage.objects;
create policy pa_inbox_authenticated_insert on storage.objects for insert to authenticated with check (bucket_id = 'pa_inbox');
create policy pa_inbox_authenticated_select on storage.objects for select to authenticated using (bucket_id = 'pa_inbox');
create policy pa_inbox_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'pa_inbox') with check (bucket_id = 'pa_inbox');
alter table public.pa_inbox_notes add column if not exists synced_at timestamptz;
alter table public.pa_inbox_notes drop constraint if exists pa_inbox_notes_status_check;
alter table public.pa_inbox_notes add constraint pa_inbox_notes_status_check check (status in ('pending','written','failed'));
