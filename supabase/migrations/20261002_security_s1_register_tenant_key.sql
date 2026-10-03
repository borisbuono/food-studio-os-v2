-- =====================================================================
-- Security hardening S1 (2026-10-02) — tenant key on the open tables and
-- the register migration.
--
-- 1. master_todos IS the register (Foundation §3 store 1). It gets the
--    tenant key `entity_id uuid → entities` (nullable; null = platform
--    owner only), a `kind` column with the six register kinds, and the
--    BM/IFL/BBH CHECK on entity_code is dropped — entity_code is now
--    DERIVED from entity_id by trigger, exactly like `observations`.
--    Policies move from app_my_entity_keys() (text codes) to
--    app_my_scope_entities() (uuids).
-- 2. register_write(entity_code, kind, body, due, source) is the ONE write
--    path for Chef /api/chef/act, PA and COM (agents call it from SQL like
--    observe()). SECURITY INVOKER: RLS decides who may write where.
-- 3. The remaining tables that any signed-in user could read/write
--    (audit 26-09 + live pg_policies check 02-10) get a real scope:
--    academy_lesson_progress, agent_call_log, assistant_billing_tiers,
--    authored_by, files_inbox, haccp_training_log (incl. the anon demo
--    read), onboarding_steps, onboarding_documents,
--    platform_billing_status, platform_reactivation_state.
--    Left as reference data readable by any login, on purpose:
--    chart_of_accounts (26-09 ruling), holiday_calendar, social_providers.
--
-- Additive and backward-compatible: old code that inserts master_todos
-- with entity_code keeps working (trigger derives entity_id). Rollback:
-- 20261002_security_s1_register_tenant_key_ROLLBACK.sql.
-- =====================================================================

create schema if not exists rls_audit;
create table if not exists rls_audit.policies_before_20261002_s1 as
  select now() as snapshot_at, * from pg_policies
   where schemaname = 'public'
     and tablename in ('master_todos','master_todo_activity','academy_lesson_progress','agent_call_log',
                       'assistant_billing_tiers','authored_by','files_inbox','haccp_training_log',
                       'onboarding_steps','onboarding_documents','platform_billing_status','platform_reactivation_state');

-- ---------------------------------------------------------------------
-- 1. master_todos — the register
-- ---------------------------------------------------------------------
alter table public.master_todos
  add column if not exists entity_id uuid references public.entities(id) on delete set null,
  add column if not exists kind text;

alter table public.master_todos drop constraint if exists master_todos_entity_code_check;
alter table public.master_todos drop constraint if exists master_todos_source_check;
alter table public.master_todos drop constraint if exists master_todos_status_check;
alter table public.master_todos drop constraint if exists master_todos_kind_check;
alter table public.master_todos drop constraint if exists master_todos_source_format_check;

-- source = who wrote it (chef, pa, com, ceo, finance-agent, user_added, …), a token not an enum.
alter table public.master_todos add constraint master_todos_source_format_check
  check (source ~ '^[a-z0-9_.-]{1,40}$');
-- kinds = the six from the foundation. Null only on legacy rows.
alter table public.master_todos add constraint master_todos_kind_check
  check (kind is null or kind in ('decision','identifier','commitment','constraint','correction','pointer'));
-- 'noted' = a register line that is a fact, not a task (decision, identifier,
-- constraint, correction, pointer). Open-todo views exclude it.
alter table public.master_todos add constraint master_todos_status_check
  check (status in ('pending','in_progress','blocked','completed','deferred','noted'));

update public.master_todos
   set entity_id = public.entity_id_for_code(entity_code)
 where entity_id is null and nullif(btrim(coalesce(entity_code,'')),'') is not null;

update public.master_todos set kind = 'commitment' where kind is null;

create index if not exists master_todos_entity_id_idx on public.master_todos (entity_id);
create index if not exists master_todos_entity_kind_idx on public.master_todos (entity_id, kind, status);

create or replace function public.master_todos_derive_entity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.entity_id is null and nullif(btrim(coalesce(new.entity_code,'')),'') is not null then
    new.entity_id := public.entity_id_for_code(new.entity_code);
    if new.entity_id is null then
      raise exception 'master_todos: unknown entity (entity_code=%)', new.entity_code using errcode = '23503';
    end if;
  end if;
  if new.entity_id is not null then
    new.entity_code := public.entity_code_for(new.entity_id);
  end if;
  if new.kind is null then new.kind := 'commitment'; end if;
  if new.kind <> 'commitment' and new.status = 'pending' and tg_op = 'INSERT' then
    new.status := 'noted';
  end if;
  return new;
end $$;

drop trigger if exists master_todos_derive_entity_biu on public.master_todos;
create trigger master_todos_derive_entity_biu
  before insert or update of entity_id, entity_code, kind on public.master_todos
  for each row execute function public.master_todos_derive_entity();

-- Policies: uuid scope. Null entity = platform owner only.
drop policy if exists master_todos_tenant_read  on public.master_todos;
drop policy if exists master_todos_tenant_write on public.master_todos;
drop policy if exists master_todos_scope_select on public.master_todos;
drop policy if exists master_todos_scope_insert on public.master_todos;
drop policy if exists master_todos_scope_update on public.master_todos;
drop policy if exists master_todos_scope_delete on public.master_todos;

create policy master_todos_scope_select on public.master_todos for select to authenticated
  using (case when entity_id is null then public.app_is_platform_owner()
              else entity_id in (select public.app_my_scope_entities()) end);
create policy master_todos_scope_insert on public.master_todos for insert to authenticated
  with check (case when entity_id is null then public.app_is_platform_owner()
                   else entity_id in (select public.app_my_scope_entities()) end);
create policy master_todos_scope_update on public.master_todos for update to authenticated
  using (case when entity_id is null then public.app_is_platform_owner()
              else entity_id in (select public.app_my_scope_entities()) end)
  with check (case when entity_id is null then public.app_is_platform_owner()
                   else entity_id in (select public.app_my_scope_entities()) end);
-- delete = the author (Chef undo ≤ 24 h) or a manager of the entity.
create policy master_todos_scope_delete on public.master_todos for delete to authenticated
  using (
    (case when entity_id is null then public.app_is_platform_owner()
          else entity_id in (select public.app_my_scope_entities()) end)
    and (created_by_user_id = auth.uid()
         or entity_id in (select public.app_my_managed_entities())
         or public.app_is_platform_owner())
  );

-- master_todo_activity scopes through its todo, now by entity_id.
drop policy if exists master_todo_activity_tenant_read   on public.master_todo_activity;
drop policy if exists master_todo_activity_tenant_insert on public.master_todo_activity;
create policy master_todo_activity_tenant_read on public.master_todo_activity for select to authenticated
  using (exists (select 1 from public.master_todos t where t.id = master_todo_activity.todo_id
                 and case when t.entity_id is null then public.app_is_platform_owner()
                          else t.entity_id in (select public.app_my_scope_entities()) end));
create policy master_todo_activity_tenant_insert on public.master_todo_activity for insert to authenticated
  with check (exists (select 1 from public.master_todos t where t.id = master_todo_activity.todo_id
                 and case when t.entity_id is null then public.app_is_platform_owner()
                          else t.entity_id in (select public.app_my_scope_entities()) end));

-- ---------------------------------------------------------------------
-- 2. register_write — the ONE write path
-- ---------------------------------------------------------------------
create or replace function public.register_write(
  p_entity_code text,
  p_kind        text,
  p_body        text,
  p_due         timestamptz default null,
  p_source      text default 'agent'
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_kind   text := lower(btrim(coalesce(p_kind, '')));
  v_body   text := regexp_replace(btrim(coalesce(p_body, '')), '\s+', ' ', 'g');
  v_source text := nullif(regexp_replace(lower(btrim(coalesce(p_source, ''))), '[^a-z0-9_.-]', '_', 'g'), '');
  v_entity uuid;
begin
  if v_kind not in ('decision','identifier','commitment','constraint','correction','pointer') then
    raise exception 'register_write: kind must be one of decision, identifier, commitment, constraint, correction, pointer (got "%")', p_kind
      using errcode = '23514';
  end if;
  if v_body = '' then
    raise exception 'register_write: body required' using errcode = '23514';
  end if;
  v_entity := public.entity_id_for_code(p_entity_code);
  if v_entity is null then
    raise exception 'register_write: unknown entity "%"', p_entity_code using errcode = '23503';
  end if;
  insert into public.master_todos
    (entity_id, kind, title, source, status, priority, impact_score, due_at, created_by_user_id, context)
  values
    (v_entity, v_kind, left(v_body, 500), coalesce(v_source, 'agent'),
     case when v_kind = 'commitment' then 'pending' else 'noted' end,
     3, 3, p_due, auth.uid(),
     jsonb_build_object('via', 'register_write', 'body_full', case when length(v_body) > 500 then v_body else null end))
  returning id into v_id;
  return v_id;
end $$;

comment on function public.register_write(text, text, text, timestamptz, text) is
  'Foundation §3 store 1. The one write path into the register (master_todos). kind ∈ decision|identifier|commitment|constraint|correction|pointer. RLS of the caller applies.';

revoke all on function public.register_write(text, text, text, timestamptz, text) from public, anon;
grant execute on function public.register_write(text, text, text, timestamptz, text) to authenticated, service_role;

-- observation_pattern_accept writes source 'observation_synthesis' — legal now that the source CHECK is a format check.

-- ---------------------------------------------------------------------
-- 3. The other open tables
-- ---------------------------------------------------------------------
-- Helper: auth uids of the people on the rosters I MANAGE (for tables keyed by auth uid).
create or replace function public.app_my_managed_roster_auth_uids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select tm.auth_user_id from public.team_members tm
   where tm.auth_user_id is not null
     and (tm.operator_entity_id in (select public.app_my_managed_entities())
          or tm.id in (select public.app_my_managed_roster_person_ids()));
$$;
revoke all on function public.app_my_managed_roster_auth_uids() from public, anon;
grant execute on function public.app_my_managed_roster_auth_uids() to authenticated, service_role;

-- academy_lesson_progress: own rows; managers read their roster's progress.
drop policy if exists academy_progress_auth_all on public.academy_lesson_progress;
create policy academy_progress_own_all on public.academy_lesson_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy academy_progress_roster_read on public.academy_lesson_progress for select to authenticated
  using (user_id in (select public.app_my_managed_roster_auth_uids()) or public.app_is_platform_owner());

-- agent_call_log: by operator_entity_id; null = platform owner. Append-only for users.
drop policy if exists "Auth read agent_call_log" on public.agent_call_log;
drop policy if exists agent_call_log_auth_write on public.agent_call_log;
create policy agent_call_log_scope_select on public.agent_call_log for select to authenticated
  using (case when operator_entity_id is null then public.app_is_platform_owner()
              else operator_entity_id in (select public.app_my_scope_entities()) end);
create policy agent_call_log_scope_insert on public.agent_call_log for insert to authenticated
  with check (case when operator_entity_id is null then public.app_is_platform_owner()
                   else operator_entity_id in (select public.app_my_scope_entities()) end);
create policy agent_call_log_scope_review on public.agent_call_log for update to authenticated
  using (operator_entity_id in (select public.app_my_managed_entities()) or public.app_is_platform_owner())
  with check (operator_entity_id in (select public.app_my_managed_entities()) or public.app_is_platform_owner());

-- assistant_billing_tiers: reference data, read by any login; writes service/platform owner only.
drop policy if exists assistant_billing_tiers_write on public.assistant_billing_tiers;
create policy assistant_billing_tiers_owner_write on public.assistant_billing_tiers for all to authenticated
  using (public.app_is_platform_owner()) with check (public.app_is_platform_owner());

-- authored_by: who worked on what — visible for people on my rosters.
drop policy if exists authored_by_read on public.authored_by;
create policy authored_by_scope_read on public.authored_by for select to authenticated
  using (person_id in (select public.app_my_roster_person_ids()) or public.app_is_platform_owner());

-- files_inbox: Boris's admin mailboxes today; tenant inboxes tomorrow.
alter table public.files_inbox add column if not exists entity_id uuid references public.entities(id) on delete set null;
create index if not exists files_inbox_entity_id_idx on public.files_inbox (entity_id);
drop policy if exists files_inbox_auth_read  on public.files_inbox;
drop policy if exists files_inbox_auth_write on public.files_inbox;
create policy files_inbox_scope_select on public.files_inbox for select to authenticated
  using (case when entity_id is null then public.app_is_platform_owner()
              else entity_id in (select public.app_my_scope_entities()) end);
create policy files_inbox_scope_write on public.files_inbox for all to authenticated
  using (case when entity_id is null then public.app_is_platform_owner()
              else entity_id in (select public.app_my_managed_entities()) end)
  with check (case when entity_id is null then public.app_is_platform_owner()
                   else entity_id in (select public.app_my_managed_entities()) end);

-- haccp_training_log: through the team member's entity. Anon demo read is gone.
drop policy if exists anon_read_demo on public.haccp_training_log;
drop policy if exists "Auth read haccp_training_log" on public.haccp_training_log;
create policy haccp_training_scope_select on public.haccp_training_log for select to authenticated
  using (exists (select 1 from public.team_members tm where tm.id = haccp_training_log.team_member_id
                   and (tm.operator_entity_id in (select public.app_my_scope_entities())
                        or tm.id in (select public.app_my_roster_person_ids())))
         or public.app_is_platform_owner());
create policy haccp_training_scope_write on public.haccp_training_log for all to authenticated
  using (exists (select 1 from public.team_members tm where tm.id = haccp_training_log.team_member_id
                   and tm.operator_entity_id in (select public.app_my_managed_entities()))
         or public.app_is_platform_owner())
  with check (exists (select 1 from public.team_members tm where tm.id = haccp_training_log.team_member_id
                   and tm.operator_entity_id in (select public.app_my_managed_entities()))
         or public.app_is_platform_owner());

-- onboarding_steps / onboarding_documents: own rows (the wizard writes before a
-- membership exists), plus managers of the entity, plus roster readers.
drop policy if exists onb_steps_auth_all on public.onboarding_steps;
create policy onb_steps_own_all on public.onboarding_steps for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy onb_steps_scope_read on public.onboarding_steps for select to authenticated
  using (user_id in (select public.app_my_managed_roster_auth_uids())
         or entity_code in (select public.app_my_entity_keys())
         or public.app_is_platform_owner());
create policy onb_steps_manager_write on public.onboarding_steps for all to authenticated
  using (entity_code in (select public.app_my_managed_entity_keys()) or public.app_is_platform_owner())
  with check (entity_code in (select public.app_my_managed_entity_keys()) or public.app_is_platform_owner());

drop policy if exists onb_docs_auth_all on public.onboarding_documents;
create policy onb_docs_own_all on public.onboarding_documents for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy onb_docs_manager_read on public.onboarding_documents for select to authenticated
  using (user_id in (select public.app_my_managed_roster_auth_uids())
         or entity_code in (select public.app_my_managed_entity_keys())
         or public.app_is_platform_owner());

-- platform_billing_status / platform_reactivation_state: by entity_code key.
drop policy if exists pbs_auth_read on public.platform_billing_status;
create policy pbs_scope_read on public.platform_billing_status for select to authenticated
  using (case when entity_code is null then public.app_is_platform_owner()
              else entity_code in (select public.app_my_entity_keys()) end);

drop policy if exists pr_state_auth_all on public.platform_reactivation_state;
create policy pr_state_scope_all on public.platform_reactivation_state for all to authenticated
  using (case when entity_code is null then public.app_is_platform_owner()
              else entity_code in (select public.app_my_entity_keys()) end)
  with check (case when entity_code is null then public.app_is_platform_owner()
                   else entity_code in (select public.app_my_entity_keys()) end);

-- fresto_salepoints_master: a leftover `using (true)` read beside the member-scoped policy.
drop policy if exists salepoints_master_auth_read on public.fresto_salepoints_master;
