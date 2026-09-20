-- 2026-09-20 · runway d2 · prep / recipe list module
--
-- MEP was conflating three concepts (prep, cleaning, todo). This migration
-- ships the PREP piece properly — one row per component to build for a
-- service date, per station, with a template layer for the recurring bits.
--
-- Kept intentionally lean: no ingredient / cost joins yet. linked_recipe_id
-- and linked_menu_item_id are nullable placeholders for the future FK once
-- recipes and menu_items are canonical across the three houses.
--
-- Entity refactor 2026-09-20: entity_id is entities.id UUID (not the old
-- string enum). RLS = authenticated read+write, same shape as the other
-- operator-scoped tables (menu_dish_costing, master_todos, etc.).

-- 1) prep_lists ------------------------------------------------------------
create table if not exists public.prep_lists (
  id                  uuid primary key default gen_random_uuid(),
  entity_id           uuid not null references public.entities(id) on delete cascade,
  service_date        date not null,
  station             text,                          -- 'cold' | 'hot' | 'pastry' | 'bar' | 'pizzeria' | free-text
  name                text not null,
  quantity            numeric,
  unit                text,                          -- 'g' | 'kg' | 'unit' | 'portions' | 'l' | 'ml'
  per_cover           numeric,
  target_covers       int,
  status              text not null default 'todo',  -- 'todo' | 'in_progress' | 'done' | 'skipped'
  assignee_id         uuid references auth.users(id),
  notes               text,
  linked_recipe_id    uuid,
  linked_menu_item_id uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,
  completed_by        uuid references auth.users(id)
);

create index if not exists prep_lists_entity_date  on public.prep_lists (entity_id, service_date desc);
create index if not exists prep_lists_status       on public.prep_lists (entity_id, service_date, status);

alter table public.prep_lists enable row level security;

drop policy if exists prep_lists_read_all on public.prep_lists;
create policy prep_lists_read_all on public.prep_lists
  for select using (auth.role() = 'authenticated');

drop policy if exists prep_lists_write_all on public.prep_lists;
create policy prep_lists_write_all on public.prep_lists
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 2) prep_templates --------------------------------------------------------
create table if not exists public.prep_templates (
  id                  uuid primary key default gen_random_uuid(),
  entity_id           uuid not null references public.entities(id) on delete cascade,
  name                text not null,
  station             text,
  active              boolean not null default true,
  applies_days_of_week int[],                       -- [1,2,3,4,5] Mon-Fri, 0=Sun
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists prep_templates_entity_active
  on public.prep_templates (entity_id, active);

alter table public.prep_templates enable row level security;

drop policy if exists prep_templates_read_all on public.prep_templates;
create policy prep_templates_read_all on public.prep_templates
  for select using (auth.role() = 'authenticated');

drop policy if exists prep_templates_write_all on public.prep_templates;
create policy prep_templates_write_all on public.prep_templates
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 3) prep_template_items --------------------------------------------------
create table if not exists public.prep_template_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.prep_templates(id) on delete cascade,
  name         text not null,
  quantity     numeric,
  unit         text,
  per_cover    numeric,
  station      text,
  sort_order   int not null default 0
);

create index if not exists prep_template_items_template
  on public.prep_template_items (template_id, sort_order);

alter table public.prep_template_items enable row level security;

drop policy if exists prep_template_items_read_all on public.prep_template_items;
create policy prep_template_items_read_all on public.prep_template_items
  for select using (auth.role() = 'authenticated');

drop policy if exists prep_template_items_write_all on public.prep_template_items;
create policy prep_template_items_write_all on public.prep_template_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 4) updated_at trigger (shared helper if it exists, else create per-table)
create or replace function public.tg_prep_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prep_lists_touch on public.prep_lists;
create trigger prep_lists_touch
  before update on public.prep_lists
  for each row execute function public.tg_prep_touch_updated_at();

drop trigger if exists prep_templates_touch on public.prep_templates;
create trigger prep_templates_touch
  before update on public.prep_templates
  for each row execute function public.tg_prep_touch_updated_at();
