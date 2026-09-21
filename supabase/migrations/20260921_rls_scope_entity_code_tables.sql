-- 20260921_rls_scope_entity_code_tables.sql
--
-- Phase 3.6, first slice: the tables that already carry an `entity_code` but
-- still had `using (true)` policies for `authenticated` — the fresto_* raw
-- tables (2,110 orderlines, 567 orders, 75 z-reports …), master_todos,
-- social_posts, assistant_config/playbooks, agent_charters, finance_anomalies,
-- recurring_bank_patterns, files_documents, academy_lessons.
--
-- Rule (same shape as Phase 3.5): read and write your own tenant's rows.
-- A row with no tenant key is a legacy row of the platform owner's, readable
-- and writable only by them — except academy_lessons, where the 12 untagged
-- rows are the shared curriculum and stay readable by everyone signed in.
--
-- NOT in this slice, on purpose: onboarding_steps / onboarding_documents /
-- platform_billing_status / platform_reactivation_state (the self-serve wizard
-- writes them before any membership exists), restaurants (public directory),
-- and the ~44 tables that carry no tenant column at all.
--
-- Applied to the live project 2026-09-21 via the Supabase MCP. Verified by
-- impersonation: Boris's counts identical table by table; a second tenant's
-- owner sees only their own rows (plus the 12 shared lessons).

do $$
declare
  t text;
  p record;
  tables text[] := array[
    'fresto_orderlines_raw','fresto_menu_products_master','fresto_orders_raw',
    'fresto_tables_master','fresto_z_reports_raw','fresto_bookings_raw',
    'fresto_bookings_daily_raw','fresto_menu_groups_master','fresto_salepoints_kpi_raw',
    'fresto_staff_master','fresto_webhook_events','master_todos','academy_lessons',
    'social_posts','social_content_ideas','assistant_config','assistant_playbooks',
    'assistant_advisory_clients','agent_charters','finance_anomalies',
    'recurring_bank_patterns','files_documents'
  ];
begin
  foreach t in array tables loop
    for p in
      select policyname from pg_policies
       where schemaname='public' and tablename=t
         and roles::text like '%authenticated%'
         and (coalesce(qual,'')='true' or coalesce(with_check,'')='true')
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    execute format('drop policy if exists %I on public.%I', t || '_tenant_read', t);
    if t = 'academy_lessons' then
      execute format($f$
        create policy %I on public.%I
          for select to authenticated
          using (entity_code is null or entity_code in (select public.app_my_entity_keys()))
      $f$, t || '_tenant_read', t);
    else
      execute format($f$
        create policy %I on public.%I
          for select to authenticated
          using (
            case when entity_code is null then public.app_is_platform_owner()
                 else entity_code in (select public.app_my_entity_keys()) end)
      $f$, t || '_tenant_read', t);
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_tenant_write', t);
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using (
          case when entity_code is null then public.app_is_platform_owner()
               else entity_code in (select public.app_my_entity_keys()) end)
        with check (
          case when entity_code is null then public.app_is_platform_owner()
               else entity_code in (select public.app_my_entity_keys()) end)
    $f$, t || '_tenant_write', t);
  end loop;
end $$;
