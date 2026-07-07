-- Grow · Reputation — reviews inbox schema
-- Aggregates Google Business Profile + TripAdvisor + TheFork reviews into one
-- table so /grow/reputation can render a unified inbox and Chef can draft replies.
-- Sync worker upserts by (platform, external_id).

-- ---------- reviews ----------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  platform text not null,                     -- google_business | tripadvisor | thefork | yelp
  external_id text not null,                  -- vendor-side review id
  reviewer_name text,
  reviewer_avatar_url text,
  rating int,                                 -- 1..5 (nullable — some platforms don't rate)
  title text,
  body text,
  language text,
  posted_at timestamptz not null,
  response_body text,
  response_posted_at timestamptz,
  response_by uuid,                           -- soft FK to auth.users (who posted from OS)
  sentiment text,                             -- positive | neutral | negative (AI-populated later)
  tags text[],
  url text,                                   -- deep link to the review on the platform
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_platform_check check (platform in ('google_business','tripadvisor','thefork','yelp')),
  constraint reviews_rating_check check (rating is null or (rating between 1 and 5)),
  constraint reviews_sentiment_check check (sentiment is null or sentiment in ('positive','neutral','negative')),
  constraint reviews_external_uniq unique (platform, external_id)
);
create index if not exists idx_reviews_rest        on public.reviews(restaurant_id, posted_at desc);
create index if not exists idx_reviews_rest_plat   on public.reviews(restaurant_id, platform, posted_at desc);
create index if not exists idx_reviews_unreplied   on public.reviews(restaurant_id, platform) where response_body is null;
create index if not exists idx_reviews_rating      on public.reviews(restaurant_id, rating);

alter table public.reviews enable row level security;
do $$ begin
  create policy reviews_auth_all on public.reviews
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
-- anon read matches /grow/inbox posture — review aggregation is public info
do $$ begin
  create policy reviews_anon_read on public.reviews
    for select to anon using (true);
exception when duplicate_object then null; end $$;

-- ---------- reviews_platform_status ----------
-- One row per (restaurant, platform) — drives the three tiles on /grow/reputation
create table if not exists public.reviews_platform_status (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  platform text not null,
  avg_rating numeric(3,2),                    -- rolling average across all synced reviews
  total_reviews int not null default 0,
  reviews_this_month int not null default 0,
  unreplied_count int not null default 0,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_status_platform_check check (platform in ('google_business','tripadvisor','thefork','yelp')),
  constraint reviews_status_uniq unique (restaurant_id, platform)
);
create index if not exists idx_reviews_status_rest on public.reviews_platform_status(restaurant_id);

alter table public.reviews_platform_status enable row level security;
do $$ begin
  create policy reviews_status_auth_all on public.reviews_platform_status
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy reviews_status_anon_read on public.reviews_platform_status
    for select to anon using (true);
exception when duplicate_object then null; end $$;

-- ---------- updated_at triggers ----------
-- set_updated_at() is defined by 20260705_grow_pillar_schema.sql; guard for local reruns.
do $$ begin
  create trigger reviews_updated_at before update on public.reviews
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger reviews_status_updated_at before update on public.reviews_platform_status
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
