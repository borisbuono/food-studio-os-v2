-- 2026-09-21 · menu_dish_costing had a READ policy only.
--
-- /api/menu-margin/rebuild ran as the signed-in user, RLS allowed zero
-- rows to be updated, Postgres returned no error, and the route counted
-- every row as "updated". The page kept showing no cost. Same posture as
-- recipes / ingredient_aliases: any authenticated OS user may write.
-- Cron / ingest jobs use the service-role client and bypass RLS anyway.

drop policy if exists menu_dish_costing_write_auth on public.menu_dish_costing;
create policy menu_dish_costing_write_auth on public.menu_dish_costing
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
