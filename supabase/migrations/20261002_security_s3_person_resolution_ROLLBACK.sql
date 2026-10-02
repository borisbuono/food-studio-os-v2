-- Rollback for 20261002_security_s3_person_resolution.sql.
-- Restores the 14 functions and the team_members / memberships / referrals
-- policies from the rls_audit snapshots taken at apply time, drops the S3
-- objects. KEPT: pending_invites.person_id (data), the person_auth_link data
-- fixes (correct regardless), the two indexes.
--
-- Order matters: accept_pending_invite is dropped before re-create because its
-- return type did not change but the body did; the others are CREATE OR REPLACE.

-- 1. policies: drop the S3 versions, recreate the snapshot
do $$ declare r record; begin
  for r in select distinct tablename, policyname from rls_audit.policies_before_20261002_s3 loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
  for r in select * from rls_audit.policies_before_20261002_s3 loop
    execute format('create policy %I on public.%I as %s for %s to %s %s %s',
      r.policyname, r.tablename, r.permissive, r.cmd, array_to_string(r.roles, ', '),
      case when r.qual is not null then 'using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then 'with check (' || r.with_check || ')' else '' end);
  end loop;
end $$;

-- 2. functions: replay the snapshot definitions (CREATE OR REPLACE FUNCTION …)
do $$ declare r record; begin
  for r in select def from rls_audit.functions_before_20261002_s3 order by proname loop
    execute r.def;
  end loop;
end $$;

-- 3. S3-only objects
drop function if exists public.app_person_ids_for_uid_raw(uuid);
drop function if exists public._membership_role_rank(text);

-- 4. sanity: nothing left pointing at the dropped resolver
do $$ declare n int; begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosrc like '%app_person_ids_for_uid_raw%';
  if n > 0 then raise exception 'rollback incomplete: % functions still reference app_person_ids_for_uid_raw', n; end if;
end $$;
