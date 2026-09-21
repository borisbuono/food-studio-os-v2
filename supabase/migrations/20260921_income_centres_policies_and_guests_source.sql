-- 2026-09-21 (follow-up, same walk) — three fixes found by running the new
-- code against production rather than reading it.
--
-- 1) eod_pos.guests_source only allowed email|manual|import, so writing the
--    guest count from GET /bookings/daily — the only machine-readable source
--    that actually fires every night — was rejected by the check constraint.
-- 2) fresto_income_centres_daily / fresto_salepoints_master / cron_runs were
--    service_role-write only. Every sibling fresto_* raw table allows
--    authenticated writes, and a signed-in Studio user needs to be able to
--    run the same job by hand. Made consistent.
-- 3) eod_pos had INSERT and SELECT policies for `authenticated` but no
--    UPDATE. Refreshing an existing day silently touched zero rows — the
--    quiet half of why eod_pos stopped moving.
--
-- Applied to the live project 2026-09-21 via the Supabase MCP.

alter table public.eod_pos drop constraint if exists eod_pos_guests_source_chk;
alter table public.eod_pos add constraint eod_pos_guests_source_chk
  check (guests_source is null or guests_source = any (array['email','manual','import','bookings_daily']));

drop policy if exists income_centres_auth_write on public.fresto_income_centres_daily;
create policy income_centres_auth_write on public.fresto_income_centres_daily
  for all to authenticated using (true) with check (true);

drop policy if exists salepoints_master_auth_write on public.fresto_salepoints_master;
create policy salepoints_master_auth_write on public.fresto_salepoints_master
  for all to authenticated using (true) with check (true);

drop policy if exists cron_runs_auth_write on public.cron_runs;
create policy cron_runs_auth_write on public.cron_runs
  for all to authenticated using (true) with check (true);

drop policy if exists eod_pos_member_update on public.eod_pos;
create policy eod_pos_member_update on public.eod_pos
  for update to authenticated
  using (restaurant_id in (select r.id from restaurants r where r.entity_id in (select current_person_entities())) or current_person_is_owner())
  with check (restaurant_id in (select r.id from restaurants r where r.entity_id in (select current_person_entities())) or current_person_is_owner());
