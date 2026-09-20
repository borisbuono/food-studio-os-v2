-- Posting-calendar approval audit columns on social_posts.
--
-- The Meta stack was deployed directly against the DB (dashboard/CLI) rather
-- than through this repo's migrations, so repo migrations already disagree
-- with the live schema. This file is intentionally minimal: it stamps the two
-- columns the calendar UI writes to (approved_by_user + approved_at), so a
-- fresh clone can replay them.
--
-- approved_by_boris (boolean) already exists in live and is the gate the
-- meta-publish edge function reads. This migration does NOT redefine it.

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS approved_by_user uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
