-- Guest self-service · Commit #3 · Guest feedback + newsletter opt-in
--
-- Adds:
--   * public.guest_feedback — post-visit feedback captured via /m/[slug]/thanks
--   * public.guest_newsletter_optins — email opt-ins for the tasting-menu mailer
--
-- Both are anon-write (writes hit /api/guest/* which validates the signed
-- token) and authenticated-read.

create table if not exists public.guest_feedback (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  guest_id uuid,                              -- soft FK, may be null for pre-guest-row cases
  booking_id uuid,                            -- soft FK to bookings.id
  rating int,                                 -- 1..5
  body text,
  channel text not null default 'web',
  external_review_requested boolean not null default false,
  external_review_platform text,              -- 'google' | 'tripadvisor' | null
  created_at timestamptz not null default now(),
  constraint guest_feedback_rating_check check (rating is null or (rating between 1 and 5)),
  constraint guest_feedback_ext_platform_check
    check (external_review_platform is null or external_review_platform in ('google','tripadvisor','thefork'))
);
create index if not exists idx_guest_feedback_rest    on public.guest_feedback(restaurant_id, created_at desc);
create index if not exists idx_guest_feedback_guest   on public.guest_feedback(guest_id);
create index if not exists idx_guest_feedback_booking on public.guest_feedback(booking_id);

alter table public.guest_feedback enable row level security;
do $$ begin
  create policy guest_feedback_auth_all on public.guest_feedback
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public.guest_newsletter_optins (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  guest_id uuid,
  email text not null,
  topic text not null default 'tasting_menu', -- tasting_menu | events | wine_club | all
  opted_in_at timestamptz not null default now(),
  opted_out_at timestamptz,
  source text not null default 'thanks_page',
  unique (restaurant_id, email, topic)
);
create index if not exists idx_newsletter_rest on public.guest_newsletter_optins(restaurant_id, topic);

alter table public.guest_newsletter_optins enable row level security;
do $$ begin
  create policy newsletter_auth_all on public.guest_newsletter_optins
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- guest_visits helper — pre-populated draft written from /m/[slug]/preferences
-- so front-of-house sees the guest's stated needs when they arrive. Uses the
-- existing guest_visits table from the Grow pillar migration (20260705).
-- No schema change needed here — the write goes through /api/guest/preferences.

-- Extend reviews_platform_status with a write_review_url column so the guest
-- thanks page can surface a public-review link when the guest rates 4+.
-- Additive — Grow reputation admin fills these when the venue is onboarded.
alter table public.reviews_platform_status
  add column if not exists write_review_url text;

comment on column public.reviews_platform_status.write_review_url is
  'Public deep-link where a happy guest can write a review on this platform. '
  'Filled per venue from /grow/reputation. Surfaced from /m/[slug]/thanks '
  'when rating >= 4 — surfaced in preference order google_business → tripadvisor → thefork.';
