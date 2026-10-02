-- =====================================================================
-- Security hardening S2 (2026-10-02) — the weekly logical backup.
--
-- Why a logical dump of our own: the org is on Supabase Free (no daily
-- backups, no branching, no pg_dump endpoint). Edge functions cannot run
-- the pg_dump binary. So the edge function `db-backup` connects to Postgres
-- (SUPABASE_DB_URL, provided to every edge function), reads every table in
-- `public` and `rls_audit` inside ONE repeatable-read transaction, writes
-- one NDJSON stream ({"t":"schema.table","r":{…}} per row) through gzip
-- into the private Storage bucket `backups/<stamp>/data.ndjson.gz`, next
-- to `schema.sql` (generated here, see backup_schema_ddl) and
-- `manifest.json` (tables, row counts, bytes, latest migration). `auth.users`
-- and `auth.identities` go in too — with passwords and tokens stripped — so
-- the uuids every FK points at survive. Eight weekly copies are kept.
--
-- This file: the Vault secret pg_cron hands to the function and the RPC
-- that checks it back (same model as social_inbox_secret), the `backup_runs`
-- log, the DDL generator, the private bucket, and the Sunday 04:00 UTC job.
--
-- Restore test (documented in docs/systems/backup.md): the same function,
-- called with {"restore_check":true}, loads the latest copy into a scratch
-- schema `restore_check` in this database, compares every table's row count
-- with the manifest, reports, and drops the schema.
--
-- Additive. Rollback: 20261002_security_s2_backup_ROLLBACK.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Secret + check
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'db_backup_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'db_backup_secret',
      'S2 2026-10-02: pg_cron → edge function db-backup (x-scheduler-secret). Rotate by updating this secret; the function reads it back through db_backup_secret_ok().');
  end if;
end $$;

create or replace function public.db_backup_secret_ok(p_secret text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare v_role text := current_setting('request.jwt.claim.role', true);
begin
  if coalesce(v_role, current_user) not in ('service_role', 'postgres') then
    raise exception 'forbidden';
  end if;
  return p_secret is not null and length(p_secret) > 16 and exists (
    select 1 from vault.decrypted_secrets where name = 'db_backup_secret' and decrypted_secret = p_secret);
end $$;
revoke all on function public.db_backup_secret_ok(text) from public, anon, authenticated;
grant execute on function public.db_backup_secret_ok(text) to service_role;

-- ---------------------------------------------------------------------
-- 2. The log — one row per run (backup or restore check)
-- ---------------------------------------------------------------------
create table if not exists public.backup_runs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'backup' check (kind in ('backup', 'restore_check', 'prune')),
  via          text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'error')),
  path         text,
  tables       int,
  rows_total   bigint,
  bytes_gz     bigint,
  schema_version text,
  report       jsonb,
  error        text
);
comment on table public.backup_runs is 'S2 2026-10-02: every weekly backup / restore check / prune the db-backup edge function ran. Platform owner reads; the function (service role) writes.';
alter table public.backup_runs enable row level security;
drop policy if exists backup_runs_owner_read on public.backup_runs;
create policy backup_runs_owner_read on public.backup_runs for select to authenticated
  using (public.app_is_platform_owner());
create index if not exists backup_runs_started_idx on public.backup_runs (started_at desc);

-- ---------------------------------------------------------------------
-- 3. schema.sql — what pg_dump --schema-only would say, from the catalogs.
--    The migrations folder in git is the authoritative schema; this is the
--    copy that travels WITH the data so a restore does not depend on git.
-- ---------------------------------------------------------------------
create or replace function public.backup_schema_ddl(p_schemas text[] default array['public','rls_audit'])
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text := current_setting('request.jwt.claim.role', true);
  out text := '';
  r record;
  cols text;
begin
  if coalesce(v_role, current_user) not in ('service_role', 'postgres') then
    raise exception 'forbidden';
  end if;

  out := out || format(E'-- Food Studio OS — schema snapshot %s\n-- schemas: %s\n-- latest migration: %s\n\n',
                       now()::text, array_to_string(p_schemas, ', '),
                       (select max(version) from supabase_migrations.schema_migrations));

  for r in select nspname from pg_namespace where nspname = any(p_schemas) order by 1 loop
    out := out || format(E'create schema if not exists %I;\n', r.nspname);
  end loop;
  out := out || E'\n-- extensions\n';
  for r in select extname, extversion from pg_extension where extname not in ('plpgsql') order by 1 loop
    out := out || format(E'create extension if not exists %I;\n', r.extname);
  end loop;

  out := out || E'\n-- enums\n';
  for r in
    select n.nspname, t.typname,
           string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) as labels
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
     where n.nspname = any(p_schemas) and t.typtype = 'e'
     group by 1, 2 order by 1, 2
  loop
    out := out || format(E'create type %I.%I as enum (%s);\n', r.nspname, r.typname, r.labels);
  end loop;

  out := out || E'\n-- sequences\n';
  for r in select sequence_schema, sequence_name from information_schema.sequences where sequence_schema = any(p_schemas) order by 1, 2 loop
    out := out || format(E'create sequence if not exists %I.%I;\n', r.sequence_schema, r.sequence_name);
  end loop;

  out := out || E'\n-- tables\n';
  for r in
    select c.oid, n.nspname, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any(p_schemas) and c.relkind in ('r', 'p')
     order by n.nspname, c.relname
  loop
    select string_agg(
             format('  %I %s%s%s%s',
               a.attname,
               format_type(a.atttypid, a.atttypmod),
               case when a.attnotnull then ' not null' else '' end,
               case when a.attgenerated = 's' then ' generated always as (' || pg_get_expr(d.adbin, d.adrelid) || ') stored'
                    when d.adbin is not null and a.attidentity = '' then ' default ' || pg_get_expr(d.adbin, d.adrelid)
                    else '' end,
               case when a.attidentity = 'a' then ' generated always as identity'
                    when a.attidentity = 'd' then ' generated by default as identity' else '' end),
             E',\n' order by a.attnum)
      into cols
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped;
    out := out || format(E'create table if not exists %I.%I (\n%s\n);\n', r.nspname, r.relname, coalesce(cols, ''));
    if exists (select 1 from pg_class where oid = r.oid and relrowsecurity) then
      out := out || format(E'alter table %I.%I enable row level security;\n', r.nspname, r.relname);
    end if;
    if exists (select 1 from pg_class where oid = r.oid and relforcerowsecurity) then
      out := out || format(E'alter table %I.%I force row level security;\n', r.nspname, r.relname);
    end if;
  end loop;

  out := out || E'\n-- constraints (primary keys, unique, check first; foreign keys after every table exists)\n';
  for r in
    select n.nspname, c.relname, k.conname, pg_get_constraintdef(k.oid) as def, k.contype
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any(p_schemas)
     order by case k.contype when 'p' then 0 when 'u' then 1 when 'c' then 2 when 'x' then 3 else 4 end, n.nspname, c.relname, k.conname
  loop
    out := out || format(E'alter table %I.%I add constraint %I %s;\n', r.nspname, r.relname, r.conname, r.def);
  end loop;

  out := out || E'\n-- indexes (not backing a constraint)\n';
  for r in
    select i.schemaname, i.tablename, i.indexname, i.indexdef
      from pg_indexes i
     where i.schemaname = any(p_schemas)
       and not exists (select 1 from pg_constraint k join pg_class ic on ic.oid = k.conindid where ic.relname = i.indexname)
     order by 1, 2, 3
  loop
    out := out || replace(r.indexdef, 'CREATE INDEX', 'CREATE INDEX IF NOT EXISTS') || E';\n';
  end loop;

  out := out || E'\n-- views\n';
  for r in
    select n.nspname, c.relname, c.relkind, pg_get_viewdef(c.oid, true) as def,
           (select string_agg(format('%s=%s', o.option_name, o.option_value), ', ') from pg_options_to_table(c.reloptions) o) as opts
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any(p_schemas) and c.relkind in ('v', 'm')
     order by 1, 2
  loop
    out := out || format(E'create or replace %s %I.%I%s as\n%s\n',
                         case r.relkind when 'm' then 'materialized view' else 'view' end,
                         r.nspname, r.relname,
                         case when r.opts is not null then ' with (' || r.opts || ')' else '' end,
                         r.def);
  end loop;

  out := out || E'\n-- functions\n';
  for r in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any(p_schemas)
       and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     order by p.proname, p.oid
  loop
    out := out || pg_get_functiondef(r.oid) || E';\n\n';
  end loop;

  out := out || E'\n-- triggers\n';
  for r in
    select pg_get_triggerdef(t.oid) as def
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any(p_schemas) and not t.tgisinternal
     order by c.relname, t.tgname
  loop
    out := out || r.def || E';\n';
  end loop;

  out := out || E'\n-- policies\n';
  for r in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies where schemaname = any(p_schemas) order by 1, 2, 3
  loop
    out := out || format(E'create policy %I on %I.%I as %s for %s to %s%s%s;\n',
      r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd, array_to_string(r.roles, ', '),
      case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end);
  end loop;

  out := out || E'\n-- pg_cron jobs (informational — recreate by hand)\n';
  for r in select jobname, schedule, command from cron.job order by jobname loop
    out := out || format(E'-- cron.schedule(%L, %L, $job$%s$job$);\n', r.jobname, r.schedule, r.command);
  end loop;

  out := out || E'\n-- storage buckets (informational)\n';
  for r in select id, public from storage.buckets order by id loop
    out := out || format(E'-- bucket %s public=%s\n', r.id, r.public);
  end loop;

  return out;
end $$;
revoke all on function public.backup_schema_ddl(text[]) from public, anon, authenticated;
grant execute on function public.backup_schema_ddl(text[]) to service_role;

-- ---------------------------------------------------------------------
-- 4. Private bucket. No policies for anon/authenticated: service role only.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, null)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------
-- 5. Sunday 04:00 UTC
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from cron.job where jobname = 'db-backup-weekly') then
    perform cron.unschedule('db-backup-weekly');
  end if;
end $$;
select cron.schedule(
  'db-backup-weekly',
  '0 4 * * 0',
  $job$
  select net.http_post(
    url := 'https://rfdsysrdoncyoytcrzpg.supabase.co/functions/v1/db-backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets
                              where name = 'db_backup_secret')),
    body := '{"via":"pg_cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
