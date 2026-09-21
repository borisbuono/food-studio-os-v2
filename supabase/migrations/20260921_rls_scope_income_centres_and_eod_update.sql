-- 20260921_rls_scope_income_centres_and_eod_update.sql
--
-- Re-scopes three policies added earlier the same night by a parallel session
-- (20260921_income_centres_policies_and_guests_source.sql). They unblocked the
-- fresto income-centre job, but each was written as `using (true)` or with the
-- current_person_is_owner() bypass, which re-opens the cross-tenant hole that
-- 20260921_rls_owner_scope_and_entities.sql had just closed. The cron runs on
-- the service-role client (c995cb5) and bypasses RLS, so this does not affect
-- it; a signed-in operator still writes their own houses by hand.

drop policy if exists eod_pos_member_update on public.eod_pos;   -- dup of rls_eod_pos_update, with the owner bypass

drop policy if exists income_centres_auth_write on public.fresto_income_centres_daily;
create policy income_centres_member_all on public.fresto_income_centres_daily
  for all to authenticated
  using (entity_code in (select public.app_my_entity_keys()))
  with check (entity_code in (select public.app_my_entity_keys()));

drop policy if exists salepoints_master_auth_write on public.fresto_salepoints_master;
create policy salepoints_master_member_all on public.fresto_salepoints_master
  for all to authenticated
  using (entity_code in (select public.app_my_entity_keys()))
  with check (entity_code in (select public.app_my_entity_keys()));

-- cron_runs has no tenant column — it is the platform's own job log.
drop policy if exists cron_runs_auth_write on public.cron_runs;
create policy cron_runs_platform_all on public.cron_runs
  for all to authenticated
  using (public.app_is_platform_owner())
  with check (public.app_is_platform_owner());
