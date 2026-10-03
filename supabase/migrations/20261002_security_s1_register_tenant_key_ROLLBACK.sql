-- Rollback for 20261002_security_s1_register_tenant_key.sql.
-- Restores the pre-S1 policies from rls_audit.policies_before_20261002_s1 and
-- removes the S1 objects. Columns master_todos.entity_id / kind and
-- files_inbox.entity_id are KEPT (data written since apply would be lost); the
-- old BM/IFL/BBH CHECK is not reinstated — rows with other codes may exist.

-- 1. drop S1 policies
do $$ declare r record; begin
  for r in select tablename, policyname from pg_policies where schemaname='public' and policyname in (
    'master_todos_scope_select','master_todos_scope_insert','master_todos_scope_update','master_todos_scope_delete',
    'master_todo_activity_tenant_read','master_todo_activity_tenant_insert',
    'academy_progress_own_all','academy_progress_roster_read',
    'agent_call_log_scope_select','agent_call_log_scope_insert','agent_call_log_scope_review',
    'assistant_billing_tiers_owner_write','authored_by_scope_read',
    'files_inbox_scope_select','files_inbox_scope_write',
    'haccp_training_scope_select','haccp_training_scope_write',
    'onb_steps_own_all','onb_steps_scope_read','onb_steps_manager_write',
    'onb_docs_own_all','onb_docs_manager_read','pbs_scope_read','pr_state_scope_all')
  loop execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

-- 2. recreate the snapshot (excluding the anon demo read on haccp_training_log, which stays gone)
do $$ declare r record; begin
  for r in select * from rls_audit.policies_before_20261002_s1 where policyname <> 'anon_read_demo' loop
    execute format('create policy %I on public.%I as %s for %s to %s %s %s',
      r.policyname, r.tablename, r.permissive, r.cmd, array_to_string(r.roles, ', '),
      case when r.qual is not null then 'using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then 'with check (' || r.with_check || ')' else '' end);
  end loop;
end $$;

-- 3. functions / trigger
drop trigger if exists master_todos_derive_entity_biu on public.master_todos;
drop function if exists public.master_todos_derive_entity();
drop function if exists public.register_write(text, text, text, timestamptz, text);
drop function if exists public.app_my_managed_roster_auth_uids();

-- 4. constraints back to the old enums (only if no row violates them)
alter table public.master_todos drop constraint if exists master_todos_status_check;
alter table public.master_todos add constraint master_todos_status_check
  check (status in ('pending','in_progress','blocked','completed','deferred','noted')) not valid;
-- source / kind format checks are harmless; left in place.
