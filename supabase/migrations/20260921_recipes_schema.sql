-- recipes: _schema (2026-09-21)
-- Recipe layer: shared canonical recipes (BBH) mirrored onto BM + Taller,
-- public recipes at /recipes/<slug>, seed review queue.
--
-- Deviations from the brief, on purpose:
--  * difficulty / prep_minutes / cook_minutes / category / hero_image_url
--    ALREADY exist (difficulty = smallint 1-5, the parser's scale). Reused,
--    not duplicated — "ADD COLUMN IF NOT EXISTS difficulty text" would have
--    silently no-op'd and every text insert would then fail.
--  * recipes had no metadata column → added (needs_boris_review lives there).
--  * Mirrors keep a SYNCED COPY of the canonical's ingredients instead of
--    reading through a join: computeCost, menu-margin, variance, cook view,
--    explode-to-prep all read recipe_ingredients by recipe_id. A copy keeps
--    every one of those working untouched and lets each venue price the
--    same list against its own invoices.

alter table public.recipes
  add column if not exists origin_recipe_id uuid references public.recipes(id) on delete set null,
  add column if not exists is_public boolean not null default false,
  add column if not exists public_slug text,
  add column if not exists cuisine text,
  add column if not exists author_person_id uuid references public.team_members(id) on delete set null,
  add column if not exists story text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists recipes_public_slug_key on public.recipes (public_slug) where public_slug is not null;
create index if not exists recipes_public on public.recipes (public_slug) where is_public;
create index if not exists recipes_origin on public.recipes (origin_recipe_id) where origin_recipe_id is not null;
create unique index if not exists recipes_one_mirror_per_entity on public.recipes (origin_recipe_id, entity_id) where origin_recipe_id is not null;
create index if not exists recipes_needs_review on public.recipes ((metadata->>'needs_boris_review')) where metadata ? 'needs_boris_review';

alter table public.recipes drop constraint if exists recipes_mirror_not_public;
alter table public.recipes add constraint recipes_mirror_not_public
  check (origin_recipe_id is null or (is_public = false and public_slug is null));
alter table public.recipes drop constraint if exists recipes_public_needs_slug;
alter table public.recipes add constraint recipes_public_needs_slug
  check (not is_public or public_slug is not null);
alter table public.recipes drop constraint if exists recipes_public_slug_format;
alter table public.recipes add constraint recipes_public_slug_format
  check (public_slug is null or public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- ---------------------------------------------------------------------------
-- Ingredient sync: canonical → every mirror (linked sub-recipes remapped to
-- the mirror of that sub-recipe in the same venue when one exists).
-- ---------------------------------------------------------------------------
create or replace function public.fn_recipe_sync_mirror_ingredients(p_canonical uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m record;
begin
  perform set_config('app.recipe_sync', 'on', true);
  for m in select id, entity_id from public.recipes where origin_recipe_id = p_canonical loop
    delete from public.recipe_ingredients where recipe_id = m.id;
    insert into public.recipe_ingredients
      (recipe_id, name, ingredient_name, quantity, unit, sort_order, order_idx, notes, is_optional,
       quantity_per_portion, yield_factor, linked_recipe_id, sub_recipe_id)
    select m.id, ri.name, ri.ingredient_name, ri.quantity, ri.unit, ri.sort_order, ri.order_idx, ri.notes, ri.is_optional,
           ri.quantity_per_portion, ri.yield_factor,
           coalesce((select mm.id from public.recipes mm where mm.origin_recipe_id = ri.linked_recipe_id and mm.entity_id = m.entity_id), ri.linked_recipe_id),
           coalesce((select mm.id from public.recipes mm where mm.origin_recipe_id = ri.sub_recipe_id and mm.entity_id = m.entity_id), ri.sub_recipe_id)
      from public.recipe_ingredients ri where ri.recipe_id = p_canonical;
  end loop;
  perform set_config('app.recipe_sync', 'off', true);
end $$;
revoke all on function public.fn_recipe_sync_mirror_ingredients(uuid) from public, anon, authenticated;

create or replace function public.tg_recipe_ingredients_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid := coalesce(new.recipe_id, old.recipe_id);
begin
  if current_setting('app.recipe_sync', true) = 'on' then return null; end if;
  if exists (select 1 from public.recipes where origin_recipe_id = rid) then
    perform public.fn_recipe_sync_mirror_ingredients(rid);
  end if;
  return null;
end $$;

drop trigger if exists trg_recipe_ingredients_sync on public.recipe_ingredients;
create trigger trg_recipe_ingredients_sync
after insert or update or delete on public.recipe_ingredients
for each row execute function public.tg_recipe_ingredients_sync();

-- Mirrors are read-only: ingredient writes on a mirror only via the sync.
-- Cost columns (line_cost) stay writable so venue costing keeps working.
create or replace function public.tg_recipe_ingredients_mirror_guard() returns trigger
language plpgsql as $$
declare rid uuid := coalesce(new.recipe_id, old.recipe_id);
begin
  if current_setting('app.recipe_sync', true) = 'on' then return coalesce(new, old); end if;
  if auth.uid() is null then return coalesce(new, old); end if; -- service / migration / cascade
  if exists (select 1 from public.recipes where id = rid and origin_recipe_id is not null) then
    if tg_op = 'UPDATE' and (new.name, new.ingredient_name, new.quantity, new.unit, new.linked_recipe_id, new.sub_recipe_id, new.is_optional)
         is not distinct from (old.name, old.ingredient_name, old.quantity, old.unit, old.linked_recipe_id, old.sub_recipe_id, old.is_optional) then
      return new; -- cost / link-id housekeeping only
    end if;
    raise exception 'recipe % is a mirror — edit the origin recipe', rid using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_recipe_ingredients_mirror_guard on public.recipe_ingredients;
create trigger trg_recipe_ingredients_mirror_guard
before insert or update or delete on public.recipe_ingredients
for each row execute function public.tg_recipe_ingredients_mirror_guard();

-- ---------------------------------------------------------------------------
-- Recipe-row propagation: canonical content → mirrors. Only content columns;
-- cost / station / section / venue fields stay per venue.
-- ---------------------------------------------------------------------------
create or replace function public.fn_propagate_recipe_edit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.origin_recipe_id is null then
    perform set_config('app.recipe_sync', 'on', true);
    update public.recipes m
       set name = new.name, method = new.method, description = new.description,
           prep_minutes = new.prep_minutes, cook_minutes = new.cook_minutes,
           difficulty = new.difficulty, story = new.story, hero_image_url = new.hero_image_url,
           category = new.category, cuisine = new.cuisine, tagline = new.tagline,
           allergens = new.allergens, allergen_traces = new.allergen_traces,
           yield_qty = new.yield_qty, yield_unit = new.yield_unit, servings = new.servings,
           portions = new.portions, portion_size = new.portion_size, portion_unit = new.portion_unit,
           is_base_recipe = new.is_base_recipe, author_person_id = new.author_person_id
     where m.origin_recipe_id = new.id;
    perform set_config('app.recipe_sync', 'off', true);
  end if;
  return new;
end $$;

drop trigger if exists trg_propagate_recipe_edit on public.recipes;
create trigger trg_propagate_recipe_edit
after update on public.recipes
for each row
when (old.origin_recipe_id is null and (
  (old.name, old.method, old.description, old.prep_minutes, old.cook_minutes, old.difficulty, old.story,
   old.hero_image_url, old.category, old.cuisine, old.tagline, old.allergens, old.allergen_traces,
   old.yield_qty, old.yield_unit, old.servings, old.portions, old.portion_size, old.portion_unit,
   old.is_base_recipe, old.author_person_id)
  is distinct from
  (new.name, new.method, new.description, new.prep_minutes, new.cook_minutes, new.difficulty, new.story,
   new.hero_image_url, new.category, new.cuisine, new.tagline, new.allergens, new.allergen_traces,
   new.yield_qty, new.yield_unit, new.servings, new.portions, new.portion_size, new.portion_unit,
   new.is_base_recipe, new.author_person_id)))
execute function public.fn_propagate_recipe_edit();

-- Guard: mirror content is read-only; is_public only flips for an owner.
create or replace function public.tg_recipes_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Service/migration context (no JWT user) is trusted.
  if auth.uid() is null then return new; end if;

  if tg_op = 'UPDATE' and old.origin_recipe_id is not null
     and coalesce(current_setting('app.recipe_sync', true), 'off') <> 'on'
     and (old.name, old.method, old.description, old.story, old.prep_minutes, old.cook_minutes, old.difficulty)
         is distinct from (new.name, new.method, new.description, new.story, new.prep_minutes, new.cook_minutes, new.difficulty) then
    raise exception 'recipe % is a mirror — edit the origin recipe', old.id using errcode = '42501';
  end if;

  if (tg_op = 'INSERT' and (new.is_public or new.public_slug is not null))
     or (tg_op = 'UPDATE' and (new.is_public is distinct from old.is_public or new.public_slug is distinct from old.public_slug)) then
    if not exists (
      select 1 from public.team_members tm join public.memberships m on m.person_id = tm.id
       where tm.auth_user_id = auth.uid() and m.status = 'active' and lower(m.role) = 'owner'
         and m.entity_id = new.entity_id) then
      raise exception 'only an owner can publish a recipe' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_recipes_guard on public.recipes;
create trigger trg_recipes_guard before insert or update on public.recipes
for each row execute function public.tg_recipes_guard();

-- ---------------------------------------------------------------------------
-- RLS extension: members of any venue holding a mirror can READ the
-- canonical (and its ingredients); managers of such a venue can EDIT it
-- (Boris ruling 1: edits propagate BM ↔ IFS).
-- ---------------------------------------------------------------------------
create or replace function public.fn_recipe_mirror_readable(p_recipe uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.recipes m
                  where m.origin_recipe_id = p_recipe
                    and m.entity_id in (select public.current_person_entities()));
$$;
create or replace function public.fn_recipe_mirror_manageable(p_recipe uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.recipes m
                  where m.origin_recipe_id = p_recipe
                    and m.entity_id in (select public.app_my_managed_entities()));
$$;
revoke all on function public.fn_recipe_mirror_readable(uuid), public.fn_recipe_mirror_manageable(uuid) from public, anon;
grant execute on function public.fn_recipe_mirror_readable(uuid), public.fn_recipe_mirror_manageable(uuid) to authenticated;

drop policy if exists recipes_canonical_select_via_mirror on public.recipes;
create policy recipes_canonical_select_via_mirror on public.recipes for select to authenticated
  using (origin_recipe_id is null and public.fn_recipe_mirror_readable(id));
drop policy if exists recipes_canonical_update_via_mirror on public.recipes;
create policy recipes_canonical_update_via_mirror on public.recipes for update to authenticated
  using (origin_recipe_id is null and public.fn_recipe_mirror_manageable(id))
  with check (origin_recipe_id is null and public.fn_recipe_mirror_manageable(id));

drop policy if exists recipe_ingredients_canonical_select_via_mirror on public.recipe_ingredients;
create policy recipe_ingredients_canonical_select_via_mirror on public.recipe_ingredients for select to authenticated
  using (public.fn_recipe_mirror_readable(recipe_id));
drop policy if exists recipe_ingredients_canonical_write_via_mirror on public.recipe_ingredients;
create policy recipe_ingredients_canonical_write_via_mirror on public.recipe_ingredients for all to authenticated
  using (public.fn_recipe_mirror_manageable(recipe_id))
  with check (public.fn_recipe_mirror_manageable(recipe_id));

-- ---------------------------------------------------------------------------
-- Public read — anon never touches the table. One SECURITY DEFINER RPC
-- returns a published canonical by slug, only once Boris has reviewed it.
-- ---------------------------------------------------------------------------
create or replace function public.public_recipe_by_slug(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'slug', r.public_slug, 'name', r.name, 'tagline', r.tagline, 'story', r.story,
    'description', r.description, 'method', r.method, 'category', r.category, 'cuisine', r.cuisine,
    'difficulty', r.difficulty, 'prep_minutes', r.prep_minutes, 'cook_minutes', r.cook_minutes,
    'yield_qty', r.yield_qty, 'yield_unit', r.yield_unit, 'servings', coalesce(r.servings, r.portions),
    'hero_image_url', coalesce(r.hero_image_url, r.cover_photo_url), 'allergens', r.allergens,
    'updated_at', r.updated_at,
    'ingredients', coalesce((select jsonb_agg(jsonb_build_object(
        'name', coalesce(ri.ingredient_name, ri.name), 'quantity', ri.quantity, 'unit', ri.unit,
        'notes', ri.notes, 'optional', ri.is_optional)
        order by coalesce(ri.sort_order, ri.order_idx, 0))
        from public.recipe_ingredients ri where ri.recipe_id = r.id), '[]'::jsonb))
  from public.recipes r
  where r.public_slug = p_slug and r.is_public and r.origin_recipe_id is null
    and coalesce(r.is_archived, false) = false
    and coalesce((r.metadata->>'needs_boris_review')::boolean, false) = false
  limit 1;
$$;
revoke all on function public.public_recipe_by_slug(text) from public;
grant execute on function public.public_recipe_by_slug(text) to anon, authenticated;
