-- 20260921_onboarding_blockers.sql
-- Fixes from the /onboard stress test (06_PA/_INBOX/TO_BORIS_onboarding_stress_test_2026-09-21.md)
--
-- B3  handle_new_user() read raw_user_meta_data->>'name'; Google/Supabase
--     populate 'full_name'. New users got their email local-part as name.
-- B4  profiles.role defaulted to 'worker' even for the owner who just created
--     a house. Derive it from an active owner membership via trigger, so the
--     promotion happens the moment step 3 writes memberships(role='owner').
--     Only ever promotes 'worker'/NULL → 'owner'; never downgrades, never
--     overrides a role an admin set by hand.

-- ---- B3 -------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare inv record;
begin
  select * into inv from public.team_members
   where lower(email) = lower(new.email)
   order by created_at nulls last limit 1;

  insert into public.profiles (id, name, role, restaurant_id)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      inv.name,
      split_part(new.email,'@',1)
    ),
    coalesce(inv.default_role, new.raw_user_meta_data->>'role', 'worker'),
    inv.default_restaurant_id
  )
  on conflict (id) do nothing;

  if inv.id is not null then
    update public.team_members
       set status = 'active',
           first_login_at = coalesce(first_login_at, now()),
           last_login_at = now()
     where id = inv.id;
  end if;

  return new;
end;
$function$;

-- Repair profiles already created with the email local-part as name while
-- auth metadata carries a real full_name.
update public.profiles p
   set name = u.raw_user_meta_data->>'full_name'
  from auth.users u
 where u.id = p.id
   and coalesce(u.raw_user_meta_data->>'full_name', '') <> ''
   and p.name = split_part(u.email, '@', 1);

-- ---- B4 -------------------------------------------------------------------
create or replace function public.sync_profile_role_from_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.role = 'owner' and coalesce(new.status, 'active') = 'active' then
    update public.profiles p
       set role = 'owner'
      from public.team_members tm
     where tm.id = new.person_id
       and tm.auth_user_id = p.id
       and coalesce(p.role, 'worker') = 'worker';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_memberships_sync_profile_role on public.memberships;
create trigger trg_memberships_sync_profile_role
  after insert or update of role, status on public.memberships
  for each row execute function public.sync_profile_role_from_membership();

-- Backfill (0 rows on 2026-09-21, kept for other envs).
update public.profiles p
   set role = 'owner'
  from public.team_members tm
  join public.memberships m on m.person_id = tm.id
 where tm.auth_user_id = p.id
   and m.role = 'owner' and m.status = 'active'
   and coalesce(p.role, 'worker') = 'worker';
