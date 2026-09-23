-- Meta comment + DM inbox — schema (slice 1 of the 2026-09-23 build).
-- Spec: 06_PA/_INBOX/TO_OS_build_prompt_comments_dms_2026-09-23.md
--
-- Tables
--   social_comments        one row per IG / FB comment on our media
--   social_dm_threads      one row per Instagram conversation
--   social_dm_messages     every message in a thread (in + out), draft on the inbound ones
--   social_saved_replies   canned answers per venue (apply, hours, booking, dogs, parking)
--   brand_voice_examples   approved past replies + tone notes the drafter reads (seeded empty)
--   social_inbox_media     per-media comment counts so the 10-min poll only re-reads changed posts
--   social_inbox_pulls     run log for the poller
--
-- RLS: entity members read, managed-entity members (owner/manager) write —
-- the rls35 pattern social_accounts and brand_kits already use. Every table is
-- keyed on entity_id (uuid), never a static venue map.
--
-- THE GATE is not here: approved_by_boris is just a column. The edge function
-- meta-reply refuses to send unless it is true, exactly like meta-publish.

-- ---------------------------------------------------------------- comments
create table if not exists public.social_comments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  account_id uuid not null references public.social_accounts(id),
  platform text not null check (platform in ('instagram','facebook')),
  post_id uuid references public.social_posts(id),      -- null if the post predates the OS
  remote_media_id text not null,
  remote_comment_id text not null unique,
  parent_remote_id text,                                -- set when it is a reply under another comment
  author_id text,
  author_handle text, author_name text,
  text text, lang text,
  created_at_remote timestamptz,
  status text not null default 'new'
      check (status in ('new','drafted','approved','replied','skipped','hidden','failed')),
  flagged boolean not null default false,               -- complaint / legal: Boris writes it himself
  flag_reason text,
  draft_reply text, draft_lang text, draft_at timestamptz, draft_model text,
  approved_by_boris boolean not null default false, approved_at timestamptz,
  approved_by_user uuid,
  replied_at timestamptz, reply_remote_id text, reply_text text, error text,
  media_permalink text, media_thumbnail_url text, media_caption text,
  fetched_at timestamptz not null default now()
);
create index if not exists social_comments_status_idx on public.social_comments (status, created_at_remote desc);
create index if not exists social_comments_entity_idx on public.social_comments (entity_id, status);
create index if not exists social_comments_media_idx  on public.social_comments (remote_media_id);

-- ---------------------------------------------------------------- DMs
create table if not exists public.social_dm_threads (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  account_id uuid not null references public.social_accounts(id),
  platform text not null check (platform in ('instagram','facebook')),
  remote_thread_id text not null unique,
  participant_id text,                                  -- IGSID — the recipient id for replies
  participant_handle text, participant_name text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,                          -- the 24h / 7-day messaging windows count from here
  status text not null default 'open' check (status in ('open','waiting','closed')),
  fetched_at timestamptz not null default now()
);
create index if not exists social_dm_threads_status_idx on public.social_dm_threads (status, last_message_at desc);
create index if not exists social_dm_threads_entity_idx on public.social_dm_threads (entity_id, status);

create table if not exists public.social_dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.social_dm_threads(id) on delete cascade,
  entity_id uuid not null references public.entities(id),
  remote_message_id text not null unique,
  direction text not null check (direction in ('in','out')),
  sender_id text,
  text text, lang text,
  attachments jsonb,
  sent_at timestamptz,
  status text not null default 'new'
      check (status in ('new','drafted','approved','replied','skipped','hidden','failed')),
  flagged boolean not null default false,
  flag_reason text,
  draft_reply text, draft_lang text, draft_at timestamptz, draft_model text,
  approved_by_boris boolean not null default false, approved_at timestamptz,
  approved_by_user uuid,
  replied_at timestamptz, reply_remote_id text, reply_text text, error text,
  fetched_at timestamptz not null default now()
);
create index if not exists social_dm_messages_thread_idx on public.social_dm_messages (thread_id, sent_at desc);
create index if not exists social_dm_messages_status_idx on public.social_dm_messages (status, sent_at desc);

-- ---------------------------------------------------------------- saved replies + voice
create table if not exists public.social_saved_replies (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  key text not null,                                    -- apply | hours | booking | dogs | parking | ...
  title text not null,
  lang text not null default 'en',
  body text not null,
  sort int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, key, lang)
);

create table if not exists public.brand_voice_examples (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  kind text not null check (kind in ('approved_reply','tone_note','avoid_phrase')),
  lang text,
  prompt_text text,                                     -- what the person wrote (for approved_reply)
  text text not null,                                   -- the reply / the note / the phrase to avoid
  note text,
  source text,                                          -- 'inbox' | 'com' | 'boris'
  created_at timestamptz not null default now()
);
create index if not exists brand_voice_examples_entity_idx on public.brand_voice_examples (entity_id, kind);

-- ---------------------------------------------------------------- poller bookkeeping
create table if not exists public.social_inbox_media (
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  remote_media_id text not null,
  platform text not null check (platform in ('instagram','facebook')),
  permalink text, thumbnail_url text, caption text,
  posted_at timestamptz,
  comments_count int,
  last_scanned_at timestamptz,
  primary key (account_id, remote_media_id)
);

create table if not exists public.social_inbox_pulls (
  id bigint generated always as identity primary key,
  account_id uuid references public.social_accounts(id) on delete cascade,
  ran_at timestamptz not null default now(),
  via text,
  ok boolean not null default true,
  counts jsonb,
  error text
);
create index if not exists social_inbox_pulls_account_idx on public.social_inbox_pulls (account_id, ran_at desc);

-- ---------------------------------------------------------------- RLS
alter table public.social_comments      enable row level security;
alter table public.social_dm_threads    enable row level security;
alter table public.social_dm_messages   enable row level security;
alter table public.social_saved_replies enable row level security;
alter table public.brand_voice_examples enable row level security;
alter table public.social_inbox_media   enable row level security;
alter table public.social_inbox_pulls   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['social_comments','social_dm_threads','social_dm_messages','social_saved_replies','brand_voice_examples']
  loop
    execute format('drop policy if exists rls35_%1$s_select on public.%1$s', t);
    execute format('drop policy if exists rls35_%1$s_insert on public.%1$s', t);
    execute format('drop policy if exists rls35_%1$s_update on public.%1$s', t);
    execute format('drop policy if exists rls35_%1$s_delete on public.%1$s', t);
    execute format('create policy rls35_%1$s_select on public.%1$s for select to authenticated
                      using (entity_id in (select public.current_person_entities()))', t);
    execute format('create policy rls35_%1$s_insert on public.%1$s for insert to authenticated
                      with check (entity_id in (select public.app_my_managed_entities()))', t);
    execute format('create policy rls35_%1$s_update on public.%1$s for update to authenticated
                      using (entity_id in (select public.app_my_managed_entities()))
                      with check (entity_id in (select public.app_my_managed_entities()))', t);
    execute format('create policy rls35_%1$s_delete on public.%1$s for delete to authenticated
                      using (entity_id in (select public.app_my_managed_entities()))', t);
  end loop;
end $$;

-- Poller tables have no entity_id column; scope through the account row.
drop policy if exists rls35_social_inbox_media_select on public.social_inbox_media;
create policy rls35_social_inbox_media_select on public.social_inbox_media for select to authenticated
  using (account_id in (select id from public.social_accounts where entity_id in (select public.current_person_entities())));
drop policy if exists rls35_social_inbox_pulls_select on public.social_inbox_pulls;
create policy rls35_social_inbox_pulls_select on public.social_inbox_pulls for select to authenticated
  using (account_id in (select id from public.social_accounts where entity_id in (select public.current_person_entities())));

-- ---------------------------------------------------------------- waiting count (nav badge)
create or replace view public.social_inbox_waiting
with (security_invoker = true) as
select entity_id, count(*)::int as waiting
from (
  select entity_id from public.social_comments    where status in ('new','drafted')
  union all
  select entity_id from public.social_dm_messages where direction = 'in' and status in ('new','drafted')
) w
group by entity_id;
grant select on public.social_inbox_waiting to authenticated;

-- ---------------------------------------------------------------- shared secret for the poller / drafter / webhook
-- Minted in SQL, held in Vault, never seen by a human. pg_cron reads it from
-- Vault to call meta-inbox-pull; the draft trigger sends it to Vercel; both
-- callees check it back with social_inbox_secret_ok(). Same model as
-- social_scheduler_secret.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'social_inbox_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'social_inbox_secret',
                                'meta-inbox-pull / inbox draft / webhook shared secret');
  end if;
  if not exists (select 1 from vault.secrets where name = 'meta_webhook_verify_token') then
    perform vault.create_secret('fsos-' || encode(gen_random_bytes(12), 'hex'), 'meta_webhook_verify_token',
                                'hub.verify_token for the Meta webhook subscription');
  end if;
end $$;

create or replace function public.social_inbox_secret_ok(p_secret text)
returns boolean language plpgsql security definer set search_path = public, vault as $$
declare v_role text := current_setting('request.jwt.claim.role', true);
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres') then
    raise exception 'forbidden';
  end if;
  return p_secret is not null and length(p_secret) > 16 and exists (
    select 1 from vault.decrypted_secrets where name = 'social_inbox_secret' and decrypted_secret = p_secret);
end $$;
revoke all on function public.social_inbox_secret_ok(text) from public, anon, authenticated;

create or replace function public.meta_webhook_verify_token_ok(p_token text)
returns boolean language plpgsql security definer set search_path = public, vault as $$
declare v_role text := current_setting('request.jwt.claim.role', true);
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres') then
    raise exception 'forbidden';
  end if;
  return p_token is not null and exists (
    select 1 from vault.decrypted_secrets where name = 'meta_webhook_verify_token' and decrypted_secret = p_token);
end $$;
revoke all on function public.meta_webhook_verify_token_ok(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- draft trigger (slice 4 wires the callee)
-- A new inbound comment / DM asks Vercel to draft a suggested reply. The
-- callee (/api/inbox/draft) checks the secret, calls Anthropic and writes
-- draft_reply. Fire-and-forget through pg_net; a failed call leaves the row
-- at status 'new' and the poller re-asks on its next pass.
create or replace function public.social_inbox_request_draft()
returns trigger language plpgsql security definer set search_path = public, vault, net as $$
declare
  v_secret text;
  v_url text := coalesce(nullif(current_setting('app.inbox_draft_url', true), ''),
                         'https://www.foodstudio.ai/api/inbox/draft');
  v_kind text := case tg_table_name when 'social_comments' then 'comment' else 'dm' end;
begin
  if tg_table_name = 'social_dm_messages' and new.direction <> 'in' then return new; end if;
  if new.status <> 'new' then return new; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'social_inbox_secret';
  if v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
    body := jsonb_build_object('kind', v_kind, 'id', new.id),
    timeout_milliseconds := 60000);
  return new;
exception when others then
  return new;   -- drafting is best-effort; never block the insert
end $$;

drop trigger if exists trg_social_comments_draft on public.social_comments;
create trigger trg_social_comments_draft after insert on public.social_comments
  for each row execute function public.social_inbox_request_draft();
drop trigger if exists trg_social_dm_messages_draft on public.social_dm_messages;
create trigger trg_social_dm_messages_draft after insert on public.social_dm_messages
  for each row execute function public.social_inbox_request_draft();

-- touch updated_at on saved replies
create or replace function public.social_saved_replies_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_social_saved_replies_touch on public.social_saved_replies;
create trigger trg_social_saved_replies_touch before update on public.social_saved_replies
  for each row execute function public.social_saved_replies_touch();
