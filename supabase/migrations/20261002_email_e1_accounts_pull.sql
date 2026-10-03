-- Email as the third Comms channel — E1: connect + pull + tables + RLS.
-- Brief: memory build_brief_email_channel_2026-10-02 (Boris authorised 02-10).
--
-- Tables
--   email_accounts       one row per connected mailbox (tokens in Vault, never here)
--   email_oauth_states   anti-CSRF nonces for the connect flow (service only)
--   email_threads        one row per Gmail thread the OS has seen
--   email_messages       every message in a thread (in + out)
--   email_pulls          run log for the poller
--
-- The rule is the social one: ACCOUNTS AND TOKENS ARE ROWS, never Supabase
-- secrets. Connecting a mailbox is a self-serve OAuth flow that writes rows.
-- Credentials live in Vault; only service-role definer RPCs can read them.
--
-- RLS = rls35 pattern: entity members read, managed-entity members write.
-- email_accounts is MANAGER-ONLY on every verb (credentials table).
--
-- THE GATE is not here: approved_by_boris is just a column. The edge function
-- email-reply refuses to send unless it is true AND the confirm token behind
-- it was consumed — exactly like meta-reply.

-- ---------------------------------------------------------------- accounts
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  address text not null,
  display_name text,
  provider text not null default 'gmail' check (provider in ('gmail')),
  google_user_id text,
  scopes text[] not null default '{}',
  status text not null default 'pending'
      check (status in ('pending','active','needs_reconnect','revoked')),
  -- admin@… addresses forward straight into Holded's scanner (Boris ruling
  -- 15-09). A factura that lands there books itself; the OS must never push
  -- it a second time. Set from the address at connect time, editable later.
  forwards_to_holded boolean not null default false,
  token_vault_id uuid,              -- vault.secrets id of the access token
  refresh_vault_id uuid,            -- vault.secrets id of the refresh token
  token_expires_at timestamptz,
  history_id text,                  -- Gmail historyId after the last pull
  connected_by uuid,
  connected_at timestamptz not null default now(),
  last_pull_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists email_accounts_live_address_idx
  on public.email_accounts (lower(address)) where revoked_at is null;
create index if not exists email_accounts_entity_idx on public.email_accounts (entity_id, status);

create table if not exists public.email_oauth_states (
  state text primary key,
  entity_id uuid not null references public.entities(id),
  redirect_to text,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz
);

-- ---------------------------------------------------------------- threads + messages
create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  gmail_thread_id text not null,
  subject text,
  snippet text,
  from_address text,                -- the counterparty (first inbound sender)
  from_name text,
  participants text[] not null default '{}',
  first_received_at timestamptz,    -- the enquiry clock starts here
  last_received_at timestamptz,
  last_message_id uuid,             -- email_messages.id of the latest inbound
  message_count int not null default 0,
  labels text[] not null default '{}',
  -- E2 classification. Confidence is a field (foundation: "when the OS is wrong").
  category text check (category in ('enquiry','supplier_doc','fiscal_legal','booking_change','newsletter_noise','other')),
  confidence numeric(4,3),
  classified_by text,               -- 'rule:<name>' | model id
  classified_at timestamptz,
  enquiry_fields jsonb,             -- {date, pax, budget_pp, venue_case, food_shape, language}
  needs_you_due date,
  register_id uuid,                 -- the needs-you register row (master_todos today)
  status text not null default 'new'
      check (status in ('new','classified','drafted','approved','replied','skipped','archived','flagged','noise','failed')),
  flagged boolean not null default false,
  flag_reason text,
  -- E3 draft
  draft_reply text, draft_lang text, draft_at timestamptz, draft_model text,
  -- E4 send (written by lib/email/reply.ts behind a consumed confirm token; checked by email-reply)
  approved_by_boris boolean not null default false,
  approved_at timestamptz,
  approved_by_user uuid,
  approved_confirm_token uuid,
  reply_text text,
  replied_at timestamptz,
  reply_gmail_message_id text,
  -- one of the four product numbers: received → sent, in hours. Stored, not reconstructed.
  hours_to_answer numeric(8,2) generated always as
    (case when replied_at is not null and first_received_at is not null
          then round((extract(epoch from (replied_at - first_received_at)) / 3600.0)::numeric, 2) end) stored,
  outcome text check (outcome in ('won','lost','no_answer','not_sales')),
  error text,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, gmail_thread_id)
);
create index if not exists email_threads_entity_status_idx on public.email_threads (entity_id, status, last_received_at desc);
create index if not exists email_threads_category_idx on public.email_threads (entity_id, category);

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads(id) on delete cascade,
  entity_id uuid not null references public.entities(id),
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  gmail_message_id text not null unique,
  direction text not null check (direction in ('in','out')),
  from_address text, from_name text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text,
  snippet text,
  body_text text,
  received_at timestamptz,
  labels text[] not null default '{}',
  message_id_header text,           -- RFC 5322 Message-ID, for In-Reply-To / References on the reply
  in_reply_to text,
  references_header text,
  -- [{filename, mime, size, attachment_id, storage_path, sha256, capture_table, capture_id, capture_status}]
  attachments jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
create index if not exists email_messages_thread_idx on public.email_messages (thread_id, received_at);
create index if not exists email_messages_entity_idx on public.email_messages (entity_id, received_at desc);

create table if not exists public.email_pulls (
  id bigint generated always as identity primary key,
  account_id uuid references public.email_accounts(id) on delete cascade,
  ran_at timestamptz not null default now(),
  via text,
  ok boolean not null default true,
  counts jsonb,
  error text
);
create index if not exists email_pulls_account_idx on public.email_pulls (account_id, ran_at desc);

create or replace function public.email_threads_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_email_threads_touch on public.email_threads;
create trigger trg_email_threads_touch before update on public.email_threads
  for each row execute function public.email_threads_touch();

-- ---------------------------------------------------------------- RLS
alter table public.email_accounts     enable row level security;
alter table public.email_oauth_states enable row level security;
alter table public.email_threads      enable row level security;
alter table public.email_messages     enable row level security;
alter table public.email_pulls        enable row level security;

revoke all on public.email_accounts, public.email_oauth_states, public.email_threads, public.email_messages, public.email_pulls from anon;

-- accounts: manager-only, every verb (credentials table, rls35 rule).
do $$
declare v text;
begin
  foreach v in array array['select','insert','update','delete'] loop
    execute format('drop policy if exists rls35_email_accounts_%s on public.email_accounts', v);
  end loop;
end $$;
create policy rls35_email_accounts_select on public.email_accounts for select to authenticated
  using (entity_id in (select public.app_my_managed_entities()));
create policy rls35_email_accounts_insert on public.email_accounts for insert to authenticated
  with check (entity_id in (select public.app_my_managed_entities()));
create policy rls35_email_accounts_update on public.email_accounts for update to authenticated
  using (entity_id in (select public.app_my_managed_entities()))
  with check (entity_id in (select public.app_my_managed_entities()));
create policy rls35_email_accounts_delete on public.email_accounts for delete to authenticated
  using (entity_id in (select public.app_my_managed_entities()));
-- the vault ids are opaque to authenticated (no grant on vault.decrypted_secrets), but keep them out of reach anyway
revoke all on public.email_accounts from authenticated;
grant select (id, entity_id, address, display_name, provider, scopes, status, forwards_to_holded, token_expires_at,
              history_id, connected_by, connected_at, last_pull_at, last_error, consecutive_failures, revoked_at, created_at)
  on public.email_accounts to authenticated;
grant update (display_name, forwards_to_holded, status) on public.email_accounts to authenticated;
grant delete on public.email_accounts to authenticated;

-- oauth states: service only.
revoke all on public.email_oauth_states from authenticated;

-- threads + messages: members read, managers write.
do $$
declare t text;
begin
  foreach t in array array['email_threads','email_messages']
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
-- approved_by_boris is written only inside confirmApproval() — but RLS cannot
-- tell a column apart, so the audit trail is the token on the row (E4).

drop policy if exists rls35_email_pulls_select on public.email_pulls;
create policy rls35_email_pulls_select on public.email_pulls for select to authenticated
  using (account_id in (select id from public.email_accounts where entity_id in (select public.current_person_entities())));

-- ---------------------------------------------------------------- views
create or replace view public.email_connection_health
with (security_invoker = true) as
select a.id as account_id, a.entity_id, e.slug as entity_slug, a.address, a.status, a.forwards_to_holded,
       a.connected_at, a.last_pull_at, a.last_error, a.consecutive_failures,
       (select count(*) from public.email_threads t where t.account_id = a.id and t.status in ('new','classified','drafted')) as waiting,
       (select max(p.ran_at) from public.email_pulls p where p.account_id = a.id and p.ok) as last_ok_pull
  from public.email_accounts a
  join public.entities e on e.id = a.entity_id
 where a.revoked_at is null;
grant select on public.email_connection_health to authenticated;

create or replace view public.email_inbox_waiting
with (security_invoker = true) as
select entity_id, count(*)::int as waiting
  from public.email_threads
 where status in ('new','classified','drafted') and not flagged
 group by entity_id;
grant select on public.email_inbox_waiting to authenticated;

-- ---------------------------------------------------------------- storage: private attachments bucket
insert into storage.buckets (id, name, public)
values ('email-attachments', 'email-attachments', false)
on conflict (id) do update set public = false;
drop policy if exists email_attachments_member_read on storage.objects;
create policy email_attachments_member_read on storage.objects for select to authenticated
  using (bucket_id = 'email-attachments'
         and split_part(name, '/', 1) in (select id::text from public.current_person_entities() as id));
-- writes: service role only (the poller). No authenticated insert policy on purpose.

-- ---------------------------------------------------------------- Vault RPCs (service role only)
-- Store / replace a mailbox + its tokens. Called by /api/email/callback with
-- the service client after the signed-in manager passed requireManagerOf().
create or replace function public.email_account_upsert(
  p_entity_id uuid, p_address text, p_display_name text, p_google_user_id text,
  p_scopes text[], p_access_token text, p_access_expires_at timestamptz, p_refresh_token text,
  p_connected_by uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  v_role text := current_setting('request.jwt.claim.role', true);
  v_id uuid; v_tok uuid; v_ref uuid; v_fwd boolean;
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres') then
    raise exception 'email_account_upsert: forbidden';
  end if;
  v_fwd := lower(p_address) like 'admin@%';
  insert into public.email_accounts (entity_id, address, display_name, google_user_id, scopes, status, forwards_to_holded,
                                     token_expires_at, connected_by, connected_at, last_error, consecutive_failures)
  values (p_entity_id, lower(p_address), p_display_name, p_google_user_id, coalesce(p_scopes,'{}'), 'active', v_fwd,
          p_access_expires_at, p_connected_by, now(), null, 0)
  on conflict (lower(address)) where revoked_at is null
  do update set entity_id = excluded.entity_id, display_name = coalesce(excluded.display_name, email_accounts.display_name),
                google_user_id = coalesce(excluded.google_user_id, email_accounts.google_user_id),
                scopes = excluded.scopes, status = 'active', token_expires_at = excluded.token_expires_at,
                connected_by = excluded.connected_by, connected_at = now(), last_error = null, consecutive_failures = 0
  returning id, token_vault_id, refresh_vault_id into v_id, v_tok, v_ref;

  if p_access_token is not null and length(p_access_token) > 0 then
    if v_tok is null then
      v_tok := vault.create_secret(p_access_token, format('email:gmail:%s:access', lower(p_address)), 'Gmail access token');
      update public.email_accounts set token_vault_id = v_tok where id = v_id;
    else
      perform vault.update_secret(v_tok, p_access_token);
    end if;
  end if;
  if p_refresh_token is not null and length(p_refresh_token) > 0 then
    if v_ref is null then
      v_ref := vault.create_secret(p_refresh_token, format('email:gmail:%s:refresh', lower(p_address)), 'Gmail refresh token');
      update public.email_accounts set refresh_vault_id = v_ref where id = v_id;
    else
      perform vault.update_secret(v_ref, p_refresh_token);
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.email_account_upsert(uuid,text,text,text,text[],text,timestamptz,text,uuid) from public, anon, authenticated;

-- Read the tokens (service role only). Returns one row or nothing.
create or replace function public.email_account_tokens(p_account_id uuid)
returns table(access_token text, refresh_token text, token_expires_at timestamptz)
language plpgsql security definer set search_path = public, vault as $$
declare v_role text := current_setting('request.jwt.claim.role', true); v_tok uuid; v_ref uuid; v_exp timestamptz;
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres') then
    raise exception 'email_account_tokens: forbidden';
  end if;
  select token_vault_id, refresh_vault_id, email_accounts.token_expires_at into v_tok, v_ref, v_exp
    from public.email_accounts where id = p_account_id and revoked_at is null;
  if v_ref is null then return; end if;
  return query
    select (select decrypted_secret from vault.decrypted_secrets where id = v_tok),
           (select decrypted_secret from vault.decrypted_secrets where id = v_ref),
           v_exp;
end $$;
revoke all on function public.email_account_tokens(uuid) from public, anon, authenticated;

-- Write back a refreshed access token (service role only).
create or replace function public.email_account_set_access(p_account_id uuid, p_access_token text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_role text := current_setting('request.jwt.claim.role', true); v_tok uuid; v_addr text;
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres') then
    raise exception 'email_account_set_access: forbidden';
  end if;
  select token_vault_id, address into v_tok, v_addr from public.email_accounts where id = p_account_id;
  if v_addr is null then return; end if;
  if v_tok is null then
    v_tok := vault.create_secret(p_access_token, format('email:gmail:%s:access', v_addr), 'Gmail access token');
    update public.email_accounts set token_vault_id = v_tok, token_expires_at = p_expires_at where id = p_account_id;
  else
    perform vault.update_secret(v_tok, p_access_token);
    update public.email_accounts set token_expires_at = p_expires_at where id = p_account_id;
  end if;
end $$;
revoke all on function public.email_account_set_access(uuid,text,timestamptz) from public, anon, authenticated;

-- Disconnect: the signed-in manager revokes the row and the secrets go with it.
create or replace function public.email_account_disconnect(p_account_id uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_tok uuid; v_ref uuid; v_entity uuid;
begin
  select token_vault_id, refresh_vault_id, entity_id into v_tok, v_ref, v_entity
    from public.email_accounts where id = p_account_id and revoked_at is null;
  if v_entity is null then return; end if;
  if coalesce(current_setting('request.jwt.claim.role', true), current_user) not in ('service_role','postgres')
     and v_entity not in (select public.app_my_managed_entities()) then
    raise exception 'email_account_disconnect: not a manager of this entity' using errcode = '42501';
  end if;
  update public.email_accounts set status = 'revoked', revoked_at = now(), token_vault_id = null, refresh_vault_id = null
   where id = p_account_id;
  if v_tok is not null then delete from vault.secrets where id = v_tok; end if;
  if v_ref is not null then delete from vault.secrets where id = v_ref; end if;
end $$;
revoke all on function public.email_account_disconnect(uuid) from public, anon;
grant execute on function public.email_account_disconnect(uuid) to authenticated;

-- ---------------------------------------------------------------- shared secret for the poller / classifier
-- Minted in SQL, held in Vault, never seen by a human. pg_cron reads it to call
-- /api/email/pull; the classify trigger (E2) sends it to Vercel; both callees
-- check it back with email_inbox_secret_ok(). Same model as social_inbox_secret.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'email_inbox_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'email_inbox_secret',
                                'email pull / classify shared secret (pg_cron → Vercel)');
  end if;
end $$;

create or replace function public.email_inbox_secret_ok(p_secret text)
returns boolean language plpgsql security definer set search_path = public, vault as $$
declare v_role text := current_setting('request.jwt.claim.role', true);
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres') then
    raise exception 'forbidden';
  end if;
  return p_secret is not null and length(p_secret) > 16 and exists (
    select 1 from vault.decrypted_secrets where name = 'email_inbox_secret' and decrypted_secret = p_secret);
end $$;
revoke all on function public.email_inbox_secret_ok(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- the poll: pg_cron every 10 min → pg_net → /api/email/pull
-- Deviation from the brief (which named an edge function `email-pull`): the
-- Google client secret lives only in Vercel (calendar + the old gmail connector
-- already use it), and the capture funnel + Haiku path the routing needs are
-- Vercel code. One place holds Google credentials; nothing new for Boris to
-- paste. The send path (E4) is still the edge function email-reply.
select cron.unschedule(jobid) from cron.job where jobname = 'email-pull';
select cron.schedule('email-pull', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://www.foodstudio.ai/api/email/pull',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-inbox-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'email_inbox_secret')),
    body := '{"via":"cron"}'::jsonb,
    timeout_milliseconds := 55000
  );
$$);

comment on table public.email_accounts is 'Connected mailboxes (Comms · email). Tokens in Vault via email_account_* RPCs; manager-only RLS.';
comment on table public.email_threads is 'One row per Gmail thread. Classified in E2; drafted in E3; sent ONLY by edge function email-reply behind approved_by_boris + a consumed chef_confirm_tokens row. hours_to_answer is one of the four product numbers.';
