-- 20260921_rls_view_grants_cleanup.sql
--
-- The public views are all security_invoker=true, so they already respect the
-- caller's RLS on the base tables — but they still carried anon
-- INSERT/UPDATE/DELETE/TRUNCATE grants from the original blanket GRANT ALL,
-- plus anon SELECT on the finance roll-ups (v_fiscal_pnl, v_operational_pnl,
-- v_bank_matches_open …). Nothing reads these with the anon key.
--
-- Also drops the duplicate entities UPDATE policy: a parallel session added
-- `entities_update_scoped` with identical semantics while
-- 20260921_rls_owner_scope_and_entities.sql was being written. Theirs uses the
-- (select auth.uid()) form the Supabase linter prefers, so it is the one kept.

do $$
declare v record;
begin
  for v in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v','m')
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', v.relname);
    execute format('revoke insert, update, delete, select on public.%I from anon', v.relname);
  end loop;
end $$;

drop policy if exists rls_entities_update on public.entities;
