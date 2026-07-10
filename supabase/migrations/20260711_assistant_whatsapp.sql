-- Assistant Sprint 4 — WhatsApp edge connector.
--
-- Two tables:
--   assistant_wa_events   — WhatsApp Business Cloud API webhook receiver
--                           writes every inbound message + delivery status
--                           here. Triage + inbox surface read from it.
--   assistant_wa_chats    — chat metadata cache used by the desktop-assist
--                           path (personal lines via WhatsApp Web) so the
--                           surface can list conversations without hitting
--                           the browser.
--   assistant_wa_drafts   — queue of drafts written by the desktop-assist
--                           path. The user copies each one into their open
--                           WhatsApp Web session — nothing is sent from the
--                           server.
--
-- All three are user-scoped via assistant_channels.user_id.

-- =========================================================================
-- 1. assistant_wa_events — Business Cloud API webhook events.
-- =========================================================================

create table if not exists assistant_wa_events (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references assistant_channels(id) on delete cascade,
  -- 'message' | 'status' (delivered/read/failed) | 'template.status'
  event_type text not null,
  from_number text,
  to_number text,
  body text,
  wa_message_id text,
  raw jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists assistant_wa_events_channel_at_idx  on assistant_wa_events (channel_id, received_at desc);
create index if not exists assistant_wa_events_msg_idx         on assistant_wa_events (wa_message_id);

alter table assistant_wa_events enable row level security;
-- User can read events for their own channels only.
create policy "assistant_wa_events_own_select" on assistant_wa_events for select to authenticated
  using (exists (select 1 from assistant_channels c where c.id = assistant_wa_events.channel_id and c.user_id = auth.uid()));
-- Writes are done by the webhook receiver using the service role.
create policy "assistant_wa_events_service_write" on assistant_wa_events for all to service_role using (true) with check (true);

-- =========================================================================
-- 2. assistant_wa_chats — chat metadata cache (desktop-assist path).
-- =========================================================================

create table if not exists assistant_wa_chats (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references assistant_channels(id) on delete cascade,
  chat_id text not null,           -- WhatsApp Web canonical chat id (jid) or phone number
  phone_number text,
  contact_name text,
  last_message_preview text,
  last_message_at timestamptz,
  unread_count int not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists assistant_wa_chats_channel_chat_idx on assistant_wa_chats (channel_id, chat_id);
create index if not exists assistant_wa_chats_channel_at_idx on assistant_wa_chats (channel_id, last_message_at desc);

alter table assistant_wa_chats enable row level security;
create policy "assistant_wa_chats_own_select" on assistant_wa_chats for select to authenticated
  using (exists (select 1 from assistant_channels c where c.id = assistant_wa_chats.channel_id and c.user_id = auth.uid()));
create policy "assistant_wa_chats_own_write" on assistant_wa_chats for all to authenticated
  using (exists (select 1 from assistant_channels c where c.id = assistant_wa_chats.channel_id and c.user_id = auth.uid()))
  with check (exists (select 1 from assistant_channels c where c.id = assistant_wa_chats.channel_id and c.user_id = auth.uid()));

-- =========================================================================
-- 3. assistant_wa_drafts — desktop-assist draft queue.
-- =========================================================================

create table if not exists assistant_wa_drafts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references assistant_channels(id) on delete cascade,
  chat_id text not null,
  body text not null,
  -- 'draft' (waiting for the user) | 'sent' (user marked it as sent) | 'discarded'
  status text not null default 'draft' check (status in ('draft','sent','discarded')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists assistant_wa_drafts_channel_status_idx on assistant_wa_drafts (channel_id, status, created_at desc);

alter table assistant_wa_drafts enable row level security;
create policy "assistant_wa_drafts_own_select" on assistant_wa_drafts for select to authenticated
  using (exists (select 1 from assistant_channels c where c.id = assistant_wa_drafts.channel_id and c.user_id = auth.uid()));
create policy "assistant_wa_drafts_own_write" on assistant_wa_drafts for all to authenticated
  using (exists (select 1 from assistant_channels c where c.id = assistant_wa_drafts.channel_id and c.user_id = auth.uid()))
  with check (exists (select 1 from assistant_channels c where c.id = assistant_wa_drafts.channel_id and c.user_id = auth.uid()));
