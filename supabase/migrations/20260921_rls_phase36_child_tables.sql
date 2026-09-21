-- 20260921_rls_phase36_child_tables.sql  (Phase 3.6)
--
-- Follow-on to the Phase 3.5 rollout: the tables that carry no tenant column of
-- their own but hang off one that does. Each child is visible exactly when its
-- parent is — `exists (select 1 from <parent> where <parent>.id = <child>.<fk>
-- and <parent tenant predicate>)`, chained where the parent is itself a child
-- (mep_completions -> mep_components -> mep_dishes -> zones -> restaurant).
-- Same verb rules as 3.5: members SELECT/INSERT/UPDATE, managers DELETE, anon nothing.
--
-- Not covered (no tenant key anywhere, single-operator platform tables): master_todos,
-- agent_*, assistant_*, pa_schedule_state, platform_billing_status, advisory_*, files_*,
-- finance_anomalies, recurring_bank_patterns, referrals, onboarding_*, social_posts,
-- social_content_ideas, academy_*, fresto_*_raw / _master, providers, provider_products,
-- chart_of_accounts, entities, entity_relationships, weather_daily, pantry_items,
-- controller_suppliers. They need an operator_entity_id / restaurant_id column first.


-- Roster helpers (SECURITY DEFINER: reading memberships from inside a
-- team_members policy would otherwise recurse — memberships' own policy reads
-- team_members).
create or replace function public.app_my_roster_person_ids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.person_id from public.memberships m
   where m.status = 'active' and m.entity_id in (select public.current_person_entities());
$$;
create or replace function public.app_my_managed_roster_person_ids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.person_id from public.memberships m
   where m.status = 'active' and m.entity_id in (select public.app_my_managed_entities());
$$;
revoke execute on function public.app_my_roster_person_ids(), public.app_my_managed_roster_person_ids() from public, anon;
grant execute on function public.app_my_roster_person_ids(), public.app_my_managed_roster_person_ids() to authenticated;

create function pg_temp._t(alias text, kind text, mgr boolean) returns text language plpgsql immutable as $f$
begin
  return case kind
    when 'E'  then format('%I.entity_id in (select public.%s())', alias, case when mgr then 'app_my_managed_entities' else 'current_person_entities' end)
    when 'R'  then format('%I.restaurant_id in (select public.%s())', alias, case when mgr then 'app_my_managed_restaurants' else 'app_my_restaurants' end)
    when 'T'  then format('%I.entity_id in (select public.%s())', alias, case when mgr then 'app_my_managed_entity_keys' else 'app_my_entity_keys' end)
    when 'V'  then format('%I.venue in (select public.%s())', alias, case when mgr then 'app_my_managed_entity_keys' else 'app_my_entity_keys' end)
    when 'B'  then format('(%s or %s)', pg_temp._t(alias,'E',mgr), pg_temp._t(alias,'R',mgr))
    when 'TR' then format('(%s or %s)', pg_temp._t(alias,'T',mgr), pg_temp._t(alias,'R',mgr))
    when 'OP' then format('(%I.operator_entity_id in (select public.%s()) or (%I.operator_entity_id is null and public.app_is_platform_owner()))',
                          alias, case when mgr then 'app_my_managed_entities' else 'current_person_entities' end, alias)
  end;
end $f$;

-- spec = hop[>hop...] outermost first, last hop carries the tenant kind;
-- hop = parent:alias:child_fk_expression[:kind];  '|' = either branch;  '*' = tenant column on the table itself.
create function pg_temp._pred(spec text, mgr boolean) returns text language plpgsql immutable as $f$
declare hops text[]; parts text[]; out text; i int; br text[];
begin
  if position('|' in spec) > 0 then
    br := string_to_array(spec, '|');
    return format('(%s or %s)', pg_temp._pred(br[1],mgr), pg_temp._pred(br[2],mgr));
  end if;
  hops := string_to_array(spec, '>');
  parts := string_to_array(hops[array_length(hops,1)], ':');
  if parts[1] = '*' then return pg_temp._t(parts[2], parts[4], mgr); end if;
  out := format('exists (select 1 from public.%I %I where %I.id = %s and %s)',
                parts[1], parts[2], parts[2], parts[3], pg_temp._t(parts[2], parts[4], mgr));
  for i in reverse array_length(hops,1)-1 .. 1 loop
    parts := string_to_array(hops[i], ':');
    out := format('exists (select 1 from public.%I %I where %I.id = %s and %s)', parts[1], parts[2], parts[2], parts[3], out);
  end loop;
  return out;
end $f$;

create function pg_temp._p36(t text, s text, i text, u text, d text) returns void language plpgsql as $f$
begin
  if s is not null then execute format('create policy %I on public.%I for select to authenticated using (%s)', 'rls36_'||t||'_select', t, s); end if;
  if i is not null then execute format('create policy %I on public.%I for insert to authenticated with check (%s)', 'rls36_'||t||'_insert', t, i); end if;
  if u is not null then execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', 'rls36_'||t||'_update', t, u, u); end if;
  if d is not null then execute format('create policy %I on public.%I for delete to authenticated using (%s)', 'rls36_'||t||'_delete', t, d); end if;
end $f$;

create function pg_temp._std36(t text, spec text) returns void language sql as $f$
  select pg_temp._p36(t, pg_temp._pred(spec,false), pg_temp._pred(spec,false), pg_temp._pred(spec,false), pg_temp._pred(spec,true))
$f$;

-- snapshot for rollback
create table if not exists rls_audit.policies_before_phase36 as
  select * from pg_policies where schemaname='public' and tablename = any(array['recipe_ingredients','recipe_versions','recipe_byproducts','recipe_steps','prep_template_items','inventory_movements','order_items','order_dispatch_log','sales_event_lines','sales_event_staffing','sales_event_timeline','lead_touches','commercial_items','bank_match_candidates','eod_deviations','channel_members','mep_dishes','mep_components','mep_completions','tasks','task_completions','shifts','covers','menu_dish_costing','messages','team_members']);
create table if not exists rls_audit.anon_grants_before_phase36 as
  select table_name, privilege_type from information_schema.role_table_grants
   where table_schema='public' and grantee='anon' and table_name = any(array['recipe_ingredients','recipe_versions','recipe_byproducts','recipe_steps','prep_template_items','inventory_movements','order_items','order_dispatch_log','sales_event_lines','sales_event_staffing','sales_event_timeline','lead_touches','commercial_items','bank_match_candidates','eod_deviations','channel_members','mep_dishes','mep_components','mep_completions','tasks','task_completions','shifts','covers','menu_dish_costing','messages','team_members']);

do $do$
declare r record; t text;
begin
  foreach t in array array['recipe_ingredients','recipe_versions','recipe_byproducts','recipe_steps','prep_template_items','inventory_movements','order_items','order_dispatch_log','sales_event_lines','sales_event_staffing','sales_event_timeline','lead_touches','commercial_items','bank_match_candidates','eod_deviations','channel_members','mep_dishes','mep_components','mep_completions','tasks','task_completions','shifts','covers','menu_dish_costing','messages','team_members'] loop
    execute format('alter table public.%I enable row level security', t);
    for r in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
  end loop;
end $do$;

do $do$
begin
  perform pg_temp._std36('recipe_ingredients', $s$recipes:r:recipe_ingredients.recipe_id:E$s$);
  perform pg_temp._std36('recipe_versions', $s$recipes:r:recipe_versions.recipe_id:E$s$);
  perform pg_temp._std36('recipe_byproducts', $s$recipes:r:recipe_byproducts.recipe_id:E$s$);
  perform pg_temp._std36('recipe_steps', $s$recipes:r:recipe_steps.recipe_id:E$s$);
  perform pg_temp._std36('prep_template_items', $s$prep_templates:p:prep_template_items.template_id:E$s$);
  perform pg_temp._std36('inventory_movements', $s$inventory_items:i:inventory_movements.inventory_item_id:R$s$);
  perform pg_temp._std36('order_items', $s$orders:o:order_items.order_id:TR$s$);
  perform pg_temp._std36('order_dispatch_log', $s$orders:o:order_dispatch_log.order_id:TR$s$);
  perform pg_temp._std36('sales_event_lines', $s$sales_events:e:sales_event_lines.event_id:B$s$);
  perform pg_temp._std36('sales_event_staffing', $s$sales_events:e:sales_event_staffing.event_id:B$s$);
  perform pg_temp._std36('sales_event_timeline', $s$sales_events:e:sales_event_timeline.event_id:B$s$);
  perform pg_temp._std36('lead_touches', $s$leads:l:lead_touches.lead_id:E$s$);
  perform pg_temp._std36('commercial_items', $s$commercials:cm:commercial_items.commercial_id:R$s$);
  perform pg_temp._std36('bank_match_candidates', $s$bank_movements:b:bank_match_candidates.bank_movement_id:T$s$);
  perform pg_temp._std36('eod_deviations', $s$eod_accounting:ea:eod_deviations.eod_accounting_id:R|eod_pos:ep:eod_deviations.eod_pos_id:R$s$);
  perform pg_temp._std36('channel_members', $s$channels:ch:channel_members.channel_id:R$s$);
  perform pg_temp._std36('mep_dishes', $s$zones:z:mep_dishes.zone_id:R$s$);
  perform pg_temp._std36('mep_components', $s$mep_dishes:d:mep_components.mep_dish_id>zones:z:d.zone_id:R$s$);
  perform pg_temp._std36('mep_completions', $s$mep_components:mc:mep_completions.component_id>mep_dishes:d:mc.mep_dish_id>zones:z:d.zone_id:R$s$);
  perform pg_temp._std36('tasks', $s$zones:z:tasks.zone_id:R$s$);
  perform pg_temp._std36('task_completions', $s$tasks:tk:task_completions.task_id>zones:z:tk.zone_id:R$s$);
  perform pg_temp._std36('shifts', $s$zones:z:shifts.zone_id:R$s$);
  perform pg_temp._std36('covers', $s$*:covers::OP$s$);
  perform pg_temp._std36('menu_dish_costing', $s$*:menu_dish_costing::V$s$);

  -- messages: read/write inside a channel of one of my venues; authors write as themselves
  perform pg_temp._p36('messages',
    pg_temp._pred($s$channels:ch:messages.channel_id:R$s$, false),
    pg_temp._pred($s$channels:ch:messages.channel_id:R$s$, false) || ' and author_id = (select auth.uid())',
    pg_temp._pred($s$channels:ch:messages.channel_id:R$s$, false) || ' and author_id = (select auth.uid())',
    pg_temp._pred($s$channels:ch:messages.channel_id:R$s$, true));

  -- team_members: the roster. Visible when the person holds a membership in one of my
  -- entities, or the row is stamped with one of my entities, or it is me. 25 of 31 rows
  -- have no operator_entity_id, so the membership join is what actually carries this.
  -- team_members: the roster. Visible when the person holds a membership in one of my
  -- entities, or the row is stamped with one of my entities, or it is me. 25 of 31 rows
  -- have no operator_entity_id, so the membership join is what actually carries this.
  perform pg_temp._p36('team_members',
    $s$auth_user_id = (select auth.uid()) or operator_entity_id in (select public.current_person_entities()) or id in (select public.app_my_roster_person_ids())$s$,
    $s$operator_entity_id in (select public.app_my_managed_entities())$s$,
    $s$auth_user_id = (select auth.uid()) or operator_entity_id in (select public.app_my_managed_entities()) or id in (select public.app_my_managed_roster_person_ids())$s$,
    $s$operator_entity_id in (select public.app_my_managed_entities()) or id in (select public.app_my_managed_roster_person_ids())$s$);
end $do$;

do $$
declare t text;
begin
  foreach t in array array['recipe_ingredients','recipe_versions','recipe_byproducts','recipe_steps','prep_template_items','inventory_movements','order_items','order_dispatch_log','sales_event_lines','sales_event_staffing','sales_event_timeline','lead_touches','commercial_items','bank_match_candidates','eod_deviations','channel_members','mep_dishes','mep_components','mep_completions','tasks','task_completions','shifts','covers','menu_dish_costing','messages','team_members'] loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
