-- 2026-09-11 · overnight menu-to-recipe margin calculator
--
-- Boris asked for a menu-margin table wired to the live menu markdown +
-- the existing recipe cost basis. He knows the plumbing is thin: cf.
-- catalogue_has_no_unit_contract (67/694), holded_no_ingredient_prices,
-- bm_food_draft_lag_explains_month_not_year. This is the boneless
-- version — one row per menu dish, cost drawn from recipes.cost_per_portion
-- with pantry_item_id → purchase_lines fallback where the linkage exists.
--
-- Cost confidence:
--   high    all matched components had a purchase_lines price ≤30 days old
--   medium  cost is populated but leans on recipes.cost_per_portion (baked)
--           or older purchase prices — human-entered where linkage is thin
--   low     no recipe match, or matched recipe has cost = 0
--
-- Consumed by /studio/money/menu-margin.

create table if not exists menu_dish_costing (
  id                 uuid primary key default gen_random_uuid(),
  venue              text not null check (venue in ('bm','taller')),
  section            text,
  dish_slug          text not null,
  dish_name          text not null,
  sell_price_eur     numeric,
  matched_recipe_id  uuid references recipes(id) on delete set null,
  matched_recipe_name text,
  match_score        numeric,
  component_count    integer default 0,
  cost_per_portion_eur numeric,
  gross_margin_eur   numeric,
  gross_margin_pct   numeric,
  cost_confidence    text check (cost_confidence in ('high','medium','low')),
  missing_components jsonb default '[]'::jsonb,
  computed_at        timestamptz not null default now(),
  unique (venue, dish_slug)
);

create index if not exists menu_dish_costing_venue_margin_idx
  on menu_dish_costing (venue, gross_margin_pct);

alter table menu_dish_costing enable row level security;

-- Same read policy shape as eod_pos / eod_accounting: any signed-in user
-- inside the OS may read; nothing outside writes.
drop policy if exists menu_dish_costing_read_all on menu_dish_costing;
create policy menu_dish_costing_read_all on menu_dish_costing
  for select using (auth.role() = 'authenticated');
