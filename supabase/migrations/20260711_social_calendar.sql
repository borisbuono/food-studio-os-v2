-- Social Workstream Sprint 1 — content calendar + post scheduling
--
-- Backstory: Marie (Witna agency) is paused per the July 10 social workstream
-- decision. Social goes in-house. Boris + wife share PA duty. We ship the
-- tooling to run IG / FB / TikTok / Threads directly from FS OS, without
-- leaving the OS to open Buffer. Buffer stays the scheduling substrate; this
-- schema is the calendar + idea library that fronts it.
--
-- Scope of this migration:
--   1. social_posts        — every draft / scheduled / sent post, per entity
--   2. social_content_ideas — the idea backlog the composer + AI generator draw from
--
-- Follows the substrate pattern of the other Grow tables: authenticated write,
-- per-entity read via RLS, editorial-first (no defaults that guess intent).

-- ---------- Posts ----------
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  channel text not null,
  title text,
  body text not null,
  media_urls text[] not null default array[]::text[],
  scheduled_at timestamptz,
  status text not null default 'draft',
  buffer_update_id text,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_posts_entity_check    check (entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%'),
  constraint social_posts_channel_check   check (channel in ('instagram','facebook','tiktok','threads')),
  constraint social_posts_status_check    check (status in ('draft','scheduled','published','failed'))
);
create index if not exists idx_social_posts_entity_sched on public.social_posts(entity_code, scheduled_at);
create index if not exists idx_social_posts_entity_stat  on public.social_posts(entity_code, status);
create index if not exists idx_social_posts_buffer       on public.social_posts(buffer_update_id) where buffer_update_id is not null;

alter table public.social_posts enable row level security;
do $$ begin
  create policy social_posts_auth_all on public.social_posts
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Touch updated_at on any change so the calendar can show freshness.
create or replace function public.social_posts_touch_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;
drop trigger if exists trg_social_posts_touch on public.social_posts;
create trigger trg_social_posts_touch before update on public.social_posts
  for each row execute function public.social_posts_touch_updated_at();

-- ---------- Content ideas ----------
create table if not exists public.social_content_ideas (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  category text not null,
  prompt text not null,
  used_in_post uuid references public.social_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint social_ideas_entity_check   check (entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%'),
  constraint social_ideas_category_check check (category in ('menu','story','team','behind_scenes','promo'))
);
create index if not exists idx_social_ideas_entity on public.social_content_ideas(entity_code, created_at desc);

alter table public.social_content_ideas enable row level security;
do $$ begin
  create policy social_ideas_auth_all on public.social_content_ideas
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

comment on table public.social_posts is 'In-house social calendar (IG/FB/TikTok/Threads). Scheduling backed by Buffer via buffer_update_id.';
comment on table public.social_content_ideas is 'Idea backlog for the composer + AI generator. used_in_post links back once an idea gets shipped.';
