-- 20260921_person_merge_run.sql
-- Data migration — RUN on prod 2026-09-21. Record of the five merges from
-- task #35. Re-running is a no-op: fn_person_merge returns {"skipped": ...}
-- for a loser that already carries metadata.merged_into.
--
-- Survivor = the Bistro Mondo row in each pair (Boris: the row holding the
-- live auth session and the Taller + Utopia memberships).
--
-- Carlo's second row is info@ibzfoodstudio.com — the shared business inbox,
-- not a personal address. Merged with p_link_email = false so the address
-- can never be used to sign in AS Carlo.
--
-- NOT merged: Vanessa ("Vanessa", owner at Taller) and Vanessa Lagares
-- Garrido (manager at Bistro Mondo). Same first name, different roles and
-- different addresses — needs Boris to confirm they are one person.

select public.fn_person_merge('bc538f85-f5d3-4ea5-89c4-4bf332d02776','a4c422f4-e0af-4c09-a99c-7dd16c73c68d');        -- Boris Buono
select public.fn_person_merge('8f88c81a-b8af-40d7-9451-16ce7b75d644','7db6fdbd-189d-4882-87cf-dd7720832da2');        -- Julieta Vistosi
select public.fn_person_merge('c81a3b7a-1fed-46c6-a920-de720e2ce717','6695df31-3c18-4e7d-8b7e-6d56d3394e96');        -- Mateo Agustin Di Giacomo
select public.fn_person_merge('980868ed-fc0e-4d6b-b011-cd05130a485b','161b7672-45d5-4c10-8403-200c8e7f9405');        -- Tommaso Tritto
select public.fn_person_merge('f0078539-15d9-4a0c-a0db-c709bf683dbf','eebcdd0e-b55b-4519-91fc-e1ebdce83dfa', false); -- Carlo Tofani (info@ = shared inbox)

-- is_primary follows team_members.email (the backfill marked every row primary
-- before the merges ran).
update public.person_auth_link l
   set is_primary = (lower(l.email) = lower(coalesce(tm.email,'')))
  from public.team_members tm
 where tm.id = l.person_id
   and l.is_primary <> (lower(l.email) = lower(coalesce(tm.email,'')));
