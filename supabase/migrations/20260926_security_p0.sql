-- Security P0 fixes from the 2026-09-26 audit
-- (06_PA/_INBOX/TO_BORIS_security_audit_2026-09-26.md). Applied to prod the
-- same day via MCP apply_migration; every policy re-probed as anon /
-- authenticated in a rolled-back transaction before and after.
--
-- P0-1 fn_person_merge / fn_person_ids_for_uid guards + grants
-- P0-2 anon using(true) reads on providers / provider_products /
--      chart_of_accounts / entity_relationships / agent_skills
-- P0-3 fresto_income_centres_daily, cron_runs, master_todo_activity,
--      pa_inbox_notes scoped to membership
-- P0-4 storage buckets captures / documents / documents-inbox / pa_inbox
--      tenant path-prefix (modelled on hiring-cvs)
-- P0-8 apply_page_info() stops returning tax_id to anon; apply_page_legal()
--      is service-role only for the server-rendered consent notice.
--
-- Never use current_person_is_owner() in a policy or guard (true for an owner
-- of ANY entity — see rls_owner_scope_2026-09-21).

-- (single transaction when applied via supabase migration up / MCP apply_migration)

------------------------------------------------------------------------------
-- P0-1 · person identity functions
------------------------------------------------------------------------------

-- fn_person_ids_for_uid: the app calls it with the caller's own uid; the
-- helper functions (fn_is_entity_manager/member, current_person_is_owner)
-- call it with auth.uid(). Anyone else asking about a DIFFERENT uid gets
-- nothing unless the session is service-role (auth.uid() null) or the
-- platform owner. Anon can no longer execute it at all.
create or replace function public.fn_person_ids_for_uid(uid uuid)
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with allowed as (
    select (auth.uid() is null or uid = auth.uid() or public.app_is_platform_owner()) as ok
  )
  select tm.id
    from public.team_members tm, allowed a
   where a.ok
     and tm.auth_user_id = uid
     and coalesce(tm.status, 'active') not in ('removed', 'archived')
  union
  select l.person_id
    from public.person_auth_link l
    join public.team_members tm on tm.id = l.person_id
    cross join allowed a
   where a.ok
     and coalesce(tm.status, 'active') not in ('removed', 'archived')
     and l.can_sign_in
     and (
       l.auth_user_id = uid
       or lower(l.email) = (select lower(u.email) from auth.users u where u.id = uid)
     );
$function$;

revoke execute on function public.fn_person_ids_for_uid(uuid) from public, anon;
grant execute on function public.fn_person_ids_for_uid(uuid) to authenticated, service_role;

-- fn_person_merge: same body as 20260921_person_merge_and_auth_links.sql, new
-- guard. Old guard was `if auth.uid() is not null and not
-- current_person_is_owner()` — anon (auth.uid() null) skipped it entirely and
-- an owner of ANY tenant passed. Now:
--   • JWT role anon                      → refused
--   • no JWT uid and not service_role    → refused (only postgres/dashboard SQL
--                                          and the service key have no uid)
--   • signed in                          → must manage EVERY entity either
--                                          person belongs to, or be the
--                                          platform owner.
create or replace function public.fn_person_merge(p_survivor uuid, p_loser uuid, p_link_email boolean default true)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  s public.team_members;
  l public.team_members;
  moved_memberships int := 0;
  ended_memberships int := 0;
  moved_shifts int := 0;
  moved_candidates int := 0;
  moved_other int := 0;
  n int;
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if jwt_role = 'anon' then
    raise exception 'fn_person_merge: not allowed for anon';
  end if;
  if auth.uid() is null then
    if jwt_role not in ('', 'service_role') then
      raise exception 'fn_person_merge: not allowed';
    end if;
  elsif not public.app_is_platform_owner() then
    if exists (
      select 1 from public.memberships m
       where m.person_id in (p_survivor, p_loser)
         and m.status = 'active'
         and m.entity_id not in (select public.app_my_managed_entities())
    ) or exists (
      select 1 from public.team_members tm
       where tm.id in (p_survivor, p_loser)
         and tm.operator_entity_id is not null
         and tm.operator_entity_id not in (select public.app_my_managed_entities())
    ) or not exists (
      select 1 from public.team_members tm
       where tm.id in (p_survivor, p_loser)
         and (tm.operator_entity_id in (select public.app_my_managed_entities())
              or exists (select 1 from public.memberships m where m.person_id = tm.id
                          and m.entity_id in (select public.app_my_managed_entities())))
    ) then
      raise exception 'fn_person_merge: manager of every entity involved only';
    end if;
  end if;
  if p_survivor = p_loser then
    raise exception 'fn_person_merge: survivor and loser are the same row';
  end if;

  select * into s from public.team_members where id = p_survivor for update;
  if not found then raise exception 'fn_person_merge: survivor % not found', p_survivor; end if;
  select * into l from public.team_members where id = p_loser for update;
  if not found then raise exception 'fn_person_merge: loser % not found', p_loser; end if;
  if (l.metadata->>'merged_into') is not null then
    return jsonb_build_object('skipped', 'loser already merged', 'loser', p_loser);
  end if;

  -- memberships: move what the survivor doesn't already hold, close the rest.
  update public.memberships m
     set person_id = p_survivor,
         is_default = false,
         updated_at = now()
   where m.person_id = p_loser
     and not exists (
       select 1 from public.memberships x
        where x.person_id = p_survivor
          and x.entity_id = m.entity_id
          and x.role = m.role
          and x.status = 'active'
     );
  get diagnostics moved_memberships = row_count;

  update public.memberships m
     set status = 'merged',
         ended_at = coalesce(m.ended_at, current_date),
         notes = trim(both ' ' from coalesce(m.notes, '') || ' [merged into ' || p_survivor::text || ' ' || current_date::text || ']'),
         updated_at = now()
   where m.person_id = p_loser
     and m.status = 'active';
  get diagnostics ended_memberships = row_count;

  -- link tables keyed on team_members.id
  update public.sales_event_staffing set team_member_id = p_survivor where team_member_id = p_loser;
  get diagnostics n = row_count; moved_other := moved_other + n;
  update public.haccp_training_log set team_member_id = p_survivor where team_member_id = p_loser;
  get diagnostics n = row_count; moved_other := moved_other + n;
  update public.referrals set referrer_person_id = p_survivor where referrer_person_id = p_loser;
  get diagnostics n = row_count; moved_other := moved_other + n;
  update public.authored_by a
     set person_id = p_survivor
   where a.person_id = p_loser
     and not exists (
       select 1 from public.authored_by b
        where b.person_id = p_survivor
          and b.work_type = a.work_type
          and b.work_id = a.work_id
          and b.contribution_type = a.contribution_type
     );
  get diagnostics n = row_count; moved_other := moved_other + n;
  delete from public.authored_by where person_id = p_loser;

  -- rows keyed on the auth user
  if l.auth_user_id is not null and s.auth_user_id is not null and l.auth_user_id <> s.auth_user_id then
    update public.labor_shifts set user_id = s.auth_user_id where user_id = l.auth_user_id;
    get diagnostics moved_shifts = row_count;
    update public.labor_shifts set clock_in_by = s.auth_user_id where clock_in_by = l.auth_user_id;
    update public.labor_shifts set clock_out_by = s.auth_user_id where clock_out_by = l.auth_user_id;
    update public.candidates set assigned_to = s.auth_user_id where assigned_to = l.auth_user_id;
    get diagnostics moved_candidates = row_count;
    update public.job_openings set filled_by = s.auth_user_id where filled_by = l.auth_user_id;
    update public.interviews
       set interviewer_ids = array_replace(interviewer_ids, l.auth_user_id, s.auth_user_id)
     where l.auth_user_id = any(interviewer_ids);
  end if;

  -- login links
  insert into public.person_auth_link (person_id, auth_user_id, email, is_primary, note)
  values (p_survivor, s.auth_user_id, s.email, true, 'survivor ' || current_date::text)
  on conflict do nothing;

  if l.email is not null then
    insert into public.person_auth_link (person_id, auth_user_id, email, is_primary, can_sign_in, note)
    values (p_survivor, l.auth_user_id, l.email, false, p_link_email,
            case when p_link_email then 'merged alias ' || current_date::text
                 else 'merged ' || current_date::text || ' — shared mailbox, sign-in disabled' end)
    on conflict (lower(email)) do update
      set person_id = excluded.person_id,
          auth_user_id = coalesce(public.person_auth_link.auth_user_id, excluded.auth_user_id),
          can_sign_in = excluded.can_sign_in,
          note = excluded.note;
  end if;

  update public.team_members
     set status = 'removed',
         auth_user_id = null,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'merged_into', p_survivor,
           'merged_at', now(),
           'merged_email', l.email,
           'merged_auth_user_id', l.auth_user_id
         )
   where id = p_loser;

  return jsonb_build_object(
    'survivor', p_survivor, 'loser', p_loser, 'loser_email', l.email,
    'memberships_moved', moved_memberships, 'memberships_closed', ended_memberships,
    'links_moved', moved_other, 'labor_shifts_relinked', moved_shifts,
    'candidates_relinked', moved_candidates, 'email_can_sign_in', p_link_email
  );
end;
$function$;

revoke execute on function public.fn_person_merge(uuid, uuid, boolean) from public, anon;
grant execute on function public.fn_person_merge(uuid, uuid, boolean) to authenticated, service_role;

------------------------------------------------------------------------------
-- P0-2 · anon using(true) reads
------------------------------------------------------------------------------
drop policy if exists anon_read_staging on public.providers;
drop policy if exists cc_anon_read      on public.providers;
drop policy if exists "Auth read providers" on public.providers;
create policy providers_member_read on public.providers
  for select to authenticated
  using (exists (select 1 from public.current_person_entities()));

drop policy if exists anon_read_staging on public.provider_products;
drop policy if exists cc_anon_read      on public.provider_products;
drop policy if exists "Auth read provider_products" on public.provider_products;
drop policy if exists "Auth write provider products" on public.provider_products;
create policy provider_products_member_read on public.provider_products
  for select to authenticated
  using (exists (select 1 from public.current_person_entities()));
create policy provider_products_manager_write on public.provider_products
  for all to authenticated
  using (exists (select 1 from public.app_my_managed_entities()))
  with check (exists (select 1 from public.app_my_managed_entities()));

-- chart_of_accounts is the generic Spanish chart (no tenant data): signed-in only.
drop policy if exists cc_anon_read on public.chart_of_accounts;
-- "Auth read chart_of_accounts" (authenticated, true) stays.

drop policy if exists cc_anon_read on public.entity_relationships;
drop policy if exists "Auth read entity_relationships" on public.entity_relationships;
create policy entity_relationships_scope_read on public.entity_relationships
  for select to authenticated
  using (source_entity_id in (select public.app_my_scope_entities())
      or target_entity_id in (select public.app_my_scope_entities()));

-- agent_skills carries system prompts: a login alone is not enough, a membership is.
drop policy if exists anon_read_demo on public.agent_skills;
drop policy if exists "Auth read agent_skills" on public.agent_skills;
create policy agent_skills_member_read on public.agent_skills
  for select to authenticated
  using (exists (select 1 from public.current_person_entities()));

------------------------------------------------------------------------------
-- P0-3 · platform tables open to every signed-in user
------------------------------------------------------------------------------
-- income_centres_member_all (entity_code in app_my_entity_keys()) + service
-- policy already exist; the blanket read goes.
drop policy if exists income_centres_auth_read on public.fresto_income_centres_daily;

-- cron_runs: platform owner (cron_runs_platform_all) + service role only.
drop policy if exists cron_runs_auth_read on public.cron_runs;

-- master_todo_activity: scoped through the parent todo.
drop policy if exists master_todo_activity_auth_read  on public.master_todo_activity;
drop policy if exists master_todo_activity_auth_write on public.master_todo_activity;
create policy master_todo_activity_tenant_read on public.master_todo_activity
  for select to authenticated
  using (exists (
    select 1 from public.master_todos t
     where t.id = master_todo_activity.todo_id
       and case when t.entity_code is null then public.app_is_platform_owner()
                else t.entity_code in (select public.app_my_entity_keys()) end));
create policy master_todo_activity_tenant_insert on public.master_todo_activity
  for insert to authenticated
  with check (exists (
    select 1 from public.master_todos t
     where t.id = master_todo_activity.todo_id
       and case when t.entity_code is null then public.app_is_platform_owner()
                else t.entity_code in (select public.app_my_entity_keys()) end));

-- pa_inbox_notes: your own notes, notes for an entity you manage, or platform owner.
drop policy if exists pa_inbox_notes_select on public.pa_inbox_notes;
create policy pa_inbox_notes_scope_select on public.pa_inbox_notes
  for select to authenticated
  using (created_by = auth.uid()
      or entity_id in (select public.app_my_managed_entities())
      or public.app_is_platform_owner());

------------------------------------------------------------------------------
-- P0-4 · storage buckets — tenant path prefix
------------------------------------------------------------------------------
-- captures: <ENTITY_CODE>/<type>/<ts>.<ext>  (BM, IFL … = app_my_entity_keys())
drop policy if exists captures_auth_insert on storage.objects;
drop policy if exists captures_auth_read   on storage.objects;
create policy captures_member_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'captures'
    and split_part(name, '/', 1) in (select public.app_my_entity_keys()));
create policy captures_member_read on storage.objects
  for select to authenticated
  using (bucket_id = 'captures'
    and split_part(name, '/', 1) in (select public.app_my_entity_keys()));
create policy captures_manager_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'captures'
    and split_part(name, '/', 1) in (
      select public._entity_keys(array(select public.app_my_managed_entities()))));

-- documents: <ENTITY_CODE>/<category>/<file>  — same key check.
-- documents-inbox: <yyyy-mm-dd>/<uuid>_<file> — Boris's admin mailboxes,
-- written by the cron (service role); platform owner only on the user side.
drop policy if exists documents_auth_insert          on storage.objects;
drop policy if exists documents_read_authenticated   on storage.objects;
drop policy if exists documents_update_authenticated on storage.objects;
drop policy if exists documents_delete_authenticated on storage.objects;
create policy documents_member_read on storage.objects
  for select to authenticated
  using ((bucket_id = 'documents'
          and split_part(name, '/', 1) in (select public.app_my_entity_keys()))
      or (bucket_id = 'documents-inbox' and public.app_is_platform_owner()));
create policy documents_member_insert on storage.objects
  for insert to authenticated
  with check ((bucket_id = 'documents'
          and split_part(name, '/', 1) in (select public.app_my_entity_keys()))
      or (bucket_id = 'documents-inbox' and public.app_is_platform_owner()));
create policy documents_member_update on storage.objects
  for update to authenticated
  using ((bucket_id = 'documents'
          and split_part(name, '/', 1) in (select public.app_my_entity_keys()))
      or (bucket_id = 'documents-inbox' and public.app_is_platform_owner()))
  with check ((bucket_id = 'documents'
          and split_part(name, '/', 1) in (select public.app_my_entity_keys()))
      or (bucket_id = 'documents-inbox' and public.app_is_platform_owner()));
create policy documents_manager_delete on storage.objects
  for delete to authenticated
  using ((bucket_id = 'documents'
          and split_part(name, '/', 1) in (
            select public._entity_keys(array(select public.app_my_managed_entities()))))
      or (bucket_id = 'documents-inbox' and public.app_is_platform_owner()));

-- pa_inbox: flat filenames, courier to the PA session. Managers may drop a
-- note (Chef run_agent materialises through the user's session); only the
-- platform owner reads / rewrites. The cron sweep runs as service role.
drop policy if exists pa_inbox_authenticated_insert on storage.objects;
drop policy if exists pa_inbox_authenticated_select on storage.objects;
drop policy if exists pa_inbox_authenticated_update on storage.objects;
create policy pa_inbox_manager_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pa_inbox'
    and (public.app_is_platform_owner() or exists (select 1 from public.app_my_managed_entities())));
create policy pa_inbox_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'pa_inbox' and public.app_is_platform_owner());
create policy pa_inbox_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'pa_inbox' and public.app_is_platform_owner())
  with check (bucket_id = 'pa_inbox' and public.app_is_platform_owner());

------------------------------------------------------------------------------
-- P0-8 · apply_page_info() without tax_id; apply_page_legal() service-only
------------------------------------------------------------------------------
create or replace function public.apply_page_info(p_slug text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'legal_name', coalesce(e.legal_name, e.name),
    'accent', e.accent_color,
    'address_line1', e.address_line1,
    'city', e.city,
    'postal_code', e.postal_code,
    'country', e.country,
    'brand_kit', (select jsonb_build_object(
                    'palette', bk.palette,
                    'typography', bk.typography)
                  from public.brand_kits bk where bk.entity_id = e.id),
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'station', o.station,
                  'role', o.role, 'languages_required', o.languages_required) order by o.created_at desc)
                  from public.job_openings o where o.entity_id = e.id and o.status = 'open'), '[]'::jsonb))
  from public.entities e
  where e.slug = p_slug and coalesce(e.hiring_enabled, true) and coalesce(e.is_active, true);
$function$;

create or replace function public.apply_page_legal(p_slug text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('id', e.id, 'legal_name', coalesce(e.legal_name, e.name), 'tax_id', e.tax_id)
  from public.entities e
  where e.slug = p_slug and coalesce(e.hiring_enabled, true) and coalesce(e.is_active, true);
$function$;
revoke execute on function public.apply_page_legal(text) from public, anon, authenticated;
grant execute on function public.apply_page_legal(text) to service_role;

