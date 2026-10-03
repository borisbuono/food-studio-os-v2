-- ROLLBACK for 20261003_security_s7a_revoke_anon_execute.sql
--
-- Re-opens the 16 functions to anon. Only run this if closing them broke something
-- real, and say WHICH in a TO_BORIS_rollback note — four of these are unauthenticated
-- writes and two read staff pay and cost data, so this is a step backwards into a
-- verified live exposure. Prefer granting EXECUTE back to a single function over
-- running the whole file.
--
-- This restores the grant to anon explicitly rather than to PUBLIC. That is
-- deliberate: PUBLIC is how the exposure happened in the first place and nothing
-- should be put back that way.

do $$
declare
  f record;
  targets text[] := array[
    'fn_spend_per_cover','fn_rota_settings','fn_person_rate','fn_cleaning_actor_name',
    'fn_cost_recipe','fn_cleaning_materialise','fn_recost_entity','fn_recost_menu',
    'fn_refresh_purchase_prices','email_thread_request_classify','fn_labor_shift_settle_trg',
    'fn_propagate_recipe_edit','master_todos_derive_entity','observations_before_insert',
    'social_inbox_request_draft','tg_recipe_ingredients_sync'
  ];
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public' and p.proname = any(targets)
  loop
    execute format('grant execute on function %s to anon', f.sig);
  end loop;
end $$;
