-- 20260921_rls_owner_scope_and_entities.sql
--
-- Closes the "owner sees everything" hole left by Phase 3.5, scopes the
-- `entities` table, and removes destructive grants that bypass RLS entirely.
--
-- Found while wiring the app-side tenant filter (commit 8278bbc):
--   1. eod_pos_member_read ended in `OR current_person_is_owner()`, and that
--      helper is true for an owner of ANY entity. Utopia's owner could read
--      Bistro Mondo's and Taller's revenue, covers and close dates.
--   2. `entities` was readable by anon (cc_anon_read, qual true) — names,
--      legal_name, tax_id, address, VAT regime of every tenant — and
--      updatable by ANY signed-in user (entities_auth_update, qual true).
--   3. eod_pos had an unrestricted INSERT policy and NO update policy, so a
--      cook could insert rows for any till while the guest-count chip on the
--      Studio tiles (an UPDATE through the user's session) silently wrote 0
--      rows.
--   4. TRUNCATE was granted to `authenticated` on 183 public tables and to
--      `anon` on 90. TRUNCATE is not subject to RLS: any signed-in user could
--      empty a table outright.
--
-- The scope rule below mirrors lib/access/tenantScope.ts exactly, so the app
-- and the database agree on who may see which entity.

-- 1) Scope helper ------------------------------------------------------------
create or replace function public.app_my_scope_entities()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with mine as (
    select m.entity_id, lower(coalesce(m.role,'')) as role
      from public.team_members tm
      join public.memberships m on m.person_id = tm.id
     where tm.auth_user_id = auth.uid()
       and m.status = 'active'
  ),
  owns_holding as (
    select exists (
      select 1 from mine j join public.entities e on e.id = j.entity_id
       where j.role = 'owner' and e.entity_type = 'holding_company'
    ) as v
  )
  -- every entity I hold a membership on
  select entity_id from mine
  union
  -- an owner also sees that entity's parent holding
  select p.parent_entity_id from public.entities p
   where p.id in (select entity_id from mine where role = 'owner')
     and p.parent_entity_id is not null
  union
  -- …and the holding's non-operating children (advisory / partner / landlord)
  select c.id from public.entities c
   where c.entity_type not in ('operating_venue','operating')
     and c.parent_entity_id in (
       select p.parent_entity_id from public.entities p
        where p.id in (select entity_id from mine where role = 'owner')
     )
  union
  -- the group owner (owner of a holding company) sees the portfolio
  -- counterparties that hang off no parent at all
  select c2.id from public.entities c2, owns_holding
   where owns_holding.v
     and c2.entity_type not in ('operating_venue','operating');
$$;

revoke all on function public.app_my_scope_entities() from public, anon;
grant execute on function public.app_my_scope_entities() to authenticated, service_role;

comment on function public.app_my_scope_entities() is
  'Entities the current user may see: their memberships, plus (for owners) the parent holding and its non-operating children, plus every non-operating entity when they own a holding. Mirrors lib/access/tenantScope.ts.';

-- 2) eod_pos -----------------------------------------------------------------
drop policy if exists eod_pos_member_read on public.eod_pos;
drop policy if exists eod_pos_auth_insert on public.eod_pos;
drop policy if exists rls_eod_pos_select on public.eod_pos;
drop policy if exists rls_eod_pos_insert on public.eod_pos;
drop policy if exists rls_eod_pos_update on public.eod_pos;

create policy rls_eod_pos_select on public.eod_pos
  for select to authenticated
  using (restaurant_id in (select public.app_my_restaurants()));

create policy rls_eod_pos_insert on public.eod_pos
  for insert to authenticated
  with check (restaurant_id in (select public.app_my_restaurants()));

-- New: the Studio guest-count chip and the manual EOD form both UPDATE
-- eod_pos through the user's own session. There was no UPDATE policy, so
-- those writes hit 0 rows without an error.
create policy rls_eod_pos_update on public.eod_pos
  for update to authenticated
  using (restaurant_id in (select public.app_my_restaurants()))
  with check (restaurant_id in (select public.app_my_restaurants()));

-- 3) entities ----------------------------------------------------------------
drop policy if exists "Auth read entities" on public.entities;
drop policy if exists cc_anon_read on public.entities;
drop policy if exists entities_auth_update on public.entities;
drop policy if exists entities_auth_insert on public.entities;
drop policy if exists rls_entities_select on public.entities;
drop policy if exists rls_entities_insert on public.entities;
drop policy if exists rls_entities_update on public.entities;

create policy rls_entities_select on public.entities
  for select to authenticated
  using (
    id in (select public.app_my_scope_entities())
    or onboarded_by = auth.uid()          -- the row I just created in /onboard
  );

-- Self-serve onboarding creates the house before the membership exists, so
-- INSERT stays open to signed-in users — but the row must be stamped with
-- their own uid, which is what the SELECT policy above keys on.
create policy rls_entities_insert on public.entities
  for insert to authenticated
  with check (onboarded_by is null or onboarded_by = auth.uid());

create policy rls_entities_update on public.entities
  for update to authenticated
  using (
    id in (select public.app_my_managed_entities())
    or onboarded_by = auth.uid()
  )
  with check (
    id in (select public.app_my_managed_entities())
    or onboarded_by = auth.uid()
  );

revoke insert, update, delete, truncate, references, trigger on public.entities from anon;

-- 4) Destructive grants that RLS cannot gate --------------------------------
-- TRUNCATE ignores row policies. Nothing in the app truncates through
-- PostgREST; the crons and webhooks use service_role, which is unaffected.
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p')
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.relname);
    -- anon holds no write policy anywhere in public; drop the grants too so a
    -- future permissive policy can't accidentally open a write path.
    execute format('revoke insert, update, delete on public.%I from anon', t.relname);
  end loop;
end $$;
