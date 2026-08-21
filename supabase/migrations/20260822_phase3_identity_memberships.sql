-- Phase 3: identity + memberships (2026-08-22, plan `os_consolidation_plan_2026-08-22`)
-- Person is permanent. Roles / venues / status are temporary.
--
-- SCHEMA DECISION (deviation from plan): the plan proposed person_id ->
-- profiles(id), but public.profiles has a hard FK to auth.users(id) so it can
-- only hold rows for people who have logged in. 23 of 25 team_members have
-- no auth account yet. To honour "person = permanent, may or may not have an
-- auth user", the roster identity lives in public.team_members (as it already
-- does today) and memberships.person_id references team_members(id).
-- A new team_members.auth_user_id column stitches an auth session -> roster row.
-- Profiles is unchanged (identity-of-the-signed-in-user only).
--
-- RLS CAUTION — the 2026-08-18 outage was caused by profiles referencing
-- profiles in its own qual. On memberships and profiles here we never subquery
-- those tables inside their own policies; owner-read uses team_members.

-- 1. TABLES ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE RESTRICT,
  entity_id uuid NOT NULL REFERENCES public.entities(id)    ON DELETE RESTRICT,
  role text NOT NULL,       -- owner | manager | chef | maitre | worker | advisor | partner_seat
  area text,                -- foh | boh | admin | pastry | bar
  status text NOT NULL DEFAULT 'active',   -- active | dormant | ended
  is_default boolean NOT NULL DEFAULT false,
  started_at date NOT NULL DEFAULT CURRENT_DATE,
  ended_at date,
  notes text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memberships_person_idx ON public.memberships(person_id);
CREATE INDEX IF NOT EXISTS memberships_entity_idx ON public.memberships(entity_id);
CREATE INDEX IF NOT EXISTS memberships_active_idx ON public.memberships(entity_id) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_default_per_person
  ON public.memberships(person_id) WHERE is_default = true;
CREATE UNIQUE INDEX IF NOT EXISTS memberships_unique_active
  ON public.memberships(person_id, entity_id, role) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.authored_by (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_type text NOT NULL,   -- recipe | menu | dish | technique | escandallo
  work_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE RESTRICT,
  contribution_type text NOT NULL DEFAULT 'author',  -- author | co_author | adapter | trainer
  created_at timestamptz DEFAULT now(),
  UNIQUE (work_type, work_id, person_id, contribution_type)
);
CREATE INDEX IF NOT EXISTS authored_by_person_idx ON public.authored_by(person_id);
CREATE INDEX IF NOT EXISTS authored_by_work_idx   ON public.authored_by(work_type, work_id);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_person_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE RESTRICT,
  referred_entity_id uuid NOT NULL REFERENCES public.entities(id)      ON DELETE RESTRICT,
  arrangement jsonb NOT NULL DEFAULT '{}',    -- rev_share_pct, months, floor, notes
  status text NOT NULL DEFAULT 'active',      -- active | expired | ended
  started_at date NOT NULL DEFAULT CURRENT_DATE,
  ended_at date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals(referrer_person_id);
CREATE INDEX IF NOT EXISTS referrals_entity_idx   ON public.referrals(referred_entity_id);

-- Link an auth session to a roster row.
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS team_members_auth_user_idx ON public.team_members(auth_user_id);

COMMENT ON COLUMN public.memberships.person_id IS
  'FK -> team_members(id). team_members is the person roster; a person MAY or may not have an auth.users login.';
COMMENT ON COLUMN public.team_members.auth_user_id IS
  'Optional link from a Supabase auth user to this roster row. Backfilled from email match; not enforced (team_members may have no auth account).';
COMMENT ON COLUMN public.profiles.restaurant_id IS
  'DEPRECATED as of Phase 3 (2026-08-22). Person->venue link now lives in public.memberships. Kept for back-compat with app code that still reads it; will be removed after all reads migrate to memberships.';

-- 2. SECURITY DEFINER helpers (call from any other table''s RLS; never from ---
--    memberships/profiles themselves) -----------------------------------------
CREATE OR REPLACE FUNCTION public.current_person_entities()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT m.entity_id
  FROM public.team_members tm
  JOIN public.memberships m ON m.person_id = tm.id
  WHERE tm.auth_user_id = auth.uid() AND m.status = 'active';
$fn$;

CREATE OR REPLACE FUNCTION public.current_person_is_owner()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.memberships m ON m.person_id = tm.id
    WHERE tm.auth_user_id = auth.uid()
      AND m.role = 'owner'
      AND m.status = 'active'
  );
$fn$;

REVOKE ALL ON FUNCTION public.current_person_entities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_person_entities() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_person_is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_person_is_owner() TO authenticated, service_role;

-- 3. BACKFILL ----------------------------------------------------------------
-- Backfill auth_user_id from email match.
UPDATE public.team_members tm
SET auth_user_id = u.id
FROM auth.users u
WHERE u.email = tm.email AND tm.auth_user_id IS NULL;

-- One membership per team_members row.
INSERT INTO public.memberships (person_id, entity_id, role, area, status, is_default, started_at, notes)
SELECT
  tm.id,
  r.entity_id,
  tm.default_role,
  tm.default_area,
  CASE WHEN tm.status IN ('active','invited') THEN 'active' ELSE 'ended' END,
  false,
  COALESCE(tm.first_login_at::date, tm.invited_at::date, CURRENT_DATE),
  'backfilled from team_members ' || tm.id::text
FROM public.team_members tm
JOIN public.restaurants r ON r.id = tm.default_restaurant_id
ON CONFLICT DO NOTHING;

-- Earliest active membership per person = default.
WITH ranked AS (
  SELECT id, person_id,
    ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY started_at ASC, created_at ASC) rn
  FROM public.memberships WHERE status='active'
)
UPDATE public.memberships m
SET is_default = true
FROM ranked
WHERE m.id = ranked.id AND ranked.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.memberships m2
    WHERE m2.person_id = m.person_id AND m2.is_default = true AND m2.id <> m.id
  );

-- 4. RLS on new tables (self / owner via team_members / service_role) --------
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authored_by ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memberships_self_read ON public.memberships;
CREATE POLICY memberships_self_read ON public.memberships
  FOR SELECT TO authenticated
  USING (
    person_id IN (SELECT id FROM public.team_members WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS memberships_owner_read ON public.memberships;
CREATE POLICY memberships_owner_read ON public.memberships
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.auth_user_id = auth.uid()
        AND tm.default_role = 'owner'
        AND tm.status = 'active'
    )
  );

DROP POLICY IF EXISTS memberships_service_write ON public.memberships;
CREATE POLICY memberships_service_write ON public.memberships
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS authored_by_read ON public.authored_by;
CREATE POLICY authored_by_read ON public.authored_by
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS authored_by_service_write ON public.authored_by;
CREATE POLICY authored_by_service_write ON public.authored_by
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS referrals_self_read ON public.referrals;
CREATE POLICY referrals_self_read ON public.referrals
  FOR SELECT TO authenticated
  USING (
    referrer_person_id IN (SELECT id FROM public.team_members WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS referrals_owner_read ON public.referrals;
CREATE POLICY referrals_owner_read ON public.referrals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.auth_user_id = auth.uid()
        AND tm.default_role = 'owner'
        AND tm.status = 'active'
    )
  );

DROP POLICY IF EXISTS referrals_service_write ON public.referrals;
CREATE POLICY referrals_service_write ON public.referrals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Rewrite existing policies that reference profiles.role ------------------
-- Discovery (2026-08-22): the ONLY public.* policy referencing public.profiles
-- was feedback.fb_update_admin. No policy referenced profiles.restaurant_id
-- (RLS is currently wide-open on most tables: qual = true).
DROP POLICY IF EXISTS fb_update_admin ON public.feedback;
CREATE POLICY fb_update_admin ON public.feedback
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.team_members tm
      JOIN public.memberships m ON m.person_id = tm.id
      WHERE tm.auth_user_id = auth.uid()
        AND m.role IN ('owner','manager')
        AND m.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.team_members tm
      JOIN public.memberships m ON m.person_id = tm.id
      WHERE tm.auth_user_id = auth.uid()
        AND m.role IN ('owner','manager')
        AND m.status = 'active'
    )
  );

-- 6. eod_pos venue-scoped read (template for other tables in Phase 3.5) ------
-- Current eod_pos SELECT was qual=true (any authenticated user saw every venue).
-- Replace with membership-scoped read per plan example. Owner override via
-- current_person_is_owner(). Service role bypasses RLS as usual.
DROP POLICY IF EXISTS eod_pos_auth_select ON public.eod_pos;
DROP POLICY IF EXISTS eod_pos_member_read ON public.eod_pos;
CREATE POLICY eod_pos_member_read ON public.eod_pos
  FOR SELECT TO authenticated
  USING (
    restaurant_id IN (
      SELECT r.id FROM public.restaurants r
      WHERE r.entity_id IN (SELECT public.current_person_entities())
    )
    OR public.current_person_is_owner()
  );

-- 7. Phase 3.5 follow-up (not applied) ---------------------------------------
-- The other ~100 public.* tables have qual=true or auth.role()='authenticated'
-- policies. Rolling membership scoping to all of them in one migration would
-- break every unauthenticated read path (Home, guest menu, staging views).
-- Use the eod_pos policy above as the template and roll out per domain after
-- confirming each read path passes an authenticated session with a membership.
