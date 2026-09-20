-- 2026-09-20 · recipes: real cost per dish from purchase_lines weighted-avg
--
-- Boris asked (2026-09-20) for the recipes module to derive a REAL cost
-- per portion rather than the hand-entered / null cost that /studio/money/
-- menu-margin has been rendering. The source of truth is `purchase_lines`
-- (captured invoices) — never Holded pricing (see memory
-- holded_no_ingredient_prices). Weighted average unit price over the last
-- 30 days per entity, per canonical ingredient.
--
-- Two additive pieces:
--   1) ingredient_aliases — links a raw purchase-line product name to a
--      canonical ingredient name (+ unit + conversion). Boris seeds the
--      obvious cases; the rest gets left blank until someone links it.
--   2) recipes.cost_per_portion_eur / cost_computed_at / cost_confidence —
--      the computed output, so the UI can render without recomputing on
--      every request. `cost_confidence` gates display: MISSING → we do
--      NOT publish a €0 lie.
--
-- Both pieces guard every column with `if not exists` — safe to re-run.

-- 1) ingredient_aliases ---------------------------------------------------
create table if not exists public.ingredient_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities(id) on delete cascade,
  canonical_name  text not null,     -- 'Tomate' | 'Aceite oliva extra virgen' | etc
  alias           text not null,     -- purchase_lines.raw_product_text variant
  unit            text,              -- canonical unit for this ingredient (kg | l | ud)
  unit_conversion numeric default 1, -- multiply alias-unit qty by this to get canonical
  created_at      timestamptz default now(),
  unique (entity_id, alias)
);

create index if not exists ingredient_aliases_entity
  on public.ingredient_aliases(entity_id);
create index if not exists ingredient_aliases_canonical
  on public.ingredient_aliases(entity_id, canonical_name);
create index if not exists ingredient_aliases_alias_lower
  on public.ingredient_aliases(entity_id, lower(alias));

alter table public.ingredient_aliases enable row level security;

drop policy if exists ingredient_aliases_read_auth on public.ingredient_aliases;
create policy ingredient_aliases_read_auth on public.ingredient_aliases
  for select using (auth.role() = 'authenticated');

drop policy if exists ingredient_aliases_write_auth on public.ingredient_aliases;
create policy ingredient_aliases_write_auth on public.ingredient_aliases
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 2) recipes cost columns -------------------------------------------------
alter table public.recipes add column if not exists cost_per_portion_eur numeric;
alter table public.recipes add column if not exists cost_computed_at     timestamptz;
alter table public.recipes add column if not exists cost_confidence      text
  check (cost_confidence is null or cost_confidence in ('high','medium','low','missing'));

create index if not exists recipes_cost_confidence
  on public.recipes(entity_id, cost_confidence)
  where cost_confidence is not null;
