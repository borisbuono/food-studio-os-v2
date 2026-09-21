-- 20260921_rls_phase36_child_tables_ROLLBACK.sql
-- Restores the pre-Phase-3.6 policies + anon grants from the snapshot tables.
begin;
do $$
declare r record; t text;
begin
  foreach t in array array['recipe_ingredients','recipe_versions','recipe_byproducts','recipe_steps','prep_template_items','inventory_movements','order_items','order_dispatch_log','sales_event_lines','sales_event_staffing','sales_event_timeline','lead_touches','commercial_items','bank_match_candidates','eod_deviations','channel_members','mep_dishes','mep_components','mep_completions','tasks','task_completions','shifts','covers','menu_dish_costing','messages','team_members'] loop
    for r in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
  end loop;
  for r in select * from rls_audit.policies_before_phase36 loop
    execute format('create policy %I on public.%I as %s for %s to %s%s%s',
      r.policyname, r.tablename, r.permissive, r.cmd,
      (select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ') from unnest(r.roles) x),
      case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end);
  end loop;
  for r in select * from rls_audit.anon_grants_before_phase36 loop
    execute format('grant %s on public.%I to anon', r.privilege_type, r.table_name);
  end loop;
end $$;
commit;
