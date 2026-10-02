-- =====================================================================
-- Security hardening S3 (2026-10-02) — one answer to "which person is this
-- login", used by every RLS helper, and the join flow finishing on it.
--
-- The problem. A person (team_members row) can hold more than one login
-- (Task #50, person_auth_link, 21-09). fn_person_ids_for_uid() already knew
-- that, and lib/memberships.ts used it — but the RLS helpers behind every
-- policy (current_person_entities, app_my_managed_entities,
-- app_is_platform_owner, app_my_scope_entities, app_my_person_ids) still
-- did `team_members.auth_user_id = auth.uid()`. So a second login for the
-- same person — Boris's boris@ibzfoodstudio.com — passed the app's
-- resolution and then read 0 rows under RLS ("has no membership and sees
-- nothing", rls_phase35 21-09).
--
-- 1. app_person_ids_for_uid_raw(uid) — THE resolver. team_members.auth_user_id
--    = uid, UNION person_auth_link rows (can_sign_in) claimed by this uid or
--    whose email equals this login's verified auth email. Removed/archived
--    people never resolve. Internal: EXECUTE revoked from anon/authenticated;
--    the definer helpers call it.
-- 2. app_my_person_ids() = raw(auth.uid()). fn_person_ids_for_uid(uid) keeps
--    its guard (self or platform owner) and delegates. The five core helpers
--    and the feature functions that looked a person up by auth_user_id
--    (_swap_log, fn_swap_claim, tg_recipes_guard, offer_interview_slots,
--    gcal_save_tokens, gcal_replace_external, gcal_disconnect) go through
--    app_my_person_ids().
-- 3. Policies on team_members / memberships / referrals that compared
--    auth_user_id directly use app_my_person_ids().
-- 4. accept_pending_invite(): resolves the caller's existing person first
--    (primary login OR linked alias), then claims the roster row by email,
--    then creates one; records the login in person_auth_link on accept so
--    the next sign-in from that address resolves without a lookup by email.
--    Invites may name a person (pending_invites.person_id): a manager
--    inviting someone already on the roster — the seeded
--    name+bm@ibzfoodstudio.com rows — binds the real address to THAT row
--    instead of creating a second person.
-- 5. Data: person_auth_link rows get the auth user whose email they carry
--    (boris@ibzfoodstudio.com → the second auth user; borisbuono@gmail.com
--    recorded as the primary); team_members.auth_user_id backfilled where
--    an active roster row's email matches an auth user (0 rows today — the
--    staff have never signed in; only two auth users exist).
--
-- Additive. Rollback: 20261002_security_s3_person_resolution_ROLLBACK.sql
-- (functions + policies restored from rls_audit snapshots).
-- =====================================================================

create schema if not exists rls_audit;

create table if not exists rls_audit.functions_before_20261002_s3 as
  select now() as snapshot_at, p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.proname in ('app_my_person_ids','fn_person_ids_for_uid','current_person_entities','app_my_managed_entities',
                       'app_is_platform_owner','app_my_scope_entities','_swap_log','fn_swap_claim','tg_recipes_guard',
                       'offer_interview_slots','gcal_save_tokens','gcal_replace_external','gcal_disconnect','accept_pending_invite');

create table if not exists rls_audit.policies_before_20261002_s3 as
  select now() as snapshot_at, * from pg_policies
   where schemaname = 'public' and tablename in ('team_members','memberships','referrals');

-- ---------------------------------------------------------------------
-- 1. The resolver
-- ---------------------------------------------------------------------
create or replace function public.app_person_ids_for_uid_raw(p_uid uuid)
returns setof uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select tm.id
    from public.team_members tm
   where p_uid is not null
     and tm.auth_user_id = p_uid
     and coalesce(tm.status, 'active') not in ('removed', 'archived')
  union
  select l.person_id
    from public.person_auth_link l
    join public.team_members tm on tm.id = l.person_id
   where p_uid is not null
     and coalesce(tm.status, 'active') not in ('removed', 'archived')
     and l.can_sign_in
     and (
       l.auth_user_id = p_uid
       or (l.auth_user_id is null
           and lower(l.email) = (select lower(u.email) from auth.users u where u.id = p_uid))
     );
$$;
revoke all on function public.app_person_ids_for_uid_raw(uuid) from public, anon, authenticated;
comment on function public.app_person_ids_for_uid_raw(uuid) is
  'S3 2026-10-02: every team_members row a login IS — primary auth_user_id or a person_auth_link (claimed, or by verified email while unclaimed). Internal; call app_my_person_ids() or fn_person_ids_for_uid().';

create or replace function public.app_my_person_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.app_person_ids_for_uid_raw(auth.uid());
$$;

create or replace function public.fn_person_ids_for_uid(uid uuid)
returns setof uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select r
    from public.app_person_ids_for_uid_raw(uid) r
   where auth.uid() is null or uid = auth.uid() or public.app_is_platform_owner();
$$;

-- ---------------------------------------------------------------------
-- 2. Core helpers — person first, then memberships
-- ---------------------------------------------------------------------
create or replace function public.current_person_entities()
returns setof uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select m.entity_id
    from public.memberships m
   where m.person_id in (select public.app_my_person_ids())
     and m.status = 'active';
$$;

create or replace function public.app_my_managed_entities()
returns setof uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select m.entity_id
    from public.memberships m
   where m.person_id in (select public.app_my_person_ids())
     and m.status = 'active'
     and lower(coalesce(m.role, '')) in ('owner','manager','gm','admin','director','operator');
$$;

create or replace function public.app_is_platform_owner()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from public.memberships m
      join public.entities e on e.id = m.entity_id
     where m.person_id in (select public.app_my_person_ids())
       and m.status = 'active'
       and m.role = 'owner'
       and e.slug = 'holdings');
$$;

create or replace function public.app_my_scope_entities()
returns setof uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with mine as (
    select m.entity_id, lower(coalesce(m.role,'')) as role
      from public.memberships m
     where m.person_id in (select public.app_my_person_ids())
       and m.status = 'active'
  ),
  owns_holding as (
    select exists (
      select 1 from mine j join public.entities e on e.id = j.entity_id
       where j.role = 'owner' and e.entity_type = 'holding_company'
    ) as v
  )
  select entity_id from mine
  union
  select p.parent_entity_id from public.entities p
   where p.id in (select entity_id from mine where role = 'owner')
     and p.parent_entity_id is not null
  union
  select c.id from public.entities c
   where c.entity_type not in ('operating_venue','operating')
     and c.parent_entity_id in (
       select p.parent_entity_id from public.entities p
        where p.id in (select entity_id from mine where role = 'owner')
     )
  union
  select c2.id from public.entities c2, owns_holding
   where owns_holding.v
     and c2.entity_type not in ('operating_venue','operating');
$$;

-- ---------------------------------------------------------------------
-- 3. Feature functions that looked "me" up by auth_user_id
-- ---------------------------------------------------------------------
create or replace function public._swap_log(p_swap uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language sql security definer
set search_path to 'public', 'pg_temp'
as $$
  insert into public.shift_swap_log (swap_id, action, actor, person_id, detail)
  values (p_swap, p_action, auth.uid(),
          (select tm.id from public.team_members tm where tm.id in (select public.app_my_person_ids()) order by tm.created_at limit 1),
          coalesce(p_detail, '{}'::jsonb));
$$;

create or replace function public.fn_swap_claim(p_swap uuid)
returns public.shift_swaps
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare sw public.shift_swaps; rs public.rota_shifts; me uuid; my_role text; my_area text; ok boolean := false;
begin
  select * into sw from public.shift_swaps where id = p_swap;
  if sw.id is null then raise exception 'swap not found'; end if;
  if sw.status <> 'offered' then raise exception 'this shift is no longer open'; end if;
  select * into rs from public.rota_shifts where id = sw.shift_id;
  if public._rota_shift_start(rs.id) <= now() then raise exception 'the shift has already started'; end if;
  select tm.id into me from public.team_members tm join public.memberships m on m.person_id = tm.id and m.entity_id = sw.entity_id and m.status = 'active'
   where tm.id in (select public.app_my_person_ids()) limit 1;
  if me is null then raise exception 'you are not on this team'; end if;
  if me = sw.from_person then raise exception 'you cannot take your own shift'; end if;
  select lower(coalesce(m.role, tm.default_role, '')), lower(coalesce(m.area, tm.default_area, '')) into my_role, my_area
    from public.memberships m join public.team_members tm on tm.id = m.person_id where m.person_id = me and m.entity_id = sw.entity_id limit 1;
  ok := (my_area <> '' and my_area = rs.area)
     or (rs.role is not null and my_role <> '' and my_role = lower(rs.role))
     or (my_area = '' and rs.role is null);
  if not ok then raise exception 'this shift needs % — your role is %', coalesce(rs.role, upper(rs.area)), coalesce(nullif(my_role, ''), 'not set'); end if;
  if exists (select 1 from public.rota_shifts x where x.person_id = me and x.service_date = rs.service_date and x.status <> 'cancelled' and x.entity_id = rs.entity_id
               and x.start_time < rs.end_time and x.end_time > rs.start_time) then
    raise exception 'you already work that service';
  end if;
  update public.shift_swaps set to_person = me, status = 'claimed', claimed_at = now(), updated_at = now() where id = sw.id returning * into sw;
  perform public._swap_log(sw.id, 'claimed', jsonb_build_object('to_person', me));
  return sw;
end $$;

create or replace function public.tg_recipes_guard()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'UPDATE' and old.origin_recipe_id is not null
     and coalesce(current_setting('app.recipe_sync', true), 'off') <> 'on'
     and (old.name, old.method, old.description, old.story, old.prep_minutes, old.cook_minutes, old.difficulty)
         is distinct from (new.name, new.method, new.description, new.story, new.prep_minutes, new.cook_minutes, new.difficulty) then
    raise exception 'recipe % is a mirror — edit the origin recipe', old.id using errcode = '42501';
  end if;

  if (tg_op = 'INSERT' and (new.is_public or new.public_slug is not null))
     or (tg_op = 'UPDATE' and (new.is_public is distinct from old.is_public or new.public_slug is distinct from old.public_slug)) then
    if not exists (
      select 1 from public.memberships m
       where m.person_id in (select public.app_my_person_ids()) and m.status = 'active' and lower(m.role) = 'owner'
         and m.entity_id = new.entity_id) then
      raise exception 'only an owner can publish a recipe' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.offer_interview_slots(p_candidate uuid, p_interviewer uuid default null::uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare c record; pid uuid; bslug text; tok uuid := gen_random_uuid();
begin
  select id, entity_id, name into c from public.candidates where id = p_candidate;
  if not found or c.entity_id not in (select public.current_person_entities()) then
    raise exception 'not your candidate' using errcode = '42501';
  end if;
  pid := coalesce(p_interviewer, (select id from public.team_members where id in (select public.app_my_person_ids()) order by created_at limit 1));
  select slug into bslug from public.booking_profiles where person_id = pid and active;
  if bslug is null then
    return jsonb_build_object('ok', false, 'error', 'no_booking_profile');
  end if;
  update public.candidates set interview_token = tok, interview_offered_at = now(), updated_at = now() where id = p_candidate;
  return jsonb_build_object('ok', true, 'token', tok, 'slug', bslug, 'candidate_name', c.name, 'interviewer', pid);
end $$;

create or replace function public.gcal_save_tokens(p_refresh text, p_access text, p_expires timestamp with time zone, p_scopes text[], p_email text)
returns uuid
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare pid uuid;
begin
  select id into pid from public.team_members where id in (select public.app_my_person_ids()) order by created_at limit 1;
  if pid is null then raise exception 'no team member for this user' using errcode = '42501'; end if;
  insert into public.google_calendar_tokens (person_id, auth_user_id, google_email, refresh_token, access_token,
                                            access_expires_at, scopes, connected_at, last_error)
  values (pid, auth.uid(), p_email, p_refresh, p_access, p_expires, coalesce(p_scopes,'{}'), now(), null)
  on conflict (person_id) do update set
    auth_user_id = excluded.auth_user_id, google_email = excluded.google_email,
    refresh_token = coalesce(nullif(excluded.refresh_token,''), google_calendar_tokens.refresh_token),
    access_token = excluded.access_token, access_expires_at = excluded.access_expires_at,
    scopes = excluded.scopes, connected_at = now(), last_error = null;
  return pid;
end $$;

create or replace function public.gcal_replace_external(p_person uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_events jsonb, p_access text default null::text, p_expires timestamp with time zone default null::timestamp with time zone, p_error text default null::text)
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare n int := 0; is_service boolean := coalesce(auth.role(),'') = 'service_role';
begin
  if not is_service and not exists (select 1 from public.team_members where id = p_person and id in (select public.app_my_person_ids())) then
    raise exception 'not your calendar' using errcode = '42501';
  end if;
  update public.google_calendar_tokens set
    access_token = coalesce(p_access, access_token), access_expires_at = coalesce(p_expires, access_expires_at),
    last_synced_at = case when p_error is null then now() else last_synced_at end, last_error = p_error
   where person_id = p_person;
  if p_error is not null or p_events is null then return 0; end if;
  delete from public.events
   where source_type = 'external' and person_ids = array[p_person]
     and start_ts < p_to and coalesce(end_ts, start_ts) >= p_from;
  insert into public.events (source_type, source_id, entity_id, title, start_ts, end_ts, all_day, location,
                             person_ids, external_ref, colour, status, created_by)
  select 'external', null, null, left(coalesce(nullif(x->>'title',''), 'Busy'), 200),
         (x->>'start')::timestamptz, nullif(x->>'end','')::timestamptz, coalesce((x->>'all_day')::boolean, false),
         left(x->>'location', 200), array[p_person], 'gcal:' || p_person || ':' || (x->>'id'), '#9AA3AB', 'busy',
         (select auth_user_id from public.team_members where id = p_person)
    from jsonb_array_elements(p_events) x
   where x->>'id' is not null and x->>'start' is not null
  on conflict (external_ref) where external_ref is not null do update set
    title = excluded.title, start_ts = excluded.start_ts, end_ts = excluded.end_ts,
    all_day = excluded.all_day, location = excluded.location;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.gcal_disconnect()
returns void
language sql security definer
set search_path to 'public', 'pg_temp'
as $$
  delete from public.events e using public.team_members t
   where e.source_type = 'external' and t.id in (select public.app_my_person_ids()) and e.person_ids = array[t.id];
  delete from public.google_calendar_tokens where auth_user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- 4. Policies that compared auth_user_id directly
-- ---------------------------------------------------------------------
drop policy if exists rls35_memberships_select on public.memberships;
create policy rls35_memberships_select on public.memberships for select to authenticated
  using (person_id in (select public.app_my_person_ids())
         or entity_id in (select public.current_person_entities()));

drop policy if exists rls36_team_members_select on public.team_members;
create policy rls36_team_members_select on public.team_members for select to authenticated
  using (id in (select public.app_my_person_ids())
         or operator_entity_id in (select public.current_person_entities())
         or id in (select public.app_my_roster_person_ids()));

drop policy if exists rls36_team_members_update on public.team_members;
create policy rls36_team_members_update on public.team_members for update to authenticated
  using (id in (select public.app_my_person_ids())
         or operator_entity_id in (select public.app_my_managed_entities())
         or id in (select public.app_my_managed_roster_person_ids()))
  with check (id in (select public.app_my_person_ids())
         or operator_entity_id in (select public.app_my_managed_entities())
         or id in (select public.app_my_managed_roster_person_ids()));

drop policy if exists rls36_team_members_delete on public.team_members;
create policy rls36_team_members_delete on public.team_members for delete to authenticated
  using (id not in (select public.app_my_person_ids())
         and (operator_entity_id in (select public.app_my_managed_entities())
              or id in (select public.app_my_managed_roster_person_ids())));

drop policy if exists referrals_self_read on public.referrals;
create policy referrals_self_read on public.referrals for select to authenticated
  using (referrer_person_id in (select public.app_my_person_ids()));

drop policy if exists referrals_owner_read on public.referrals;
create policy referrals_owner_read on public.referrals for select to authenticated
  using (exists (select 1 from public.team_members tm
                  where tm.id in (select public.app_my_person_ids())
                    and tm.default_role = 'owner' and tm.status = 'active'));

-- ---------------------------------------------------------------------
-- 5. accept_pending_invite — finish on the resolver, record the login
-- ---------------------------------------------------------------------
alter table public.pending_invites
  add column if not exists person_id uuid references public.team_members(id) on delete set null;
comment on column public.pending_invites.person_id is
  'S3 2026-10-02: the roster row this invite is FOR (a manager inviting someone already on the roster). accept binds the login to this person instead of creating a second one.';

create or replace function public._membership_role_rank(p_role text)
returns int
language sql immutable
as $$
  select case lower(coalesce(p_role, ''))
           when 'owner' then 4
           when 'manager' then 3 when 'gm' then 3 when 'admin' then 3 when 'director' then 3 when 'operator' then 3 when 'office' then 3
           when 'chef' then 2 when 'maitre' then 2
           else 1 end;
$$;

drop function if exists public.accept_pending_invite(text);

create or replace function public.accept_pending_invite(p_token text)
returns table (status text, house_id uuid, house_slug text, lang text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  inv record;
  pid uuid;
  pid_primary boolean := false;
  tm_role text;
  m_role text;
  ar text;
  rid uuid;
  inv_lang text;
  has_other boolean;
begin
  if uid is null then
    return query select 'unauthenticated'::text, null::uuid, null::text, null::text; return;
  end if;

  select * into inv from public.pending_invites where token = p_token limit 1;
  if inv.id is null then
    return query select 'not_found'::text, null::uuid, null::text, null::text; return;
  end if;
  if lower(inv.email) <> my_email then
    return query select 'wrong_account'::text, null::uuid, null::text, null::text; return;
  end if;
  if inv.accepted_at is not null and inv.accepted_by is not null and inv.accepted_by <> uid then
    return query select 'used'::text, null::uuid, null::text, null::text; return;
  end if;
  if inv.accepted_at is null and inv.expires_at is not null and inv.expires_at < now() then
    return query select 'expired'::text, null::uuid, null::text, null::text; return;
  end if;

  tm_role := case inv.role
               when 'owner'   then 'owner'
               when 'manager' then 'manager'
               when 'office'  then 'manager'
               when 'chef'    then 'chef'
               when 'waiter'  then 'maitre'
               else 'worker' end;
  m_role  := case inv.role when 'office' then 'manager' else inv.role end;
  ar      := case inv.role
               when 'chef' then 'boh' when 'cook' then 'boh'
               when 'waiter' then 'foh' when 'foh' then 'foh'
               else coalesce(nullif(inv.area, ''), 'admin') end;
  inv_lang := case when inv.language in ('es', 'en', 'nl') then inv.language else null end;

  select r.id into rid from public.restaurants r where r.entity_id = inv.entity_id and coalesce(r.is_active, true) order by r.created_at limit 1;

  -- (a) The invite names a roster row: that person, provided nobody else's
  --     login already owns it.
  if inv.person_id is not null then
    select tm.id into pid from public.team_members tm
     where tm.id = inv.person_id
       and coalesce(tm.status, 'invited') <> 'removed'
       and (tm.auth_user_id is null or tm.auth_user_id = uid
            or tm.id in (select public.app_person_ids_for_uid_raw(uid)));
  end if;

  -- (b) The login already IS a person (primary auth_user_id, or a linked alias).
  if pid is null then
    select p into pid
      from public.app_person_ids_for_uid_raw(uid) p
     order by (exists (select 1 from public.team_members tm where tm.id = p and tm.auth_user_id = uid)) desc,
              (exists (select 1 from public.team_members tm where tm.id = p and tm.operator_entity_id = inv.entity_id)) desc
     limit 1;
  end if;

  -- (c) A roster row with this email and no login yet (the invite's row, or a seeded one).
  if pid is null then
    select tm.id into pid from public.team_members tm
      where lower(tm.email) = my_email and tm.auth_user_id is null and coalesce(tm.status, 'invited') <> 'removed'
      order by (tm.operator_entity_id = inv.entity_id) desc, tm.created_at nulls last
      limit 1;
  end if;

  if pid is not null then
    -- Claim: the row becomes this login's if it has none; otherwise the login
    -- is recorded as a second address for the same person (person_auth_link).
    update public.team_members tm
       set auth_user_id = coalesce(tm.auth_user_id, uid),
           status = 'active',
           first_login_at = coalesce(tm.first_login_at, now()),
           last_login_at = now(),
           operator_entity_id = coalesce(tm.operator_entity_id, inv.entity_id),
           default_restaurant_id = coalesce(tm.default_restaurant_id, rid),
           language = coalesce(inv_lang, tm.language)
     where tm.id = pid;
    select (tm.auth_user_id = uid) into pid_primary from public.team_members tm where tm.id = pid;
  end if;

  -- (d) Nobody: a new person.
  if pid is null then
    insert into public.team_members (auth_user_id, name, email, phone, status, default_role, default_area,
                                     operator_entity_id, default_restaurant_id, language, invited_by, invited_at, first_login_at, last_login_at)
    values (uid,
            coalesce(nullif(inv.name, ''),
                     (select coalesce(nullif(au.raw_user_meta_data->>'full_name',''), nullif(au.raw_user_meta_data->>'name','')) from auth.users au where au.id = uid),
                     my_email),
            my_email, nullif(inv.phone, ''), 'active', tm_role,
            case when ar in ('foh','boh','admin') then ar else 'admin' end,
            inv.entity_id, rid, coalesce(inv_lang, 'es'), inv.invited_by, inv.created_at, now(), now())
    returning id into pid;
    pid_primary := true;
  end if;

  -- The login is now on record for this person. Unique on lower(email): if the
  -- address is already linked (to this or another person) only fill a missing uid.
  insert into public.person_auth_link (person_id, auth_user_id, email, is_primary, can_sign_in, note, linked_by)
  values (pid, uid, my_email,
          pid_primary and not exists (select 1 from public.person_auth_link l where l.person_id = pid and l.is_primary and l.auth_user_id is not null and l.auth_user_id <> uid),
          true, 'invite accepted ' || current_date::text, uid)
  on conflict (lower(email)) do update
    set auth_user_id = coalesce(public.person_auth_link.auth_user_id, excluded.auth_user_id);

  select exists (select 1 from public.memberships m where m.person_id = pid and m.status = 'active' and m.entity_id <> inv.entity_id) into has_other;

  -- An invite never DOWNGRADES an existing membership: an owner who accepts a
  -- cook invite to their own house (Boris testing with his second address)
  -- stays owner. Rank: owner > manager-grade > chef/maitre > cook/foh/worker.
  insert into public.memberships (person_id, entity_id, role, area, status, is_default)
  values (pid, inv.entity_id, m_role, ar, 'active', not has_other)
  on conflict (person_id, entity_id) do update
    set role = case when public._membership_role_rank(public.memberships.role) >= public._membership_role_rank(excluded.role)
                      and public.memberships.status = 'active'
                    then public.memberships.role else excluded.role end,
        area = case when public._membership_role_rank(public.memberships.role) >= public._membership_role_rank(excluded.role)
                      and public.memberships.status = 'active'
                    then coalesce(public.memberships.area, excluded.area) else excluded.area end,
        status = 'active';

  update public.pending_invites pi set accepted_at = coalesce(pi.accepted_at, now()), accepted_by = uid where pi.id = inv.id;

  return query
    select 'ok'::text, inv.entity_id,
           (select e.slug from public.entities e where e.id = inv.entity_id),
           coalesce(inv_lang, (select tm.language from public.team_members tm where tm.id = pid));
end $$;

grant execute on function public.accept_pending_invite(text) to authenticated;
revoke execute on function public.accept_pending_invite(text) from anon;

-- ---------------------------------------------------------------------
-- 6. Data
-- ---------------------------------------------------------------------
-- 6a. A person_auth_link row carries ONE address; its auth_user_id is the auth
--     user with that address. The 21-09 merge wrote Boris's gmail uid on the
--     boris@ibzfoodstudio.com alias row — repoint it to the auth user that
--     actually signs in with that address and record the gmail as primary.
update public.person_auth_link l
   set auth_user_id = u.id,
       note = coalesce(l.note, '') || ' · S3 2026-10-02: uid set to the auth user with this address'
  from auth.users u
 where lower(u.email) = lower(l.email)
   and l.can_sign_in
   and l.auth_user_id is distinct from u.id;

insert into public.person_auth_link (person_id, auth_user_id, email, is_primary, can_sign_in, note)
select tm.id, tm.auth_user_id, lower(u.email), true, true, 'primary login · S3 backfill 2026-10-02'
  from public.team_members tm
  join auth.users u on u.id = tm.auth_user_id
 where tm.auth_user_id is not null
   and coalesce(tm.status, 'active') not in ('removed', 'archived')
   and not exists (select 1 from public.person_auth_link l where lower(l.email) = lower(u.email))
on conflict do nothing;

-- A person has at most one primary link.
update public.person_auth_link l
   set is_primary = false
 where l.is_primary
   and exists (select 1 from public.team_members tm where tm.id = l.person_id and tm.auth_user_id is not null and tm.auth_user_id <> l.auth_user_id);

-- 6b. team_members.auth_user_id where an active roster row's email is an auth user's.
update public.team_members tm
   set auth_user_id = u.id,
       first_login_at = coalesce(tm.first_login_at, u.last_sign_in_at),
       last_login_at = coalesce(u.last_sign_in_at, tm.last_login_at)
  from auth.users u
 where tm.auth_user_id is null
   and coalesce(tm.status, 'active') not in ('removed', 'archived')
   and lower(tm.email) = lower(u.email)
   and not exists (select 1 from public.team_members x where x.auth_user_id = u.id);

-- 6c. Indexes the resolver leans on (lower(email) on the link table is already unique).
create index if not exists person_auth_link_person_signin_idx on public.person_auth_link (person_id) where can_sign_in;
create index if not exists pending_invites_person_idx on public.pending_invites (person_id) where person_id is not null;
