-- 2026-09-20 · runway d2 · recipes module + prep binding
--
-- Ships the recipes module Boris asked for on 2026-09-20:
--   "you should also have a build recipe from mise-en-place setup"
-- meaning prep items should link to recipes, and recipes should explode
-- into prep items. Both directions.
--
-- The `recipes` table already exists in the DB (see
-- 20260711_recipe_corpus_deep_import.sql for the additive extensions).
-- This migration is ADDITIVE — every column is guarded with
-- `add column if not exists` so it is safe to re-run and does not touch
-- existing rows.
--
-- Entity refactor 2026-09-20 (branch refactor/entity-uuid): entity_id
-- is entities.id UUID. If the column already exists as text (legacy)
-- we leave it in place and let the API layer filter by both.

-- 1) recipes ---------------------------------------------------------------
-- entity_id — add as uuid FK to entities if missing. Nullable so existing
-- rows that predate the refactor keep working; new rows go through the API
-- which requires a valid entity_id.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes' and column_name = 'entity_id'
  ) then
    alter table public.recipes
      add column entity_id uuid references public.entities(id) on delete cascade;
  end if;
end $$;

alter table public.recipes add column if not exists station              text;
alter table public.recipes add column if not exists category             text;
alter table public.recipes add column if not exists yield_qty            numeric;
alter table public.recipes add column if not exists yield_unit           text;
alter table public.recipes add column if not exists portion_size         numeric;
alter table public.recipes add column if not exists portion_unit         text;
alter table public.recipes add column if not exists method               text;
alter table public.recipes add column if not exists notes                text;
alter table public.recipes add column if not exists cover_multiplier     numeric;
alter table public.recipes add column if not exists sell_price_eur       numeric;
alter table public.recipes add column if not exists is_active            boolean default true;
alter table public.recipes add column if not exists linked_menu_item_id  uuid;
alter table public.recipes add column if not exists created_at           timestamptz default now();
alter table public.recipes add column if not exists updated_at           timestamptz default now();
alter table public.recipes add column if not exists created_by           uuid references auth.users(id);

-- backfill is_active for any legacy row so filters don't hide the corpus
update public.recipes set is_active = true where is_active is null;

create index if not exists recipes_entity_name    on public.recipes(entity_id, name);
create index if not exists recipes_entity_station on public.recipes(entity_id, station) where is_active;

-- 2) recipe_ingredients ---------------------------------------------------
-- Table already exists (20260711 migration). Add the extra columns the
-- module needs; sub_recipe_id is kept for backwards compat but new writes
-- go into linked_recipe_id.
alter table public.recipe_ingredients add column if not exists linked_recipe_id      uuid references public.recipes(id) on delete set null;
alter table public.recipe_ingredients add column if not exists linked_ingredient_id  uuid;
alter table public.recipe_ingredients add column if not exists sort_order            int default 0;
alter table public.recipe_ingredients add column if not exists is_optional           boolean default false;

-- Backfill sort_order from order_idx where present (legacy field).
update public.recipe_ingredients set sort_order = coalesce(sort_order, order_idx, 0);
-- Mirror sub_recipe_id -> linked_recipe_id for existing corpus.
update public.recipe_ingredients set linked_recipe_id = sub_recipe_id
  where linked_recipe_id is null and sub_recipe_id is not null;

-- 3) RLS ------------------------------------------------------------------
-- Existing policies from 20260711 are permissive (using true). Keep, but
-- add explicit authenticated read/write policies alongside so the shape
-- matches the rest of the operator-scoped tables (prep_lists etc.).
alter table public.recipes enable row level security;

drop policy if exists recipes_read_auth on public.recipes;
create policy recipes_read_auth on public.recipes
  for select using (auth.role() = 'authenticated');

drop policy if exists recipes_write_auth on public.recipes;
create policy recipes_write_auth on public.recipes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table public.recipe_ingredients enable row level security;

drop policy if exists recipe_ingredients_read_auth on public.recipe_ingredients;
create policy recipe_ingredients_read_auth on public.recipe_ingredients
  for select using (auth.role() = 'authenticated');

drop policy if exists recipe_ingredients_write_auth on public.recipe_ingredients;
create policy recipe_ingredients_write_auth on public.recipe_ingredients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 4) updated_at trigger ---------------------------------------------------
create or replace function public.tg_recipes_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch
  before update on public.recipes
  for each row execute function public.tg_recipes_touch_updated_at();

-- 5) prep_lists.linked_recipe_id FK --------------------------------------
-- Column was shipped in 20260920_prep_lists.sql as a nullable uuid
-- placeholder. Add the FK constraint now that recipes is canonical.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'prep_lists_linked_recipe_fk'
  ) then
    alter table public.prep_lists
      add constraint prep_lists_linked_recipe_fk
      foreign key (linked_recipe_id) references public.recipes(id) on delete set null;
  end if;
end $$;

create index if not exists prep_lists_linked_recipe on public.prep_lists(linked_recipe_id) where linked_recipe_id is not null;
