-- Rollback for 20261003_oauth_clients_per_entity.sql. Deletes the Vault
-- secrets the table points at, then the table and RPCs. email_accounts keeps
-- the (nullable) oauth_client_id column — harmless; drop by hand if wanted.
delete from vault.secrets where id in (select secret_vault_id from public.oauth_clients where secret_vault_id is not null);
drop function if exists public.fn_oauth_client_for(uuid, text);
drop function if exists public.oauth_client_set(uuid, text, text, text, text);
drop function if exists public.oauth_client_disable(uuid, text);
drop table if exists public.oauth_clients;
drop function if exists public.oauth_clients_touch();
