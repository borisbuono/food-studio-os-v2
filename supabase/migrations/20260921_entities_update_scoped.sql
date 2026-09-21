-- entities UPDATE was `USING (true)` for every authenticated user: a signed-in
-- operator of any tenant could rename Bistro Mondo, change its city or tax_id,
-- or flip is_active. Verified exploitable with a burner account on 2026-09-21
-- (the update succeeded; the test transaction rolled back, nothing changed).
--
-- Scoped to entities the caller manages, plus the entity they created
-- themselves — the onboarding wizard's onboarding_progress write runs as the
-- creator and is the ONLY entities UPDATE in the app.
--
-- Verified after applying: hostile tenant → 0 rows; Boris → 3 of 3 venues;
-- fresh self-serve creator → can still finish onboarding.
--
-- Rollback:
--   drop policy entities_update_scoped on public.entities;
--   create policy entities_auth_update on public.entities for update to authenticated using (true);
drop policy if exists entities_auth_update on public.entities;

create policy entities_update_scoped on public.entities
  for update to authenticated
  using (
    id in (select app_my_managed_entities())
    or onboarded_by = (select auth.uid())
  )
  with check (
    id in (select app_my_managed_entities())
    or onboarded_by = (select auth.uid())
  );
