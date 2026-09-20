-- 20260920_entity_uuid_refactor.sql
-- refactor/entity-uuid — additive schema record.
-- Applied to production 2026-09-20 as an additive, data-preserving change:
--   * entities.slug renamed to short forms ('holdings', 'bm', 'taller')
--     on the three primary rows only. All other entity slugs unchanged.
--   * entities.accent_color added and seeded with the ENTITY_ACCENT palette
--     (Holdings olive #3F4C28, BM tomato #9A3122, Taller slate #2B3A45).
--   * pos_credentials table added (entity_id → vendor + env_key_prefix).
--     Secrets stay in Vercel env; DB is the lookup index.
--
-- This file records the schema state. It is written as idempotent so a fresh
-- environment can rerun it safely; on prod every statement is a no-op because
-- the columns / rows already exist.

-- 1) entities.accent_color -------------------------------------------------
ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS accent_color text;

-- Seed the primary three (no-op on rows that already have a colour).
UPDATE public.entities SET accent_color = '#3F4C28'
  WHERE id = 'd1ee19b6-5fb4-460c-8326-685dc86e47df' AND accent_color IS DISTINCT FROM '#3F4C28';
UPDATE public.entities SET accent_color = '#9A3122'
  WHERE id = '387f1045-0340-4029-a1e4-28b15c372680' AND accent_color IS DISTINCT FROM '#9A3122';
UPDATE public.entities SET accent_color = '#2B3A45'
  WHERE id = 'daec58d9-44a2-4c24-9183-2a87219093fb' AND accent_color IS DISTINCT FROM '#2B3A45';

-- Slugs on the primary three (idempotent).
UPDATE public.entities SET slug = 'holdings' WHERE id = 'd1ee19b6-5fb4-460c-8326-685dc86e47df' AND slug IS DISTINCT FROM 'holdings';
UPDATE public.entities SET slug = 'bm'       WHERE id = '387f1045-0340-4029-a1e4-28b15c372680' AND slug IS DISTINCT FROM 'bm';
UPDATE public.entities SET slug = 'taller'   WHERE id = 'daec58d9-44a2-4c24-9183-2a87219093fb' AND slug IS DISTINCT FROM 'taller';

-- 2) pos_credentials --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_credentials (
  entity_id         uuid PRIMARY KEY REFERENCES public.entities(id) ON DELETE CASCADE,
  vendor            text NOT NULL,          -- 'fresto' | 'lightspeed_k' | 'untill' | 'manual'
  external_venue_id text,                   -- vendor-side venue identifier (optional)
  env_key_prefix    text,                   -- e.g. 'FRESTO_BM' → FRESTO_BM_CLIENT_ID + FRESTO_BM_CLIENT_SECRET
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Seed the three primary entities. ON CONFLICT keeps existing rows intact.
INSERT INTO public.pos_credentials (entity_id, vendor, env_key_prefix)
VALUES
  ('387f1045-0340-4029-a1e4-28b15c372680', 'fresto', 'FRESTO_BM'),
  ('daec58d9-44a2-4c24-9183-2a87219093fb', 'fresto', 'FRESTO_IFL'),
  ('d1ee19b6-5fb4-460c-8326-685dc86e47df', 'manual', NULL)
ON CONFLICT (entity_id) DO NOTHING;
