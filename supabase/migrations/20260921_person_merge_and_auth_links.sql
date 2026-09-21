-- 20260921_person_merge_and_auth_links.sql
-- Tasks #35 (duplicate people) + #50 (one person, several login emails).
-- APPLIED to prod 2026-09-21 via Supabase apply_migration.
--
-- The duplicates are not data-entry errors: the roster was built one row per
-- venue (julieta+bm@ / julieta+taller@). The merge keeps BOTH memberships on
-- one person and turns the second email into a login alias. The loser row is
-- marked 'removed' with metadata.merged_into — never deleted, so it reverses.

create table if not exists public.person_auth_link (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.team_members(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  email text not null,
  is_primary boolean not null default false,
  can_sign_in boolean not null default true,
  note text,
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id)
);

create unique index if not exists person_auth_link_email_uniq on public.person_auth_link (lower(email));
create unique index if not exists person_auth_link_person_auth_uniq on public.person_auth_link (person_id, auth_user_id) where auth_user_id is not null;
create index if not exists person_auth_link_person on public.person_auth_link (person_id);
create index if not exists person_auth_link_auth on public.person_auth_link (auth_user_id);

alter table public.person_auth_link enable row level security;

drop policy if exists person_auth_link_self_read on public.person_auth_link;
create policy person_auth_link_self_read on public.person_auth_link
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or person_id in (select id from public.team_members where auth_user_id = auth.uid())
    or public.current_person_is_owner()
  );

drop policy if exists person_auth_link_owner_write on public.person_auth_link;
create policy person_auth_link_owner_write on public.person_auth_link
  for all to authenticated
  using (public.current_person_is_owner())
  with check (public.current_person_is_owner());

-- Resolver: every team_members row this auth user IS.
--   1. team_members.auth_user_id (the original path)
--   2. person_auth_link rows claimed by this uid
--   3. person_auth_link rows whose email matches this uid's auth email but
--      that have not been claimed yet (a second Google account signing in for
--      the first time). can_sign_in = false blocks that path — used for shared
--      mailboxes like info@, which must never become somebody's identity.
create or replace function public.fn_person_ids_for_uid(uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select tm.id
    from public.team_members tm
   where tm.auth_user_id = uid
     and coalesce(tm.status, 'active') not in ('removed', 'archived')
  union
  select l.person_id
    from public.person_auth_link l
    join public.team_members tm on tm.id = l.person_id
   where coalesce(tm.status, 'active') not in ('removed', 'archived')
     and l.can_sign_in
     and (
       l.auth_user_id = uid
       or lower(l.email) = (select lower(u.email) from auth.users u where u.id = uid)
     );
$$;

grant execute on function public.fn_person_ids_for_uid(uuid) to authenticated, anon, service_role;

-- The three access helpers now resolve through fn_person_ids_for_uid, so a
-- second login sees the same houses as the first.
create or replace function public.fn_is_entity_member(uid uuid, ent uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.memberships m
     where m.person_id in (select public.fn_person_ids_for_uid(uid))
       and m.entity_id = ent and m.status = 'active'
  );
$$;

create or replace function public.fn_is_entity_manager(uid uuid, ent uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.memberships m
     where m.person_id in (select public.fn_person_ids_for_uid(uid))
       and m.entity_id = ent and m.status = 'active'
       and lower(coalesce(m.role, '')) in ('owner','manager','gm','admin','director','operator')
  );
$$;

create or replace function public.current_person_is_owner()
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.memberships m
     where m.person_id in (select public.fn_person_ids_for_uid(auth.uid()))
       and m.role = 'owner' and m.status = 'active'
  );
$$;

-- Backfill: one primary link per live team_members row with an email.
insert into public.person_auth_link (person_id, auth_user_id, email, is_primary, note)
select distinct on (lower(tm.email))
       tm.id, tm.auth_user_id, tm.email, true, 'backfill 2026-09-21'
  from public.team_members tm
 where tm.email is not null
   and coalesce(tm.status, 'active') not in ('removed', 'archived')
 order by lower(tm.email),
          (tm.auth_user_id is not null) desc,
          tm.last_login_at desc nulls last,
          tm.created_at asc
on conflict do nothing;

-- Merge two team_members rows into one person.
-- p_link_email = false for shared mailboxes (info@): the address stays on the
-- record as a note, with sign-in disabled.
create or replace function public.fn_person_merge(
  p_survivor uuid,
  p_loser uuid,
  p_link_email boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s public.team_members;
  l public.team_members;
  moved_memberships int := 0;
  ended_memberships int := 0;
  moved_shifts int := 0;
  moved_candidates int := 0;
  moved_other int := 0;
  n int;
begin
  if auth.uid() is not null and not public.current_person_is_owner() then
    raise exception 'fn_person_merge: owner only';
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
     set person_id = p_survivor, is_default = false, updated_at = now()
   where m.person_id = p_loser
     and not exists (
       select 1 from public.memberships x
        where x.person_id = p_survivor and x.entity_id = m.entity_id
          and x.role = m.role and x.status = 'active'
     );
  get diagnostics moved_memberships = row_count;

  update public.memberships m
     set status = 'merged',
         ended_at = coalesce(m.ended_at, current_date),
         notes = trim(both ' ' from coalesce(m.notes, '') || ' [merged into ' || p_survivor::text || ' 2026-09-21]'),
         updated_at = now()
   where m.person_id = p_loser and m.status = 'active';
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
        where b.person_id = p_survivor and b.work_type = a.work_type
          and b.work_id = a.work_id and b.contribution_type = a.contribution_type
     );
  get diagnostics n = row_count; moved_other := moved_other + n;
  delete from public.authored_by where person_id = p_loser;

  -- rows keyed on the auth user: shifts worked and candidates owned by the
  -- loser's login now answer to the survivor's login.
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
  values (p_survivor, s.auth_user_id, s.email, true, 'survivor 2026-09-21')
  on conflict do nothing;

  if l.email is not null then
    insert into public.person_auth_link (person_id, auth_user_id, email, is_primary, can_sign_in, note)
    values (p_survivor, l.auth_user_id, l.email, false, p_link_email,
            case when p_link_email then 'merged alias 2026-09-21'
                 else 'merged 2026-09-21 — shared mailbox, sign-in disabled' end)
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
           'merged_into', p_survivor, 'merged_at', now(),
           'merged_email', l.email, 'merged_auth_user_id', l.auth_user_id
         )
   where id = p_loser;

  return jsonb_build_object(
    'survivor', p_survivor, 'loser', p_loser, 'loser_email', l.email,
    'memberships_moved', moved_memberships, 'memberships_closed', ended_memberships,
    'links_moved', moved_other, 'labor_shifts_relinked', moved_shifts,
    'candidates_relinked', moved_candidates, 'email_can_sign_in', p_link_email
  );
end;
$$;

revoke all on function public.fn_person_merge(uuid, uuid, boolean) from public;
grant execute on function public.fn_person_merge(uuid, uuid, boolean) to authenticated, service_role;
