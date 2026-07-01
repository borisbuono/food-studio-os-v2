-- Applied live 2026-07-01 via Supabase MCP. Captured here for repo provenance.
alter table entity_integrations
  add column if not exists entity_code text,
  add column if not exists encrypted_key text,
  add column if not exists key_iv text,
  add column if not exists key_tag text,
  add column if not exists last_check_at timestamptz,
  add column if not exists last_error text,
  add column if not exists added_by uuid references auth.users(id) on delete set null,
  add column if not exists rotated_at timestamptz,
  add column if not exists revoked_at timestamptz;

create unique index if not exists entity_integrations_active_per_entity_vendor_idx
  on entity_integrations (entity_code, platform) where revoked_at is null;
create index if not exists entity_integrations_entity_code_idx on entity_integrations (entity_code);

alter table entity_integrations enable row level security;
drop policy if exists "entity_integrations_read" on entity_integrations;
drop policy if exists "entity_integrations_write" on entity_integrations;
create policy "entity_integrations_read" on entity_integrations
  for select to authenticated using (true);
create policy "entity_integrations_write" on entity_integrations
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
