-- 20260920_hr_funnel_scaffold.sql
-- Runway — HR funnel scaffold.
--
-- Per-house hiring pipeline: openings → posts (drafted, sent by hand) →
-- candidates → touches → interviews. entity_id UUIDs throughout; RLS
-- follows the labor pattern (fn_is_entity_member for read/write,
-- fn_is_entity_manager for hire/offer transitions).
--
-- HARD rule (Boris memory): WhatsApp / Telegram / Instagram are READ, not
-- SEND from scheduled runs. job_posts rows are drafted and previewed; a
-- human sends by hand and taps `mark-posted` to persist posted_at +
-- external_ref. Auto-send arrives later behind an explicit Meta connect.

-- 1) job_openings ----------------------------------------------------------
create table if not exists public.job_openings (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  title text not null,
  role text,
  station text,
  description text,
  hours_per_week int,
  hourly_rate_eur numeric,
  start_date date,
  languages_required text[],
  status text not null default 'open',
  filled_by uuid references auth.users(id),
  filled_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_openings_entity_status
  on public.job_openings(entity_id, status);

alter table public.job_openings enable row level security;

drop policy if exists job_openings_select on public.job_openings;
create policy job_openings_select on public.job_openings
  for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));

drop policy if exists job_openings_insert on public.job_openings;
create policy job_openings_insert on public.job_openings
  for insert to authenticated
  with check (public.fn_is_entity_member(auth.uid(), entity_id));

-- Managers may freely update; members may edit non-status fields via the
-- same policy but the API guards `status → filled/hired` explicitly.
drop policy if exists job_openings_update on public.job_openings;
create policy job_openings_update on public.job_openings
  for update to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));

drop policy if exists job_openings_delete on public.job_openings;
create policy job_openings_delete on public.job_openings
  for delete to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id));

create or replace function public.fn_job_openings_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists job_openings_touch_updated_at on public.job_openings;
create trigger job_openings_touch_updated_at
  before update on public.job_openings
  for each row execute function public.fn_job_openings_touch_updated_at();

-- 2) job_posts -------------------------------------------------------------
create table if not exists public.job_posts (
  id uuid primary key default gen_random_uuid(),
  job_opening_id uuid not null references public.job_openings(id) on delete cascade,
  channel text not null,
  channel_target text,
  message_body text,
  posted_at timestamptz,
  posted_by uuid references auth.users(id),
  external_ref text,
  status text not null default 'drafted',
  created_at timestamptz not null default now()
);

create index if not exists job_posts_opening on public.job_posts(job_opening_id);

alter table public.job_posts enable row level security;

-- Membership is inherited from the parent opening.
drop policy if exists job_posts_select on public.job_posts;
create policy job_posts_select on public.job_posts
  for select to authenticated
  using (
    exists (
      select 1 from public.job_openings o
       where o.id = job_posts.job_opening_id
         and public.fn_is_entity_member(auth.uid(), o.entity_id)
    )
  );

drop policy if exists job_posts_insert on public.job_posts;
create policy job_posts_insert on public.job_posts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.job_openings o
       where o.id = job_posts.job_opening_id
         and public.fn_is_entity_member(auth.uid(), o.entity_id)
    )
  );

drop policy if exists job_posts_update on public.job_posts;
create policy job_posts_update on public.job_posts
  for update to authenticated
  using (
    exists (
      select 1 from public.job_openings o
       where o.id = job_posts.job_opening_id
         and public.fn_is_entity_member(auth.uid(), o.entity_id)
    )
  );

drop policy if exists job_posts_delete on public.job_posts;
create policy job_posts_delete on public.job_posts
  for delete to authenticated
  using (
    exists (
      select 1 from public.job_openings o
       where o.id = job_posts.job_opening_id
         and public.fn_is_entity_manager(auth.uid(), o.entity_id)
    )
  );

-- 3) candidates ------------------------------------------------------------
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  job_opening_id uuid references public.job_openings(id),
  name text not null,
  phone text,
  email text,
  source text,
  source_ref text,
  languages text[],
  years_experience numeric,
  right_to_work text,
  cv_url text,
  status text not null default 'new',
  status_history jsonb not null default '[]'::jsonb,
  rejection_reason text,
  assigned_to uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists candidates_entity_status
  on public.candidates(entity_id, status);
create index if not exists candidates_opening
  on public.candidates(job_opening_id) where job_opening_id is not null;

alter table public.candidates enable row level security;

drop policy if exists candidates_select on public.candidates;
create policy candidates_select on public.candidates
  for select to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));

drop policy if exists candidates_insert on public.candidates;
create policy candidates_insert on public.candidates
  for insert to authenticated
  with check (public.fn_is_entity_member(auth.uid(), entity_id));

drop policy if exists candidates_update on public.candidates;
create policy candidates_update on public.candidates
  for update to authenticated
  using (public.fn_is_entity_member(auth.uid(), entity_id));

drop policy if exists candidates_delete on public.candidates;
create policy candidates_delete on public.candidates
  for delete to authenticated
  using (public.fn_is_entity_manager(auth.uid(), entity_id));

create or replace function public.fn_candidates_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists candidates_touch_updated_at on public.candidates;
create trigger candidates_touch_updated_at
  before update on public.candidates
  for each row execute function public.fn_candidates_touch_updated_at();

-- 4) candidate_touches -----------------------------------------------------
create table if not exists public.candidate_touches (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  touched_at timestamptz not null default now(),
  channel text,
  direction text,
  notes text,
  by_user uuid references auth.users(id)
);

create index if not exists candidate_touches_candidate
  on public.candidate_touches(candidate_id, touched_at desc);

alter table public.candidate_touches enable row level security;

drop policy if exists candidate_touches_select on public.candidate_touches;
create policy candidate_touches_select on public.candidate_touches
  for select to authenticated
  using (
    exists (
      select 1 from public.candidates c
       where c.id = candidate_touches.candidate_id
         and public.fn_is_entity_member(auth.uid(), c.entity_id)
    )
  );

drop policy if exists candidate_touches_insert on public.candidate_touches;
create policy candidate_touches_insert on public.candidate_touches
  for insert to authenticated
  with check (
    exists (
      select 1 from public.candidates c
       where c.id = candidate_touches.candidate_id
         and public.fn_is_entity_member(auth.uid(), c.entity_id)
    )
  );

drop policy if exists candidate_touches_delete on public.candidate_touches;
create policy candidate_touches_delete on public.candidate_touches
  for delete to authenticated
  using (
    exists (
      select 1 from public.candidates c
       where c.id = candidate_touches.candidate_id
         and public.fn_is_entity_manager(auth.uid(), c.entity_id)
    )
  );

-- 5) interviews ------------------------------------------------------------
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  scheduled_at timestamptz not null,
  format text,
  location text,
  interviewer_ids uuid[],
  status text not null default 'scheduled',
  score_1_10 int,
  strengths text,
  concerns text,
  recommendation text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists interviews_candidate
  on public.interviews(candidate_id, scheduled_at desc);
create index if not exists interviews_upcoming
  on public.interviews(scheduled_at) where status = 'scheduled';

alter table public.interviews enable row level security;

drop policy if exists interviews_select on public.interviews;
create policy interviews_select on public.interviews
  for select to authenticated
  using (
    exists (
      select 1 from public.candidates c
       where c.id = interviews.candidate_id
         and public.fn_is_entity_member(auth.uid(), c.entity_id)
    )
  );

drop policy if exists interviews_insert on public.interviews;
create policy interviews_insert on public.interviews
  for insert to authenticated
  with check (
    exists (
      select 1 from public.candidates c
       where c.id = interviews.candidate_id
         and public.fn_is_entity_member(auth.uid(), c.entity_id)
    )
  );

drop policy if exists interviews_update on public.interviews;
create policy interviews_update on public.interviews
  for update to authenticated
  using (
    exists (
      select 1 from public.candidates c
       where c.id = interviews.candidate_id
         and public.fn_is_entity_member(auth.uid(), c.entity_id)
    )
  );

drop policy if exists interviews_delete on public.interviews;
create policy interviews_delete on public.interviews
  for delete to authenticated
  using (
    exists (
      select 1 from public.candidates c
       where c.id = interviews.candidate_id
         and public.fn_is_entity_manager(auth.uid(), c.entity_id)
    )
  );
