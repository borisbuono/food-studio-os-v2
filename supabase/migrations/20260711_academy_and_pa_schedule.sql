-- PA integration Sprint 3 — Academy + PA schedule state.
--
-- Two things move into the OS from the Cowork PA workspace:
--   1. Academy — daily learning at 08:30 that has lived at 06_PA/Academy/.
--      Now becomes an OS surface at /develop/academy so anyone on the team
--      can read + mark complete.
--   2. PA schedule state — the operator's timings for WhatsApp triage,
--      morning brief, evening debrief, daily academy. Currently hard-coded
--      in scheduled tasks; now user-configurable at /administrate/settings/pa.
--
-- Additive. Cowork PA workspace + Vercel cron continue to run — this table
-- is the settings source for future scheduled-task syncs.

-- =========================================================================
-- 1. academy_lessons — the Academy corpus.
-- =========================================================================

create table if not exists academy_lessons (
  id uuid primary key default gen_random_uuid(),
  -- NULL = applies to all entities (group-level lesson).
  entity_code text check (entity_code is null or entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%'),
  title text not null,
  body text,                                 -- markdown, rendered on the surface
  category text not null default 'ops'
    check (category in ('finance','ops','menu','team','pa','customer','marketing')),
  difficulty int not null default 1 check (difficulty between 1 and 3),
  estimated_minutes int not null default 5,
  -- The date this lesson was (or will be) delivered on. Used to headline
  -- "today's lesson" at the top.
  delivered_at date,
  -- Array of user_ids who marked this complete. jsonb so we can extend to
  -- { user_id, completed_at } later.
  completed_by jsonb not null default '[]'::jsonb,
  source text default 'cowork_academy',      -- 'cowork_academy' | 'os_seeded' | 'user_added'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academy_lessons_delivered_idx on academy_lessons (delivered_at desc);
create index if not exists academy_lessons_category_idx  on academy_lessons (category, delivered_at desc);

alter table academy_lessons enable row level security;
create policy "academy_lessons_auth_read" on academy_lessons
  for select to authenticated using (true);
create policy "academy_lessons_auth_write" on academy_lessons
  for all to authenticated using (true) with check (true);
create policy "academy_lessons_anon_read" on academy_lessons
  for select to anon using (true);
create policy "academy_lessons_service_all" on academy_lessons
  for all to service_role using (true) with check (true);

create or replace function academy_lessons_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists academy_lessons_touch_updated_at on academy_lessons;
create trigger academy_lessons_touch_updated_at
  before update on academy_lessons
  for each row execute function academy_lessons_touch_updated_at();

-- =========================================================================
-- 2. pa_schedule_state — per-user PA scheduled-task settings.
-- =========================================================================

create table if not exists pa_schedule_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Europe/Madrid',
  whatsapp_triage_hourly boolean not null default true,
  whatsapp_triage_window_start text not null default '08:00',  -- HH:MM
  whatsapp_triage_window_end   text not null default '22:00',  -- HH:MM
  morning_brief_time  text not null default '09:00',
  evening_debrief_time text not null default '21:00',
  daily_academy_time text not null default '08:30',
  updated_at timestamptz not null default now()
);

alter table pa_schedule_state enable row level security;
create policy "pa_schedule_state_own_read" on pa_schedule_state
  for select to authenticated using (user_id = auth.uid());
create policy "pa_schedule_state_own_write" on pa_schedule_state
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "pa_schedule_state_service_all" on pa_schedule_state
  for all to service_role using (true) with check (true);

-- =========================================================================
-- 3. Seed function — migrate the 06_PA/Academy/ Cowork lessons on first run.
-- =========================================================================
-- Idempotent: only inserts if the table has < 3 rows (safe to re-run).

create or replace function seed_academy_from_cowork()
returns void language plpgsql as $$
declare
  existing int;
begin
  select count(*) into existing from academy_lessons;
  if existing >= 3 then return; end if;

  insert into academy_lessons (title, body, category, difficulty, estimated_minutes, delivered_at, source) values
    ('Holded API pagination — the hard rule',
     E'The /documents/purchase endpoint caps at ~345-500 rows per response. Page params are dead. Always chunk by narrow date windows AND cross-check contact=0 (unmatched). Verify the UI count independently — no assumption is safe.',
     'finance', 2, 6, current_date - interval ''3 days'', 'cowork_academy'),
    ('Statement is not enough for Holded',
     E'When a supplier sends a statement, forward BOTH the statement AND the per-invoice PDFs to the scan inbox. A statement alone loses the item detail Holded needs to match.',
     'finance', 1, 4, current_date - interval ''2 days'', 'cowork_academy'),
    ('Never chase suppliers we owe',
     E'Hard rule: no chase or statement emails to suppliers we owe money to without per-supplier Boris approval. Cash-crisis discipline — silence beats promises.',
     'pa', 1, 3, current_date - interval ''1 days'', 'cowork_academy'),
    ('The highest-impact move',
     E'The PA orchestrator holds one job across every agent and project: keep the Master_ToDo live and know the highest-impact move Boris can make next. Every morning brief leads with that move.',
     'pa', 2, 5, current_date, 'cowork_academy');
end $$;

select seed_academy_from_cowork();
