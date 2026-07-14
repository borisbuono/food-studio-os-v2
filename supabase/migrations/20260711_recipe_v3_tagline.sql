-- Recipe v3 — tagline + cover_photo_url. Both nullable, no default. These
-- are the two content fields that turn on the editorial recipe surface: the
-- italic caption that sits bottom-left on the moody cover, and a real photo
-- URL for when we've shot one (SVG placeholder chain covers the rest).
--
-- Applied via `supabase db push` or the Supabase SQL editor. Idempotent —
-- ADD COLUMN IF NOT EXISTS is safe to re-run.

alter table public.recipes
  add column if not exists tagline text,
  add column if not exists cover_photo_url text;

-- Sensible comments for future readers of the schema.
comment on column public.recipes.tagline is
  'Optional italic caption shown bottom-left on the moody recipe cover when no photo is set. Editorial voice — e.g. "Fisherman, 6am. Twelve minutes later, dinner." Nullable.';
comment on column public.recipes.cover_photo_url is
  'Optional URL for a real photo used as the recipe cover. Overrides the procedural SVG cover. Nullable — most recipes are still SVG-cover-only.';
