-- 20260921_team_invitations_entity_code_scope.sql
--
-- The invite form leaves the venue optional, so invitations can carry
-- entity_code with restaurant_id null. Scoping on restaurant_id alone hid those
-- rows from the manager who created them. Accept either key.
do $$
declare v_mgr text := '(restaurant_id in (select public.app_my_managed_restaurants()) or entity_code in (select public.app_my_managed_entity_keys()))';
begin
  execute 'drop policy if exists rls35_team_invitations_select on public.team_invitations';
  execute 'drop policy if exists rls35_team_invitations_insert on public.team_invitations';
  execute 'drop policy if exists rls35_team_invitations_update on public.team_invitations';
  execute 'drop policy if exists rls35_team_invitations_delete on public.team_invitations';
  execute format('create policy rls35_team_invitations_select on public.team_invitations for select to authenticated using (%s)', v_mgr);
  execute format('create policy rls35_team_invitations_insert on public.team_invitations for insert to authenticated with check (%s)', v_mgr);
  execute format('create policy rls35_team_invitations_update on public.team_invitations for update to authenticated using (%s) with check (%s)', v_mgr, v_mgr);
  execute format('create policy rls35_team_invitations_delete on public.team_invitations for delete to authenticated using (%s)', v_mgr);
end $$;
