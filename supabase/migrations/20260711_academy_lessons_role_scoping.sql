-- Academy · role scoping for onboarding training paths.
--
-- The Academy module currently derives skill from the operational spine
-- (mep_dishes / tasks / task_completions). The new team-onboarding flow needs
-- lightweight "lessons" — short units the manager can require of a role at
-- hire time.
--
-- This migration:
--   1. Creates academy_lessons IF NOT EXISTS. Earlier PA integration work
--      referenced this table; if it landed in another branch, this migration
--      no-ops. If it did not, we bring it up cleanly here.
--   2. Adds assigned_roles (text[]) and required_for_onboarding (boolean) so
--      /team/[user_id]/training can filter to the right slice per hire.
--   3. Creates academy_lesson_progress — one row per (user, lesson) with
--      status + timestamps. Writes back to onboarding_steps.pos_trained /
--      system_walked when the required-set is complete.

create table if not exists public.academy_lessons (
  id uuid primary key default gen_random_uuid(),
  entity_code text,                            -- optional — universal lessons leave null
  slug text not null unique,
  title text not null,
  body_md text,                                -- markdown for the lesson body
  estimated_minutes int not null default 5,
  category text,                               -- food | wine | drinks | cleaning | office | onboarding
  order_index int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_academy_lessons_entity on public.academy_lessons(entity_code, order_index);
create index if not exists idx_academy_lessons_cat    on public.academy_lessons(category);

alter table public.academy_lessons enable row level security;
do $$ begin
  create policy academy_lessons_auth_read on public.academy_lessons for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy academy_lessons_auth_write on public.academy_lessons for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- 2. Role scoping columns. text[] means we can flag a lesson as belonging to
--    multiple roles (e.g. handbook applies to all).
alter table public.academy_lessons add column if not exists assigned_roles text[] not null default array[]::text[];
alter table public.academy_lessons add column if not exists required_for_onboarding boolean not null default false;
create index if not exists idx_academy_lessons_required on public.academy_lessons(required_for_onboarding) where required_for_onboarding;
-- GIN on the roles array is the right lookup for "lessons matching my role".
create index if not exists idx_academy_lessons_roles_gin on public.academy_lessons using gin(assigned_roles);

-- 3. Progress tracking.
create table if not exists public.academy_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  lesson_id uuid not null references public.academy_lessons(id) on delete cascade,
  status text not null default 'not_started',        -- not_started | in_progress | done
  started_at timestamptz,
  completed_at timestamptz,
  minutes_spent int,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_progress_status_check check (status in ('not_started','in_progress','done')),
  constraint academy_progress_uniq unique (user_id, lesson_id)
);
create index if not exists idx_academy_progress_user on public.academy_lesson_progress(user_id, status);

alter table public.academy_lesson_progress enable row level security;
do $$ begin
  create policy academy_progress_auth_all on public.academy_lesson_progress
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create or replace function public.academy_progress_touch_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;
drop trigger if exists trg_academy_progress_touch on public.academy_lesson_progress;
create trigger trg_academy_progress_touch before update on public.academy_lesson_progress
  for each row execute function public.academy_progress_touch_updated_at();

-- Seed a small starter set of onboarding lessons. Idempotent via slug.
insert into public.academy_lessons (slug, title, body_md, estimated_minutes, category, assigned_roles, required_for_onboarding, order_index) values
  ('welcome-to-the-house',   'Welcome to the house',        'The philosophy — why we cook, why we serve.',                                  4, 'onboarding', array['owner','manager','chef','foh','pastry','porter','host','other'], true, 10),
  ('house-rules',            'House rules',                 'Arrival, uniform, breaks, the standards we hold.',                             5, 'onboarding', array['owner','manager','chef','foh','pastry','porter','host','other'], true, 20),
  ('clock-in-basics',        'Clock-in basics',             'Personal-phone clock-in on the OS. Where to tap.',                             3, 'onboarding', array['chef','foh','pastry','porter','host','other'],                    true, 30),
  ('the-menu',               'The menu',                    'What we serve tonight. Origin, allergens, story.',                             8, 'food',      array['chef','foh','pastry','host'],                                        true, 40),
  ('service-flow-foh',       'Service flow — front',        'Greeting, seating, courses, the pass-back loop.',                              7, 'office',    array['foh','host','manager','owner'],                                      true, 50),
  ('service-flow-boh',       'Service flow — back',         'Prep list, the pass, close-down.',                                             7, 'food',      array['chef','pastry','manager','owner'],                                    true, 60),
  ('haccp-first-look',       'HACCP — first look',          'Temperatures, allergens, cross-contamination rules.',                          6, 'cleaning',  array['chef','pastry','porter','manager','owner'],                           true, 70),
  ('pos-basics',             'POS — basics',                'Opening a table, moving covers, splitting a bill.',                            6, 'office',    array['foh','host','manager','owner'],                                      true, 80)
on conflict (slug) do update set
  title = excluded.title,
  assigned_roles = excluded.assigned_roles,
  required_for_onboarding = excluded.required_for_onboarding,
  estimated_minutes = excluded.estimated_minutes;

comment on column public.academy_lessons.assigned_roles is 'Text array of roles this lesson applies to (owner|manager|chef|foh|pastry|porter|host|other). GIN-indexed for role lookup.';
comment on column public.academy_lessons.required_for_onboarding is 'Whether this lesson counts toward the new-hire training gate.';
comment on table public.academy_lesson_progress is 'Per-user lesson state. Rendezvous point for /team/[user_id]/training + writes back into onboarding_steps once the required set is done.';
