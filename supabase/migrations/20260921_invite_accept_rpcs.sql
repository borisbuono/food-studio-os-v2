-- 20260921_invite_accept_rpcs.sql
-- Membership writes for onboarding + team invites, as SECURITY DEFINER RPCs.
--
-- Why: after the Phase 3.5 RLS rollout (same day), memberships INSERT is
-- gated on app_my_managed_entities(). Neither actor qualifies at the moment
-- they need the row — the self-serve owner has just created the entity, and
-- an invitee belongs to nothing yet. Today the leftover permissive policy
-- `memberships_service_write` (ALL / true) still lets writes through; these
-- functions mean onboarding and invites keep working when 3.6 drops it.
--
-- Authorisation lives inside each function:
--   claim_entity_ownership  — caller must be entities.onboarded_by
--   accept_pending_invite   — invite email must equal the caller's JWT email
--
-- Also here: memberships had NO unique index on (person_id, entity_id), so
-- every upsert onConflict('person_id,entity_id') failed with 42P10 inside a
-- best-effort catch. That is why self-serve owners ended up with no
-- membership even after the entity_type fix.

create unique index if not exists memberships_person_entity_uniq
  on public.memberships (person_id, entity_id);

create or replace function public.accept_pending_invite(p_token text)
returns table (status text, house_id uuid, house_slug text)
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
  ar text;
  has_other boolean;
begin
  if uid is null then
    return query select 'unauthenticated'::text, null::uuid, null::text; return;
  end if;

  select * into inv from public.pending_invites where token = p_token limit 1;
  if inv.id is null then
    return query select 'not_found'::text, null::uuid, null::text; return;
  end if;
  if lower(inv.email) <> my_email then
    return query select 'wrong_account'::text, null::uuid, null::text; return;
  end if;
  if inv.accepted_at is not null and inv.accepted_by is not null and inv.accepted_by <> uid then
    return query select 'used'::text, null::uuid, null::text; return;
  end if;
  if inv.accepted_at is null and inv.expires_at is not null and inv.expires_at < now() then
    return query select 'expired'::text, null::uuid, null::text; return;
  end if;

  tm_role := case inv.role when 'waiter' then 'maitre' when 'office' then 'manager'
                           when 'owner' then 'owner' when 'manager' then 'manager'
                           when 'chef' then 'chef' else 'worker' end;
  ar := case inv.role when 'chef' then 'boh' when 'waiter' then 'foh' else 'admin' end;

  select tm.id into pid from public.team_members tm where tm.auth_user_id = uid order by tm.created_at nulls last limit 1;
  if pid is null then
    insert into public.team_members (auth_user_id, name, email, status, default_role)
    values (uid, coalesce((select coalesce(nullif(au.raw_user_meta_data->>'full_name',''), nullif(au.raw_user_meta_data->>'name','')) from auth.users au where au.id = uid), my_email),
            my_email, 'active', tm_role)
    returning id into pid;
  end if;

  select exists (select 1 from public.memberships m where m.person_id = pid and m.status = 'active' and m.entity_id <> inv.entity_id) into has_other;

  insert into public.memberships (person_id, entity_id, role, area, status, is_default)
  values (pid, inv.entity_id, inv.role, ar, 'active', not has_other)
  on conflict (person_id, entity_id) do update
    set role = excluded.role, area = excluded.area, status = 'active';

  update public.pending_invites pi set accepted_at = coalesce(pi.accepted_at, now()), accepted_by = uid where pi.id = inv.id;

  return query select 'ok'::text, inv.entity_id, (select e.slug from public.entities e where e.id = inv.entity_id);
end $$;

create or replace function public.claim_entity_ownership(p_entity_id uuid)
returns table (status text, tm_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  ent record;
  pid uuid;
begin
  if uid is null then
    return query select 'unauthenticated'::text, null::uuid; return;
  end if;
  select * into ent from public.entities e where e.id = p_entity_id;
  if ent.id is null then
    return query select 'not_found'::text, null::uuid; return;
  end if;
  if ent.onboarded_by is distinct from uid then
    return query select 'forbidden'::text, null::uuid; return;
  end if;

  select tm.id into pid from public.team_members tm where tm.auth_user_id = uid order by tm.created_at nulls last limit 1;
  if pid is null then
    insert into public.team_members (auth_user_id, name, email, status, default_role)
    values (uid, coalesce((select coalesce(nullif(au.raw_user_meta_data->>'full_name',''), nullif(au.raw_user_meta_data->>'name','')) from auth.users au where au.id = uid), nullif(my_email,''), 'Owner'),
            nullif(my_email,''), 'active', 'owner')
    returning id into pid;
  end if;

  insert into public.memberships (person_id, entity_id, role, area, status, is_default)
  values (pid, p_entity_id, 'owner', 'admin', 'active', true)
  on conflict (person_id, entity_id) do update set role = 'owner', area = 'admin', status = 'active';

  return query select 'ok'::text, pid;
end $$;

revoke all on function public.accept_pending_invite(text) from public, anon;
revoke all on function public.claim_entity_ownership(uuid) from public, anon;
grant execute on function public.accept_pending_invite(text) to authenticated;
grant execute on function public.claim_entity_ownership(uuid) to authenticated;
