-- Google OAuth credentials become PER ENTITY (Boris ruled 2026-10-03).
--
-- Why: the Google app is Internal, which yields one OAuth client per Workspace
-- (ibzfoodstudio.com → Taller/Holdings; bistro-mondo.com → Bistro Mondo), and
-- an Internal client only admits its own org's users. The code read a single
-- GOOGLE_OAUTH_CLIENT_ID / _SECRET pair. External-unverified (7-day tokens)
-- and External-verified (CASA) were rejected for now. Foundation principle 4:
-- credentials are configuration, not hard-coded.
--
-- Shape (mirrors email_accounts / social_accounts: rows, secret in Vault):
--   oauth_clients          one row per (entity, provider); the secret is a Vault id
--   fn_oauth_client_for    SECURITY DEFINER, service_role only — the ONLY way to
--                          read the secret; used by the connect route and the
--                          token-refresh path. No row → the caller falls back to
--                          the env pair (so the calendar connect keeps working).
--   oauth_client_set       manager of the entity pastes id + secret (Vault write)
--   oauth_client_disable   manager flips status; the secret is deleted from Vault
--   email_accounts.oauth_client_id   which Google client minted the mailbox's
--                          tokens, so refresh uses the same one and a replaced
--                          client flips the row to needs_reconnect instead of
--                          failing silently.
-- Additive only. Rollback: 20261003_oauth_clients_per_entity_ROLLBACK.sql

create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  provider text not null default 'google' check (provider in ('google')),
  client_id text not null,
  secret_vault_id uuid,                       -- vault.secrets id; never selectable by clients
  hosted_domain text,                         -- Google `hd` hint, e.g. bistro-mondo.com (optional)
  status text not null default 'active' check (status in ('active','disabled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (entity_id, provider)
);
create index if not exists oauth_clients_entity_idx on public.oauth_clients (entity_id, provider, status);

create or replace function public.oauth_clients_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_oauth_clients_touch on public.oauth_clients;
create trigger trg_oauth_clients_touch before update on public.oauth_clients
  for each row execute function public.oauth_clients_touch();

-- which client minted this mailbox's tokens (Google client_id string)
alter table public.email_accounts add column if not exists oauth_client_id text;

-- ---------------------------------------------------------------- RLS: manager of that entity, read only; writes via RPCs
alter table public.oauth_clients enable row level security;
revoke all on public.oauth_clients from anon, authenticated, public;
drop policy if exists rls35_oauth_clients_select on public.oauth_clients;
create policy rls35_oauth_clients_select on public.oauth_clients for select to authenticated
  using (entity_id in (select public.app_my_managed_entities()));
-- column grant: everything except the Vault id. No insert/update/delete grant —
-- the RPCs below are the write path and re-check the membership themselves.
grant select (id, entity_id, provider, client_id, hosted_domain, status, created_by, created_at, updated_by, updated_at)
  on public.oauth_clients to authenticated;

-- ---------------------------------------------------------------- the only reader of the secret (service_role / postgres)
create or replace function public.fn_oauth_client_for(p_entity_id uuid, p_provider text default 'google')
returns table(client_id text, client_secret text, hosted_domain text, status text)
language plpgsql security definer set search_path = public, vault as $$
declare v_role text := nullif(current_setting('request.jwt.claim.role', true), '');
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres') then
    raise exception 'fn_oauth_client_for: forbidden';
  end if;
  return query
    select c.client_id,
           (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.secret_vault_id),
           c.hosted_domain, c.status
      from public.oauth_clients c
     where c.entity_id = p_entity_id and c.provider = p_provider and c.status = 'active'
     limit 1;
end $$;
revoke all on function public.fn_oauth_client_for(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- manager writes
-- Paste (or replace) the client for a house. The secret goes to Vault; the row
-- holds only the id. Signed-in manager of the entity, or service role.
create or replace function public.oauth_client_set(
  p_entity_id uuid, p_provider text, p_client_id text, p_client_secret text, p_hosted_domain text default null)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  v_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_uid uuid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  v_id uuid; v_vault uuid;
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres')
     and p_entity_id not in (select public.app_my_managed_entities()) then
    raise exception 'oauth_client_set: not a manager of this entity' using errcode = '42501';
  end if;
  if p_provider is distinct from 'google' then raise exception 'oauth_client_set: provider must be google'; end if;
  if coalesce(trim(p_client_id), '') = '' or coalesce(p_client_secret, '') = '' then
    raise exception 'oauth_client_set: client id and secret are required';
  end if;

  select id, secret_vault_id into v_id, v_vault from public.oauth_clients
   where entity_id = p_entity_id and provider = p_provider;

  if v_id is null then
    v_vault := vault.create_secret(p_client_secret, format('oauth:%s:%s:secret', p_provider, p_entity_id), 'OAuth client secret');
    insert into public.oauth_clients (entity_id, provider, client_id, secret_vault_id, hosted_domain, status, created_by, updated_by)
    values (p_entity_id, p_provider, trim(p_client_id), v_vault, nullif(lower(trim(p_hosted_domain)), ''), 'active', v_uid, v_uid)
    returning id into v_id;
  else
    if v_vault is null then
      v_vault := vault.create_secret(p_client_secret, format('oauth:%s:%s:secret', p_provider, p_entity_id), 'OAuth client secret');
    else
      perform vault.update_secret(v_vault, p_client_secret);
    end if;
    update public.oauth_clients
       set client_id = trim(p_client_id), secret_vault_id = v_vault,
           hosted_domain = nullif(lower(trim(p_hosted_domain)), ''), status = 'active', updated_by = v_uid
     where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.oauth_client_set(uuid, text, text, text, text) from public, anon;
grant execute on function public.oauth_client_set(uuid, text, text, text, text) to authenticated;

-- Disable: the row stays (id prefix + date still shown), the secret leaves Vault.
create or replace function public.oauth_client_disable(p_entity_id uuid, p_provider text default 'google')
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  v_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_uid uuid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  v_vault uuid;
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres')
     and p_entity_id not in (select public.app_my_managed_entities()) then
    raise exception 'oauth_client_disable: not a manager of this entity' using errcode = '42501';
  end if;
  select secret_vault_id into v_vault from public.oauth_clients where entity_id = p_entity_id and provider = p_provider;
  update public.oauth_clients set status = 'disabled', secret_vault_id = null, updated_by = v_uid
   where entity_id = p_entity_id and provider = p_provider;
  if v_vault is not null then delete from vault.secrets where id = v_vault; end if;
end $$;
revoke all on function public.oauth_client_disable(uuid, text) from public, anon;
grant execute on function public.oauth_client_disable(uuid, text) to authenticated;

comment on table public.oauth_clients is 'Per-entity OAuth clients (Google, Internal per Workspace). Secret in Vault via oauth_client_set; read only by fn_oauth_client_for (service_role). Manager-only RLS, column grant excludes secret_vault_id.';
comment on column public.email_accounts.oauth_client_id is 'Google client_id that minted this mailbox''s tokens; refresh must use the same one.';
