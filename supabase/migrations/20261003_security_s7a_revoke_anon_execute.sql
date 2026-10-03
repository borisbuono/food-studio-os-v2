-- Security S7a (2026-10-03) — close the anonymous SECURITY DEFINER RPC surface.
--
-- S1–S6 hardened the tables, and the table policies are correct: an anonymous
-- caller reading master_todos gets 0 rows. But a SECURITY DEFINER function runs
-- with the owner's rights, so RLS is not applied to what it reads — it is a way
-- AROUND the table policies, and that layer had never been audited.
--
-- Supabase advisor 0028 lists 56 SECURITY DEFINER functions callable without
-- signing in. 22 of those have no internal auth check. Verified live against prod
-- with nothing but the publishable anon key, 2026-10-03:
--
--   * `restaurants` is anon-readable and returns entity_id, so entity UUIDs are not
--     a secret and p_entity can simply be supplied.
--   * rpc/fn_spend_per_cover {p_entity: Bistro Mondo} -> 22.06
--   * rpc/fn_rota_settings   {p_entity: Bistro Mondo} -> overtime_rate, staffing
--     bands, budget — the whole settings row
--   * rpc/fn_person_rate(p_entity, p_person, p_date) is on the same footing: an
--     individual's pay rate, which Section 5 of the foundation calls the smallest
--     circle in the building
--   * fn_recost_entity / fn_recost_menu / fn_refresh_purchase_prices /
--     fn_cleaning_materialise are unauthenticated WRITES (not called while testing)
--
-- EXECUTE reached anon through PUBLIC (`=X/postgres` in proacl) — the Postgres
-- default for a function unless revoked — and NOT through a grant to anon. So
-- revoking from anon alone would have changed nothing. PUBLIC is what goes. The
-- explicit authenticated and service_role grants are left intact, so the OS and the
-- crons are unaffected.
--
-- Left deliberately open to anon, verified still callable after this ran:
-- apply_page_info, apply_submit, fn_apply_can_upload, booking_busy,
-- booking_page_info, public_recipe_by_slug, and the token-gated flows apply_finish,
-- apply_mark_confirmed, apply_set_lang, booking_create, accept_pending_invite,
-- get_invitation_by_token, observations_synthesis_*.
--
-- Evidence: scripts/probes/anon_rpc_probe.sh (run before and after).
-- Rollback:  20261003_security_s7a_revoke_anon_execute_ROLLBACK.sql
--
-- Still open, for the S7 branch:
--   * the 7 trigger-only functions should leave the exposed API schema entirely
--     rather than merely lose anon
--   * the 92 authenticated-callable definers need the same audit — fn_is_entity_manager
--     and fn_is_entity_member take the uid as an ARGUMENT instead of reading auth.uid()
--   * 40 functions have a mutable search_path (advisor 0011)
--   * `restaurants` probably should not be anon-readable now that the public pages go
--     through definer functions; it is what makes every entity UUID discoverable

do $$
declare
  f record;
  targets text[] := array[
    -- reads: business and staff data, no check
    'fn_spend_per_cover','fn_rota_settings','fn_person_rate','fn_cleaning_actor_name',
    'fn_cost_recipe',
    -- writes / recompute, no check
    'fn_cleaning_materialise','fn_recost_entity','fn_recost_menu',
    'fn_refresh_purchase_prices',
    -- trigger functions that were never meant to be callable at all
    'email_thread_request_classify','fn_labor_shift_settle_trg','fn_propagate_recipe_edit',
    'master_todos_derive_entity','observations_before_insert','social_inbox_request_draft',
    'tg_recipe_ingredients_sync'
  ];
  n int := 0;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public' and p.proname = any(targets)
  loop
    execute format('revoke execute on function %s from public', f.sig);
    execute format('revoke execute on function %s from anon', f.sig);
    n := n + 1;
  end loop;
  raise notice 'S7a: revoked PUBLIC+anon EXECUTE on % functions', n;
  if n = 0 then
    raise exception 'S7a revoked nothing — the target list no longer matches any function';
  end if;
end $$;
