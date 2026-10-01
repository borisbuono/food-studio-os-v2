-- 20261002_invite_cook_path.sql — the cook's first-day path (TO_BORIS_cook_preflight_2026-10-02).
--
-- 1. pending_invites carries what the Invite sheet collects (name, phone,
--    language, area) so the accepted person arrives with a name and a language,
--    not just an email.
-- 2. memberships.can_receive — Boris's per-person flag: a cook/foh who receives
--    deliveries sees the Supplies verb. Default false. Managers/owners always see it.
-- 3. accept_pending_invite():
--    · roles cook | foh (new, from the Invite sheet) next to the onboarding
--      wizard's owner | manager | chef | waiter | office;
--    · CLAIMS an existing team_members row by email (the invite row the sheet
--      wrote, or a seeded roster row) instead of inserting a second person —
--      sets auth_user_id, status=active, first_login_at; the Team tab and the
--      clock kiosk then show one person once (preflight 5b);
--    · stamps operator_entity_id / default_restaurant_id / language on the
--      person row so RLS and the kiosk roster see them;
--    · returns the invite's language so /invite/accept can set fs_lang.

alter table public.pending_invites
  add column if not exists name     text,
  add column if not exists phone    text,
  add column if not exists language text,
  add column if not exists area     text;

alter table public.memberships
  add column if not exists can_receive boolean not null default false;

comment on column public.memberships.can_receive is
  'Boris flag 2026-10-02: a cook/foh who receives deliveries sees the Supplies verb. Managers/owners see it regardless.';

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

  -- Invite role → (team_members.default_role, memberships.role, area).
  -- team_members.default_role is check-constrained to worker|chef|maitre|manager|owner;
  -- memberships.role is free text and is what lib/memberships.ts roleAreaToRoom reads.
  tm_role := case inv.role
               when 'owner'   then 'owner'
               when 'manager' then 'manager'
               when 'office'  then 'manager'
               when 'chef'    then 'chef'
               when 'waiter'  then 'maitre'
               else 'worker' end;                 -- cook, foh
  m_role  := case inv.role when 'office' then 'manager' else inv.role end;
  ar      := case inv.role
               when 'chef' then 'boh' when 'cook' then 'boh'
               when 'waiter' then 'foh' when 'foh' then 'foh'
               else coalesce(nullif(inv.area, ''), 'admin') end;
  inv_lang := case when inv.language in ('es', 'en', 'nl') then inv.language else null end;

  select r.id into rid from public.restaurants r where r.entity_id = inv.entity_id and coalesce(r.is_active, true) order by r.created_at limit 1;

  -- 1. The person already signed in before → their row.
  select tm.id into pid from public.team_members tm where tm.auth_user_id = uid order by tm.created_at nulls last limit 1;

  -- 2. Else claim the invite/seed row with this email (prefer this house's row).
  if pid is null then
    select tm.id into pid from public.team_members tm
      where lower(tm.email) = my_email and tm.auth_user_id is null and coalesce(tm.status, 'invited') <> 'removed'
      order by (tm.operator_entity_id = inv.entity_id) desc, tm.created_at nulls last
      limit 1;
    if pid is not null then
      update public.team_members tm
         set auth_user_id = uid,
             status = 'active',
             first_login_at = coalesce(tm.first_login_at, now()),
             last_login_at = now(),
             operator_entity_id = coalesce(tm.operator_entity_id, inv.entity_id),
             default_restaurant_id = coalesce(tm.default_restaurant_id, rid),
             language = coalesce(inv_lang, tm.language)
       where tm.id = pid;
    end if;
  end if;

  -- 3. Else a new person.
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
  end if;

  select exists (select 1 from public.memberships m where m.person_id = pid and m.status = 'active' and m.entity_id <> inv.entity_id) into has_other;

  insert into public.memberships (person_id, entity_id, role, area, status, is_default)
  values (pid, inv.entity_id, m_role, ar, 'active', not has_other)
  on conflict (person_id, entity_id) do update
    set role = excluded.role, area = excluded.area, status = 'active';

  update public.pending_invites pi set accepted_at = coalesce(pi.accepted_at, now()), accepted_by = uid where pi.id = inv.id;

  return query
    select 'ok'::text, inv.entity_id,
           (select e.slug from public.entities e where e.id = inv.entity_id),
           coalesce(inv_lang, (select tm.language from public.team_members tm where tm.id = pid));
end $$;

revoke all on function public.accept_pending_invite(text) from public, anon;
grant execute on function public.accept_pending_invite(text) to authenticated;
