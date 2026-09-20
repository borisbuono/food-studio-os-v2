-- 20260920_security_lockdown.sql
--
-- P0 security fix for the Amsterdam 30-Sep multi-tenant launch.
--
-- Supabase advisor flagged:
--   * 11 views defined as SECURITY DEFINER — every one runs as postgres and
--     bypasses RLS on the underlying tables. Anyone with the anon key could
--     `POST /rest/v1/rpc/v_operational_pnl` and read every restaurant's P&L.
--   * 8 SECURITY DEFINER functions callable by anon over the public API.
--     `handle_new_user`, `rls_auto_enable`, the two `_advisory_*` triggers, and
--     the four RLS helpers (`current_person_entities`, `current_person_is_owner`,
--     `fn_is_entity_manager`, `fn_is_entity_member`) all had public EXECUTE.
--
-- Fix strategy (documented in
--   06_PA/_INBOX/TO_BORIS_security_audit_2026-09-20.md):
--
--   * Views → flip to `security_invoker=true` so RLS on underlying tables
--     applies to the caller, not postgres.
--   * Trigger functions (`handle_new_user`, `rls_auto_enable`,
--     `_advisory_checklist_promote`, `_advisory_sync_assistant_registry`) →
--     REVOKE EXECUTE from public/anon/authenticated. Triggers still fire
--     because triggers don't check the caller's EXECUTE grant on the trigger
--     function body.
--   * RLS helper functions (`current_person_entities`, `current_person_is_owner`,
--     `fn_is_entity_manager`, `fn_is_entity_member`) → keep DEFINER (they need
--     to read `team_members`/`memberships` bypassing RLS on those tables) but
--     REVOKE anon, GRANT authenticated. `sync_my_profile_from_invite` same.
--   * `social_*` functions already have anon/auth revoked; re-assert REVOKE
--     FROM public for defence in depth.
--
-- No data mutation. Fully reversible via a follow-up ALTER/GRANT migration.

begin;

------------------------------------------------------------------------
-- 1. Views: swap SECURITY DEFINER for SECURITY INVOKER
------------------------------------------------------------------------

alter view public.recipe_cost_share_audit       set (security_invoker = true);
alter view public.v_advisory_clients_overview   set (security_invoker = true);
alter view public.v_bank_matches_open           set (security_invoker = true);
alter view public.v_daily_pos_weather           set (security_invoker = true);
alter view public.v_finance_anomalies_open      set (security_invoker = true);
alter view public.v_fiscal_pnl                  set (security_invoker = true);
alter view public.v_ingredient_price_history    set (security_invoker = true);
alter view public.v_ingredient_variance_monthly set (security_invoker = true);
alter view public.v_operational_pnl             set (security_invoker = true);
alter view public.v_orders_open                 set (security_invoker = true);
alter view public.v_recurring_patterns_active   set (security_invoker = true);

------------------------------------------------------------------------
-- 2. Trigger functions: REVOKE EXECUTE from everyone
--    They only ever fire from triggers/event triggers; nothing outside
--    postgres should be able to RPC them.
------------------------------------------------------------------------

revoke execute on function public._advisory_checklist_promote()        from public, anon, authenticated;
revoke execute on function public._advisory_sync_assistant_registry()  from public, anon, authenticated;
revoke execute on function public.handle_new_user()                    from public, anon, authenticated;
revoke execute on function public.rls_auto_enable()                    from public, anon, authenticated;

------------------------------------------------------------------------
-- 3. RLS helper functions: DEFINER stays (must bypass RLS on the
--    membership tables), but the anon role must not be able to call them.
------------------------------------------------------------------------

revoke execute on function public.current_person_entities()               from public, anon;
revoke execute on function public.current_person_is_owner()               from public, anon;
revoke execute on function public.fn_is_entity_manager(uuid, uuid)        from public, anon;
revoke execute on function public.fn_is_entity_member(uuid, uuid)         from public, anon;

grant  execute on function public.current_person_entities()               to authenticated;
grant  execute on function public.current_person_is_owner()               to authenticated;
grant  execute on function public.fn_is_entity_manager(uuid, uuid)        to authenticated;
grant  execute on function public.fn_is_entity_member(uuid, uuid)         to authenticated;

------------------------------------------------------------------------
-- 4. Signed-in profile bootstrap: keep the auth-user path, cut anon.
------------------------------------------------------------------------

revoke execute on function public.sync_my_profile_from_invite() from public, anon;
grant  execute on function public.sync_my_profile_from_invite() to authenticated;

------------------------------------------------------------------------
-- 5. Social publishing helpers: role-guarded in the body, but strip
--    PUBLIC EXECUTE for defence in depth.
------------------------------------------------------------------------

revoke execute on function public.social_account_token(uuid)                                                                                                     from public, anon, authenticated;
revoke execute on function public.social_account_upsert(text, text, text, text, text, text, text, text, timestamp with time zone, text[], jsonb, uuid)           from public, anon, authenticated;
revoke execute on function public.social_oauth_begin(text, text, text[])                                                                                          from public, anon, authenticated;
revoke execute on function public.social_oauth_consume(text)                                                                                                      from public, anon, authenticated;

------------------------------------------------------------------------
-- 6. Search-path hardening: every remaining DEFINER function gets an
--    explicit, immutable search_path so a compromised session cannot
--    hijack unqualified references (schema-shadowing attack).
------------------------------------------------------------------------

alter function public._advisory_checklist_promote()             set search_path = public;
alter function public._advisory_sync_assistant_registry()       set search_path = public;
alter function public.current_person_entities()                 set search_path = public, pg_temp;
alter function public.current_person_is_owner()                 set search_path = public, pg_temp;
alter function public.fn_is_entity_manager(uuid, uuid)          set search_path = public;
alter function public.fn_is_entity_member(uuid, uuid)           set search_path = public;
alter function public.handle_new_user()                         set search_path = public;
alter function public.rls_auto_enable()                         set search_path = pg_catalog;
alter function public.social_account_token(uuid)                set search_path = public, vault;
alter function public.social_account_upsert(text, text, text, text, text, text, text, text, timestamp with time zone, text[], jsonb, uuid)
                                                                 set search_path = public, vault;
alter function public.social_oauth_begin(text, text, text[])    set search_path = public, extensions;
alter function public.social_oauth_consume(text)                set search_path = public;
alter function public.sync_my_profile_from_invite()             set search_path = public;

commit;

-- Rollback recipe (for the record — do NOT run unless you know why):
--
--   begin;
--   alter view public.v_operational_pnl             set (security_invoker = false);
--   -- ... etc. for the other 10 views
--   grant  execute on function public.handle_new_user()            to public;
--   grant  execute on function public.rls_auto_enable()            to public;
--   grant  execute on function public.current_person_entities()    to public;
--   -- ... etc.
--   commit;
