-- recipes: _mirror_backfill (2026-09-21)
-- The 59 ACTIVE BM recipes tagged restaurant='both' become shared:
--   * new canonical row on Boris Buono Holdings (BBH), content copied
--   * the existing BM row is kept AS the BM mirror (same id → menu_items,
--     prep_lists, menu_dish_costing, inventory_movements all untouched)
--   * a new Taller mirror row is created
--   * ingredients: BM row → canonical (copy), canonical → Taller mirror (copy),
--     sub-recipe links remapped to the right venue's mirror
-- Skipped on purpose: 17 inactive 'both' rows (parser fragments like
-- "Ingredients:" / "4 eggs"), and Utopia's 20 'both' rows (Amsterdam tenant —
-- 'both' there is a legacy default, not BM↔IFS).
-- Idempotent: only rows with origin_recipe_id IS NULL and no backfill tag.

do $$
declare
  v_bbh    constant uuid := 'd1ee19b6-5fb4-460c-8326-685dc86e47df';
  v_bm     constant uuid := '387f1045-0340-4029-a1e4-28b15c372680';
  v_taller constant uuid := 'daec58d9-44a2-4c24-9183-2a87219093fb';
  r record; v_c uuid; v_t uuid;
begin
  perform set_config('app.recipe_sync', 'on', true);  -- no trigger churn during backfill

  create temp table _bf (bm_id uuid primary key, canon_id uuid, taller_id uuid) on commit drop;

  for r in
    select * from public.recipes
     where entity_id = v_bm and restaurant = 'both' and coalesce(is_active, true)
       and origin_recipe_id is null
       and not exists (select 1 from public.recipes x where x.origin_recipe_id = recipes.id)
       and coalesce(metadata->>'shared_backfill', '') = ''
  loop
    insert into public.recipes (
      name, restaurant, section, portions, description, allergens, allergen_traces, is_active,
      created_by, critical_control_points, cooking_target_temp_c, hold_max_minutes, reheat_required,
      is_base_recipe, voice_statement, hero_image_url, plating_image_url, plating_spec, view_variants,
      yield_grams, prep_minutes, cook_minutes, servings, difficulty, tagline, cover_photo_url,
      entity_id, station, category, yield_qty, yield_unit, portion_size, portion_unit, method, notes,
      cover_multiplier, metadata)
    values (
      r.name, 'both', r.section, r.portions, r.description, r.allergens, r.allergen_traces, true,
      r.created_by, r.critical_control_points, r.cooking_target_temp_c, r.hold_max_minutes, r.reheat_required,
      r.is_base_recipe, r.voice_statement, r.hero_image_url, r.plating_image_url, r.plating_spec, r.view_variants,
      r.yield_grams, r.prep_minutes, r.cook_minutes, r.servings, r.difficulty, r.tagline, r.cover_photo_url,
      v_bbh, r.station, r.category, r.yield_qty, r.yield_unit, r.portion_size, r.portion_unit, r.method, r.notes,
      r.cover_multiplier,
      jsonb_build_object('shared_backfill', '2026-09-21', 'from_recipe_id', r.id, 'from_entity', 'bm'))
    returning id into v_c;

    update public.recipes
       set origin_recipe_id = v_c,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('shared_backfill', '2026-09-21', 'mirror_of', v_c)
     where id = r.id;

    insert into public.recipes (
      name, restaurant, section, portions, description, allergens, allergen_traces, is_active,
      created_by, critical_control_points, cooking_target_temp_c, hold_max_minutes, reheat_required,
      is_base_recipe, voice_statement, hero_image_url, plating_image_url, plating_spec, view_variants,
      yield_grams, prep_minutes, cook_minutes, servings, difficulty, tagline, cover_photo_url,
      entity_id, station, category, yield_qty, yield_unit, portion_size, portion_unit, method, notes,
      cover_multiplier, origin_recipe_id, metadata)
    values (
      r.name, 'taller', r.section, r.portions, r.description, r.allergens, r.allergen_traces, true,
      r.created_by, r.critical_control_points, r.cooking_target_temp_c, r.hold_max_minutes, r.reheat_required,
      r.is_base_recipe, r.voice_statement, r.hero_image_url, r.plating_image_url, r.plating_spec, r.view_variants,
      r.yield_grams, r.prep_minutes, r.cook_minutes, r.servings, r.difficulty, r.tagline, r.cover_photo_url,
      v_taller, r.station, r.category, r.yield_qty, r.yield_unit, r.portion_size, r.portion_unit, r.method, r.notes,
      r.cover_multiplier, v_c,
      jsonb_build_object('shared_backfill', '2026-09-21', 'mirror_of', v_c))
    returning id into v_t;

    insert into _bf values (r.id, v_c, v_t);
  end loop;

  -- BM ingredients → canonical (links to other shared BM rows → their canonical)
  insert into public.recipe_ingredients
    (recipe_id, name, ingredient_name, quantity, unit, sort_order, order_idx, notes, is_optional,
     quantity_per_portion, yield_factor, inventory_item_id, ingredient_id, pantry_item_id, linked_ingredient_id,
     linked_recipe_id, sub_recipe_id)
  select b.canon_id, ri.name, ri.ingredient_name, ri.quantity, ri.unit, ri.sort_order, ri.order_idx, ri.notes, ri.is_optional,
         ri.quantity_per_portion, ri.yield_factor, ri.inventory_item_id, ri.ingredient_id, ri.pantry_item_id, ri.linked_ingredient_id,
         coalesce((select b2.canon_id from _bf b2 where b2.bm_id = ri.linked_recipe_id), ri.linked_recipe_id),
         coalesce((select b2.canon_id from _bf b2 where b2.bm_id = ri.sub_recipe_id), ri.sub_recipe_id)
    from _bf b join public.recipe_ingredients ri on ri.recipe_id = b.bm_id;

  -- canonical ingredients → Taller mirror (links → Taller mirror of the linked canonical;
  -- a link to a BM-only recipe is dropped to NULL on Taller rather than pointing cross-venue)
  insert into public.recipe_ingredients
    (recipe_id, name, ingredient_name, quantity, unit, sort_order, order_idx, notes, is_optional,
     quantity_per_portion, yield_factor, linked_recipe_id, sub_recipe_id)
  select b.taller_id, ri.name, ri.ingredient_name, ri.quantity, ri.unit, ri.sort_order, ri.order_idx, ri.notes, ri.is_optional,
         ri.quantity_per_portion, ri.yield_factor,
         (select b2.taller_id from _bf b2 where b2.canon_id = ri.linked_recipe_id),
         (select b2.taller_id from _bf b2 where b2.canon_id = ri.sub_recipe_id)
    from _bf b join public.recipe_ingredients ri on ri.recipe_id = b.canon_id;

  perform set_config('app.recipe_sync', 'off', true);
  raise notice 'shared backfill: % recipes', (select count(*) from _bf);
end $$;
