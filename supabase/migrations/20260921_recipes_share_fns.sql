-- recipes: shared-recipe helpers (2026-09-21), used by _menu_backfill and _seed_500.
-- Service-context only (revoked from anon/authenticated).

create or replace function public.fn_recipe_slugify(p text) returns text
language sql stable set search_path = public, pg_temp as $$
  select trim(both '-' from regexp_replace(lower(public.unaccent(coalesce(p, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

-- Create ONE shared recipe: canonical on BBH + a mirror per venue slug in p->'mirrors'.
-- Payload keys: name*, category, cuisine, difficulty (1-5), prep_minutes, cook_minutes,
--   method (markdown), description, story, tagline, yield_qty, yield_unit, servings,
--   section, station, allergens (text[]), is_base_recipe, sell_price_eur (per mirror),
--   public_slug (reserved, NOT published), metadata (merged), mirrors (['bm','taller']),
--   ingredients: [{name, quantity, unit, notes, optional}]
-- Idempotent on (lower(name), metadata.batch): returns the existing canonical id.
create or replace function public.fn_recipe_create_shared(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_bbh constant uuid := 'd1ee19b6-5fb4-460c-8326-685dc86e47df';
  v_id uuid; v_slug text; v_base text; v_n int := 1; v_ent uuid; s text; ing jsonb; i int := 0;
  v_meta jsonb := coalesce(p->'metadata', '{}'::jsonb);
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'name required'; end if;

  select id into v_id from public.recipes
   where origin_recipe_id is null and entity_id = v_bbh
     and lower(trim(name)) = lower(trim(p->>'name'))
     and coalesce(metadata->>'batch', '') = coalesce(v_meta->>'batch', '')
   limit 1;
  if v_id is not null then return v_id; end if;

  if p ? 'public_slug' and coalesce(p->>'public_slug', '') <> '' then
    v_base := public.fn_recipe_slugify(p->>'public_slug');
    v_slug := v_base;
    while exists (select 1 from public.recipes where public_slug = v_slug) loop
      v_n := v_n + 1; v_slug := v_base || '-' || v_n;
    end loop;
  end if;

  perform set_config('app.recipe_sync', 'on', true);

  insert into public.recipes (name, restaurant, section, station, category, cuisine, difficulty,
    prep_minutes, cook_minutes, method, description, story, tagline, yield_qty, yield_unit,
    servings, portions, allergens, is_base_recipe, is_active, entity_id, public_slug, is_public, metadata)
  values (trim(p->>'name'), 'both', coalesce(p->>'section', 'misc'), p->>'station', p->>'category', p->>'cuisine',
    nullif(p->>'difficulty', '')::smallint,
    nullif(p->>'prep_minutes', '')::int, nullif(p->>'cook_minutes', '')::int,
    p->>'method', p->>'description', p->>'story', p->>'tagline',
    nullif(p->>'yield_qty', '')::numeric, p->>'yield_unit',
    nullif(p->>'servings', '')::int, coalesce(nullif(p->>'servings', '')::int, 10),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'allergens', '[]'::jsonb)) x), '{}'),
    coalesce((p->>'is_base_recipe')::boolean, false), true, v_bbh, v_slug, false, v_meta)
  returning id into v_id;

  for ing in select * from jsonb_array_elements(coalesce(p->'ingredients', '[]'::jsonb)) loop
    i := i + 1;
    insert into public.recipe_ingredients (recipe_id, name, ingredient_name, quantity, unit, notes, is_optional, sort_order, order_idx)
    values (v_id, trim(ing->>'name'), trim(ing->>'name'), nullif(ing->>'quantity', ''), nullif(ing->>'unit', ''),
            nullif(ing->>'notes', ''), coalesce((ing->>'optional')::boolean, false), i, i);
  end loop;

  for s in select jsonb_array_elements_text(coalesce(p->'mirrors', '["bm","taller"]'::jsonb)) loop
    select id into v_ent from public.entities where slug = s and entity_type = 'operating_venue';
    if v_ent is null then continue; end if;
    insert into public.recipes (name, restaurant, section, station, category, cuisine, difficulty,
      prep_minutes, cook_minutes, method, description, story, tagline, yield_qty, yield_unit,
      servings, portions, allergens, is_base_recipe, is_active, entity_id, origin_recipe_id,
      sell_price_eur, metadata)
    select name, case s when 'bm' then 'bistro' when 'taller' then 'taller' else s end, section, station, category, cuisine, difficulty,
      prep_minutes, cook_minutes, method, description, story, tagline, yield_qty, yield_unit,
      servings, portions, allergens, is_base_recipe, true, v_ent, v_id,
      nullif(p->'sell_price_eur'->>s, '')::numeric,
      jsonb_build_object('mirror_of', v_id) || (v_meta - 'needs_boris_review')
    from public.recipes where id = v_id
    on conflict do nothing;
  end loop;

  perform public.fn_recipe_sync_mirror_ingredients(v_id);
  perform set_config('app.recipe_sync', 'off', true);
  return v_id;
end $$;

-- Promote an EXISTING venue recipe to shared: canonical copy on BBH, the
-- source row stays in place as its venue's mirror (FKs untouched), new
-- mirrors for the other slugs. Returns the canonical id. Extra metadata merged.
create or replace function public.fn_recipe_share_existing(p_source uuid, p_mirrors text[], p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_bbh constant uuid := 'd1ee19b6-5fb4-460c-8326-685dc86e47df';
  r public.recipes; v_c uuid; s text; v_ent uuid; v_m uuid;
begin
  select * into r from public.recipes where id = p_source;
  if r.id is null then raise exception 'recipe % not found', p_source; end if;
  if r.origin_recipe_id is not null then return r.origin_recipe_id; end if;
  if r.entity_id = v_bbh then return r.id; end if;

  perform set_config('app.recipe_sync', 'on', true);
  insert into public.recipes (name, restaurant, section, portions, description, allergens, allergen_traces, is_active,
    created_by, critical_control_points, cooking_target_temp_c, hold_max_minutes, reheat_required, is_base_recipe,
    voice_statement, hero_image_url, plating_image_url, plating_spec, view_variants, yield_grams, prep_minutes,
    cook_minutes, servings, difficulty, tagline, cover_photo_url, entity_id, station, category, yield_qty, yield_unit,
    portion_size, portion_unit, method, notes, cover_multiplier, cuisine, story, metadata)
  values (r.name, 'both', r.section, r.portions, r.description, r.allergens, r.allergen_traces, true,
    r.created_by, r.critical_control_points, r.cooking_target_temp_c, r.hold_max_minutes, r.reheat_required, r.is_base_recipe,
    r.voice_statement, r.hero_image_url, r.plating_image_url, r.plating_spec, r.view_variants, r.yield_grams, r.prep_minutes,
    r.cook_minutes, r.servings, r.difficulty, r.tagline, r.cover_photo_url, v_bbh, r.station, r.category, r.yield_qty, r.yield_unit,
    r.portion_size, r.portion_unit, r.method, r.notes, r.cover_multiplier, r.cuisine, r.story,
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('from_recipe_id', r.id))
  returning id into v_c;

  insert into public.recipe_ingredients (recipe_id, name, ingredient_name, quantity, unit, sort_order, order_idx, notes,
    is_optional, quantity_per_portion, yield_factor, inventory_item_id, ingredient_id, pantry_item_id, linked_ingredient_id,
    linked_recipe_id, sub_recipe_id)
  select v_c, ri.name, ri.ingredient_name, ri.quantity, ri.unit, ri.sort_order, ri.order_idx, ri.notes,
    ri.is_optional, ri.quantity_per_portion, ri.yield_factor, ri.inventory_item_id, ri.ingredient_id, ri.pantry_item_id, ri.linked_ingredient_id,
    coalesce((select x.origin_recipe_id from public.recipes x where x.id = ri.linked_recipe_id), ri.linked_recipe_id),
    coalesce((select x.origin_recipe_id from public.recipes x where x.id = ri.sub_recipe_id), ri.sub_recipe_id)
  from public.recipe_ingredients ri where ri.recipe_id = r.id;

  update public.recipes set origin_recipe_id = v_c,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('mirror_of', v_c)
   where id = r.id;

  foreach s in array coalesce(p_mirrors, array['bm','taller']) loop
    v_m := null;
    select id into v_ent from public.entities where slug = s and entity_type = 'operating_venue';
    if v_ent is null or v_ent = r.entity_id then continue; end if;
    insert into public.recipes (name, restaurant, section, portions, description, allergens, allergen_traces, is_active,
      is_base_recipe, hero_image_url, yield_grams, prep_minutes, cook_minutes, servings, difficulty, tagline, cover_photo_url,
      entity_id, station, category, yield_qty, yield_unit, portion_size, portion_unit, method, notes, cuisine, story,
      origin_recipe_id, metadata)
    select name, case s when 'bm' then 'bistro' else s end, section, portions, description, allergens, allergen_traces, true,
      is_base_recipe, hero_image_url, yield_grams, prep_minutes, cook_minutes, servings, difficulty, tagline, cover_photo_url,
      v_ent, station, category, yield_qty, yield_unit, portion_size, portion_unit, method, notes, cuisine, story,
      v_c, jsonb_build_object('mirror_of', v_c)
    from public.recipes where id = v_c
    on conflict do nothing
    returning id into v_m;
    -- fill only the NEW mirror's ingredients (source keeps its own rows + line costs)
    if v_m is not null then
      insert into public.recipe_ingredients (recipe_id, name, ingredient_name, quantity, unit, sort_order, order_idx, notes,
        is_optional, quantity_per_portion, yield_factor, linked_recipe_id, sub_recipe_id)
      select v_m, ri.name, ri.ingredient_name, ri.quantity, ri.unit, ri.sort_order, ri.order_idx, ri.notes,
        ri.is_optional, ri.quantity_per_portion, ri.yield_factor,
        (select m.id from public.recipes m join public.recipes me on me.id = v_m where m.origin_recipe_id = ri.linked_recipe_id and m.entity_id = me.entity_id),
        (select m.id from public.recipes m join public.recipes me on me.id = v_m where m.origin_recipe_id = ri.sub_recipe_id and m.entity_id = me.entity_id)
      from public.recipe_ingredients ri where ri.recipe_id = v_c;
    end if;
  end loop;
  perform set_config('app.recipe_sync', 'off', true);
  return v_c;
end $$;

revoke all on function public.fn_recipe_create_shared(jsonb), public.fn_recipe_share_existing(uuid, text[], jsonb) from public, anon, authenticated;
