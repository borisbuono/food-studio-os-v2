-- 20260921_invitation_token_rpc.sql
--
-- Closes the last anon hole left by the Phase 3.5 rollout. /team/join used to
-- look the invitation up by token with the anon key, so the anon SELECT policy
-- on team_invitations let anyone list every live invitation, magic_link_token
-- included. Both reads move behind SECURITY DEFINER RPCs that take the token
-- and return at most one row, never the token itself.
--
-- SHIP ORDER: deploy the app change (app/team/join/page.tsx +
-- app/api/team/join/finalize/route.ts) before sending any new invitation — the
-- anon policy is dropped at the bottom of this file.

-- 1. Public lookup by token (the /team/join landing page).
create or replace function public.get_invitation_by_token(p_token text)
returns table (
  id uuid, invited_email text, invited_name text, invited_phone text, role text,
  restaurant_id uuid, entity_code text, starting_date date, language text,
  accepted_at timestamptz, venue_name text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.invited_email, i.invited_name, i.invited_phone, i.role,
         i.restaurant_id, i.entity_code, i.starting_date, i.language, i.accepted_at,
         r.name
    from public.team_invitations i
    left join public.restaurants r on r.id = i.restaurant_id
   where p_token is not null and length(p_token) >= 16
     and i.magic_link_token = p_token
     and i.revoked_at is null
     and (i.expires_at is null or i.expires_at > now())
   limit 1;
$$;

-- 2. Accept: only the signed-in user whose email matches the invitation.
create or replace function public.accept_invitation_by_token(p_token text)
returns table (
  id uuid, invited_email text, restaurant_id uuid, entity_code text, role text, accepted_at timestamptz
)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare inv public.team_invitations%rowtype; caller_email text;
begin
  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if auth.uid() is null or caller_email = '' then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into inv from public.team_invitations i
   where i.magic_link_token = p_token and i.revoked_at is null
     and (i.expires_at is null or i.expires_at > now())
   limit 1;
  if not found then raise exception 'invitation not found or no longer live' using errcode = 'P0002'; end if;
  if lower(coalesce(inv.invited_email,'')) <> caller_email then
    raise exception 'email mismatch — sign in with the invited email' using errcode = '42501';
  end if;
  if inv.accepted_at is null then
    update public.team_invitations t set accepted_at = now() where t.id = inv.id
      returning t.accepted_at into inv.accepted_at;
  end if;
  return query select inv.id, inv.invited_email, inv.restaurant_id, inv.entity_code, inv.role, inv.accepted_at;
end $$;

revoke execute on function public.get_invitation_by_token(text) from public;
grant  execute on function public.get_invitation_by_token(text) to anon, authenticated;
revoke execute on function public.accept_invitation_by_token(text) from public, anon;
grant  execute on function public.accept_invitation_by_token(text) to authenticated;

-- 3. A signed-in invitee may read their own invitation row (the training and
--    first-week screens look it up by their own email). Managers keep the
--    rls35_team_invitations_* policies.
create policy rls36_team_invitations_self_read on public.team_invitations
  for select to authenticated
  using (lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 4. Drop the anon policy and the anon grant.
drop policy if exists rls35_team_invitations_anon_token on public.team_invitations;
revoke all on public.team_invitations from anon;
