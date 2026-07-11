-- Guest self-service · Commit #1 · Public /m QR menu with allergens + dietary + slug
--
-- Ships the schema for the guest-facing QR menu at /m/[slug]:
--   * menu_items.allergens           text[]  — EU-14 allergen list (guest filter chips)
--   * menu_items.dietary             text[]  — vegan/vegetarian/pescatarian/gluten_free/dairy_free
--   * menu_items.published_to_m      boolean — controls visibility on the public menu
--   * menu_items.description_es      text    — Spanish translation for the /m EN/ES/DE switcher
--   * menu_items.description_de      text    — German translation
--   * menu_items.name_es / name_de   text    — translated dish names
--   * restaurants.public_slug        text    — unique URL slug (bistrot-mondo, ibiza-food-lab)
--
-- Additive only. Existing rows default published_to_m = FALSE so nothing leaks to
-- the public menu until a chef opts it in from /develop/menu/publish.
--
-- RLS: /m is anon-read, so we grant anon SELECT on published rows only.
-- Follows the same posture as the Grow pillar (commercials anon-read WHERE active).

alter table public.menu_items
  add column if not exists allergens        text[]  not null default '{}',
  add column if not exists dietary          text[]  not null default '{}',
  add column if not exists published_to_m   boolean not null default false,
  add column if not exists name_es          text,
  add column if not exists name_de          text,
  add column if not exists description_es   text,
  add column if not exists description_de   text;

comment on column public.menu_items.allergens is
  'EU-14 allergen tags. Any subset of: gluten, dairy, nuts, shellfish, eggs, soy, '
  'celery, mustard, sesame, sulphites, lupin, fish, molluscs, peanuts. Used by the '
  '/m QR menu allergen-filter chips — items with a matched allergen are filtered out.';

comment on column public.menu_items.dietary is
  'Dietary compatibility tags. Any subset of: vegan, vegetarian, pescatarian, '
  'gluten_free, dairy_free. Used by the /m QR menu dietary chip filter.';

comment on column public.menu_items.published_to_m is
  'Controls visibility on the guest-facing /m/[slug] QR menu. FALSE by default — '
  'chefs opt items in from /develop/menu/publish (bulk toggle + allergen tagging). '
  'Off-menu bar drinks respected: staff-requestable items live in menu_items with '
  'published_to_m = FALSE, per house rule keep_off_menu_bar_drinks.';

-- Slug on restaurants — canonical stable URL for the public QR
alter table public.restaurants
  add column if not exists public_slug text;

-- Uniqueness constraint (partial: only enforce when slug is set — legacy rows with
-- NULL don't collide).
do $$ begin
  create unique index if not exists idx_restaurants_public_slug
    on public.restaurants (public_slug)
    where public_slug is not null;
exception when duplicate_table then null; end $$;

comment on column public.restaurants.public_slug is
  'URL slug for the public /m/[slug] QR menu. Stable, human-readable, unique. '
  'Examples: bistrot-mondo, ibiza-food-lab, utopia. Set once, do not change — '
  'printed QR codes point at this slug.';

-- Seed slugs for the three known venues so /m/[slug] works out of the gate.
update public.restaurants set public_slug = 'bistrot-mondo'
  where id = 'fb4d008f-2d2a-4e0d-a525-6e0e36af0259' and public_slug is null;
update public.restaurants set public_slug = 'ibiza-food-lab'
  where id = 'ca83e06f-a24d-43d7-bce4-57ac341d190f' and public_slug is null;
update public.restaurants set public_slug = 'utopia'
  where id = 'a0000000-0000-4000-8000-000000000001' and public_slug is null;

-- RLS: anon can read published items on the /m surface. Matches the existing
-- anon-select-on-published posture used by commercials.
do $$ begin
  create policy menu_items_anon_read_published on public.menu_items
    for select to anon using (published_to_m = true and coalesce(is_active, true) = true);
exception when duplicate_object then null; when undefined_table then null; end $$;

-- Anon can read restaurants (slug lookup) — minimal surface, only public columns
-- matter at the app layer. Existing app policies already grant anon read on
-- restaurants in most environments; the DO block guards against duplicates.
do $$ begin
  create policy restaurants_anon_read_slug on public.restaurants
    for select to anon using (true);
exception when duplicate_object then null; when undefined_table then null; end $$;

-- Booking source — extend the enum-ish `source` column so web-book from /m/[slug]/book
-- is a first-class source (differentiates walk-in / phone / QR self-serve).
-- The column already exists (see db/migrations/20260607_floor_bookings.sql).
-- Adding a comment as documentation — the column has no check constraint today.
comment on column public.bookings.source is
  'Booking origin: manual (staff-entered), phone, walkin, fresto (POS import), '
  'web (guest self-service via /m/[slug]/book), private_event.';
