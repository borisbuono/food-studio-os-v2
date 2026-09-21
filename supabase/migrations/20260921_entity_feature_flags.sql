-- 20260921_entity_feature_flags.sql
--
-- Studio + House chrome polish (command palette tenant filter). Four
-- per-entity feature flags the chrome reads to decide which surfaces a
-- house has switched on. The command palette hides FOH / bookings /
-- hiring / academy routes for an entity that has them off, so a
-- kitchen-only tenant never sees a Dining Room or Bookings entry it
-- can't use.
--
-- Defaults: ON for operating venues (every live house today runs a dining
-- room, takes bookings, hires and trains), OFF for everything else
-- (holding, advisory clients, partners, landlords have no dining room /
-- bookings / academy of their own). Additive + idempotent — safe to
-- re-apply.

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS foh_enabled      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bookings_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hiring_enabled   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS academy_enabled  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.entities.foh_enabled      IS 'House runs a dining room (FOH surfaces visible in chrome + palette).';
COMMENT ON COLUMN public.entities.bookings_enabled IS 'House takes reservations (bookings surfaces visible in chrome + palette).';
COMMENT ON COLUMN public.entities.hiring_enabled   IS 'House is hiring (HR funnel surfaces visible in chrome + palette).';
COMMENT ON COLUMN public.entities.academy_enabled  IS 'House runs a training academy (Academy surfaces visible in chrome + palette).';

UPDATE public.entities
   SET foh_enabled = false,
       bookings_enabled = false,
       hiring_enabled = false,
       academy_enabled = false
 WHERE entity_type NOT IN ('operating_venue', 'operating')
   AND (foh_enabled OR bookings_enabled OR hiring_enabled OR academy_enabled);
