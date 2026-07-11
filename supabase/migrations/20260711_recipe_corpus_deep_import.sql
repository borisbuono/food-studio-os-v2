-- Recipe Corpus Deep Import — schema foundation for pulling Boris's Drive
-- recipe archive (folder 1J3A704Hmmk9Ny9ePu6Z2ltMis18whtvT) into first-class
-- recipe rows with structured ingredients, steps, and Calculation
-- (escandallo) support.
--
-- Additive only. Existing recipes/menu_items rows are preserved; new columns
-- are nullable and defaulted.

-- ---------------------------------------------------------------------------
-- recipe_imports — the ingestion log. Every parse attempt gets a row so we
-- can retry, audit, and diff. Status ladder:
--   pending  -> queued, no parse attempted
--   parsing  -> parser running
--   parsed   -> parsed OK, awaiting human confirm-and-save
--   failed   -> parser raised; parse_error holds the reason
--   imported -> parsed row was written into `recipes` (imported_at set)
-- ---------------------------------------------------------------------------
create table if not exists recipe_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('drive_folder','manual_upload','paste','ocr_pdf','ocr_image')),
  external_ref text,
  status text not null default 'pending'
    check (status in ('pending','parsing','parsed','failed','imported')),
  raw_content text,
  parsed_json jsonb,
  parse_error text,
  created_at timestamptz not null default now(),
  imported_at timestamptz,
  imported_by uuid,
  entity_id text
);
create index if not exists idx_recipe_imports_status on recipe_imports(status);
create index if not exists idx_recipe_imports_source on recipe_imports(source);
create index if not exists idx_recipe_imports_external_ref on recipe_imports(external_ref);

-- ---------------------------------------------------------------------------
-- recipes -- additive extensions. All nullable, all defaulted.
-- ---------------------------------------------------------------------------
alter table recipes add column if not exists source_import_id uuid references recipe_imports(id);
alter table recipes add column if not exists yield_grams numeric;
alter table recipes add column if not exists prep_minutes int;
alter table recipes add column if not exists cook_minutes int;
alter table recipes add column if not exists servings int;
alter table recipes add column if not exists cost_per_serving_eur numeric;
alter table recipes add column if not exists difficulty smallint
  check (difficulty is null or (difficulty >= 1 and difficulty <= 5));
alter table recipes add column if not exists last_costed_at timestamptz;

-- ---------------------------------------------------------------------------
-- recipe_ingredients -- create if absent. Columns match app/develop/menu/[id]
-- shape (name/quantity/unit/sort_order/sub_recipe_id/line_cost) plus new
-- import-era fields. Legacy aliases retained for parallel writes.
-- ---------------------------------------------------------------------------
create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null,
  ingredient_name text,
  name text,
  quantity numeric,
  unit text,
  notes text,
  order_idx int default 0,
  sort_order int default 0,
  is_optional boolean default false,
  sub_recipe_id uuid,
  line_cost numeric,
  ingredient_id uuid,
  created_at timestamptz not null default now()
);
alter table recipe_ingredients add column if not exists ingredient_name text;
alter table recipe_ingredients add column if not exists notes text;
alter table recipe_ingredients add column if not exists order_idx int default 0;
alter table recipe_ingredients add column if not exists is_optional boolean default false;
alter table recipe_ingredients add column if not exists ingredient_id uuid;
create index if not exists idx_recipe_ingredients_recipe on recipe_ingredients(recipe_id);

-- ---------------------------------------------------------------------------
-- recipe_steps -- ordered method.
-- ---------------------------------------------------------------------------
create table if not exists recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null,
  order_idx int not null default 0,
  body text not null,
  minutes int,
  temperature_c numeric,
  created_at timestamptz not null default now()
);
create index if not exists idx_recipe_steps_recipe on recipe_steps(recipe_id, order_idx);

-- ---------------------------------------------------------------------------
-- menu_items -- target food cost % per item (default 30% industry rule).
-- ---------------------------------------------------------------------------
alter table menu_items add column if not exists target_food_cost_percent numeric default 30;
alter table menu_items add column if not exists suggested_price numeric;
alter table menu_items add column if not exists food_cost_percent_actual numeric;

-- ---------------------------------------------------------------------------
-- RLS -- permissive default matching the rest of the OS.
-- ---------------------------------------------------------------------------
alter table recipe_imports enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_steps enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'recipe_imports_all') then
    create policy recipe_imports_all on recipe_imports for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'recipe_ingredients_all') then
    create policy recipe_ingredients_all on recipe_ingredients for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'recipe_steps_all') then
    create policy recipe_steps_all on recipe_steps for all using (true) with check (true);
  end if;
end $$;
