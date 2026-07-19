-- Pillars #3 — Academy 3-way module split.
--
-- The Academy corpus (public.academy_lessons) now needs to be filterable
-- by the three pillars (FOH / BOH / Office). One lesson can appear in
-- multiple modules — e.g. "Wine service basics" belongs to both FOH and
-- BOH; "Month-end close" is Office-only.
--
-- Design:
--   * A single column `module_scope text[]` on academy_lessons.
--   * Each element is one of 'foh' | 'boh' | 'office'. NULL / empty array
--     means "shows in the top-level /develop/academy list only".
--   * Filtered surfaces (/foh/academy, /boh/academy, /office/academy) query
--     `where module_scope @> array['foh']::text[]` etc.
--   * Existing seeded rows get sensible defaults based on category:
--       - finance         → office
--       - ops             → boh + office
--       - menu            → foh + boh
--       - team            → office
--       - pa              → office
--       - customer        → foh
--       - marketing       → office
--     (Manager can edit each lesson later.)

alter table public.academy_lessons
  add column if not exists module_scope text[] not null default array[]::text[];

create index if not exists academy_lessons_module_scope_gin_idx
  on public.academy_lessons using gin(module_scope);

comment on column public.academy_lessons.module_scope is
  'Pillars the lesson surfaces in. Any of: foh, boh, office. Empty = /develop/academy parent list only. GIN-indexed for @> lookups.';

-- Backfill existing rows from the category axis. Idempotent — only sets rows
-- whose module_scope is still empty (so a manager who's already edited a
-- lesson won't get their choice overwritten by a re-run).
update public.academy_lessons
   set module_scope = case category
     when 'finance'   then array['office']::text[]
     when 'ops'       then array['boh','office']::text[]
     when 'menu'      then array['foh','boh']::text[]
     when 'team'      then array['office']::text[]
     when 'pa'        then array['office']::text[]
     when 'customer'  then array['foh']::text[]
     when 'marketing' then array['office']::text[]
     else array[]::text[]
   end
 where module_scope = array[]::text[];
