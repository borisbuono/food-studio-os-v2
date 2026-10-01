-- Menu-first loop, slice 1 — menu item <-> recipe binding (2026-10-01).
--
-- Boris's ruling: the printed menu is the root object. Every menu_items row
-- on a current menu binds to the recipe we hold (or a shell), and the bind
-- carries HOW it was made (exact / fuzzy / semantic / shell / human) and how
-- sure we are, so a low-confidence match is a question on the row, not a
-- silent guess (Foundation §6.4).

alter table public.menu_items
  add column if not exists recipe_match_method text
    check (recipe_match_method is null or recipe_match_method in ('exact','fuzzy','semantic','shell','human','none')),
  add column if not exists recipe_match_score numeric,
  add column if not exists recipe_candidates jsonb,
  add column if not exists bound_at timestamptz,
  add column if not exists cost_confidence text
    check (cost_confidence is null or cost_confidence in ('real','estimate','partial','unbound','no_recipe')),
  add column if not exists costed_at timestamptz;

comment on column public.menu_items.recipe_match_method is 'how recipe_id was set: exact|fuzzy|semantic (model) |shell (created for it) |human (tapped) |none (no recipe applies, e.g. a bottle of wine)';
comment on column public.menu_items.recipe_candidates is '[{recipe_id,name,score}] the 3 nearest recipes at bind time — the Bind control offers these';

-- Normalised name for matching: unaccent, lower, strip punctuation, collapse spaces.
create or replace function public.fn_name_norm(t text) returns text
language sql immutable parallel safe as $$
  select trim(regexp_replace(regexp_replace(lower(public.unaccent(coalesce(t,''))), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- Nearest recipes for a menu item, scoped to the item's venue (its own rows,
-- mirrors included) plus Holdings canonicals that have NO mirror in that venue
-- yet (those get shared on bind). Score = max(trgm similarity, word similarity).
create or replace function public.fn_menu_item_recipe_candidates(p_item uuid, p_limit int default 3)
returns table (recipe_id uuid, name text, score numeric, entity_id uuid, line_count int, needs_share boolean)
language sql stable security invoker as $$
  with it as (
    select mi.id, mi.name, r.entity_id
    from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
    where mi.id = p_item
  ), pool as (
    select rc.id, rc.name, rc.entity_id,
           (rc.entity_id = 'd1ee19b6-5fb4-460c-8326-685dc86e47df'::uuid) as is_bbh
    from public.recipes rc, it
    where coalesce(rc.is_archived,false) = false and rc.is_active
      and (rc.entity_id = it.entity_id
           or (rc.entity_id = 'd1ee19b6-5fb4-460c-8326-685dc86e47df'::uuid and rc.origin_recipe_id is null
               and not exists (select 1 from public.recipes m where m.origin_recipe_id = rc.id and m.entity_id = it.entity_id)))
  )
  select p.id, p.name,
         greatest(similarity(public.fn_name_norm(it.name), public.fn_name_norm(p.name)),
                  word_similarity(public.fn_name_norm(it.name), public.fn_name_norm(p.name)))::numeric as score,
         p.entity_id,
         (select count(*)::int from public.recipe_ingredients ri where ri.recipe_id = p.id) as line_count,
         p.is_bbh as needs_share
  from pool p, it
  order by 3 desc, 5 desc
  limit p_limit
$$;

-- One tap: bind a menu item to a recipe. A Holdings canonical is shared into
-- the venue first so the item always points at a venue row (costs are per
-- venue). method 'human' = a person set it; score 1.
create or replace function public.menu_item_bind_recipe(p_item uuid, p_recipe uuid, p_method text default 'human', p_score numeric default 1)
returns uuid
language plpgsql security invoker set search_path to 'public','pg_temp' as $$
declare v_ent uuid; v_slug text; v_recipe public.recipes; v_target uuid; v_canon uuid;
begin
  select r.entity_id, e.slug into v_ent, v_slug
    from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id join public.entities e on e.id = r.entity_id
   where mi.id = p_item;
  if v_ent is null then raise exception 'menu item % not found', p_item; end if;
  select * into v_recipe from public.recipes where id = p_recipe;
  if v_recipe.id is null then raise exception 'recipe % not found', p_recipe; end if;

  if v_recipe.entity_id = v_ent then
    v_target := v_recipe.id;
  else
    -- a canonical (or another venue's row): make sure a mirror exists in this venue
    v_canon := coalesce(v_recipe.origin_recipe_id, v_recipe.id);
    select id into v_target from public.recipes where origin_recipe_id = v_canon and entity_id = v_ent limit 1;
    if v_target is null then
      perform public.fn_recipe_share_existing(v_canon, array[v_slug], '{}'::jsonb);
      select id into v_target from public.recipes where origin_recipe_id = v_canon and entity_id = v_ent limit 1;
    end if;
    if v_target is null then raise exception 'could not mirror recipe % into %', v_canon, v_slug; end if;
  end if;

  update public.menu_items
     set recipe_id = v_target, recipe_match_method = coalesce(p_method,'human'), recipe_match_score = coalesce(p_score,1),
         bound_at = now(), updated_at = now()
   where id = p_item;
  return v_target;
end $$;

-- One tap: no recipe yet — create a SHELL (name, section, menu description as
-- the ingredient list, needs_boris_review) and bind it. Shells never publish.
create or replace function public.menu_item_create_shell(p_item uuid)
returns uuid
language plpgsql security invoker set search_path to 'public','pg_temp' as $$
declare v_mi public.menu_items; v_slug text; v_ent uuid; v_canon uuid; v_target uuid; v_ings jsonb;
begin
  select mi.* into v_mi from public.menu_items mi where mi.id = p_item;
  if v_mi.id is null then raise exception 'menu item % not found', p_item; end if;
  select e.slug, e.id into v_slug, v_ent from public.restaurants r join public.entities e on e.id = r.entity_id where r.id = v_mi.restaurant_id;
  -- description "a, b, c" / "a · b · c" → ingredient names, no quantities
  select coalesce(jsonb_agg(jsonb_build_object('name', trim(x))), '[]'::jsonb) into v_ings
    from unnest(regexp_split_to_array(coalesce(v_mi.description,''), '\s*[,·;]\s*')) x where trim(x) <> '';
  v_canon := public.fn_recipe_create_shared(jsonb_build_object(
    'name', v_mi.name, 'section', coalesce(v_mi.section,'misc'), 'category', coalesce(v_mi.section,'misc'),
    'servings', 1, 'ingredients', v_ings, 'mirrors', jsonb_build_array(v_slug),
    'sell_price_eur', jsonb_build_object(v_slug, v_mi.price),
    'metadata', jsonb_build_object('status','shell','origin','menu-shell','needs_boris_review', true, 'menu_item_id', v_mi.id, 'batch', 'menu_first_'||to_char(now(),'YYYY-MM-DD'))));
  select id into v_target from public.recipes where origin_recipe_id = v_canon and entity_id = v_ent limit 1;
  update public.menu_items set recipe_id = coalesce(v_target, v_canon), recipe_match_method = 'shell', recipe_match_score = 1,
         bound_at = now(), updated_at = now() where id = p_item;
  return coalesce(v_target, v_canon);
end $$;

grant execute on function public.fn_menu_item_recipe_candidates(uuid, int) to authenticated;
grant execute on function public.menu_item_bind_recipe(uuid, uuid, text, numeric) to authenticated;
grant execute on function public.menu_item_create_shell(uuid) to authenticated;
