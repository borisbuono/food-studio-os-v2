# Backups — what we have, where it is, how to restore

Written 2026-10-02 (security hardening, slice S2).

## The one line

**Every Sunday 04:00 UTC, pg_cron calls the edge function `db-backup`, which writes a full logical copy of the database into the private Storage bucket `backups/<stamp>/`. Eight weekly copies are kept. The same function proves a copy can be restored (`restore_check`).**

Until the Supabase org is on Pro this is the **only** backup. On Pro, Supabase adds daily physical backups (7 days) and this becomes the second, independent copy — keep both.

## What a copy contains

| file | what |
|---|---|
| `manifest.json` | every table with row count, columns written, columns excluded, byte size; totals; `schema_version` = the latest applied migration; the exclusion rules in force |
| `schema.sql` | `backup_schema_ddl()` — schemas, extensions, enums, sequences, every table with columns/defaults/generated columns, all constraints, indexes, views (with `security_invoker`), functions, triggers, RLS flags and policies; pg_cron jobs and buckets as comments. `supabase/migrations/` in git stays the authoritative schema; this is the copy that travels with the data |
| `data.ndjson.gz` | one line per row, `{"t":"schema.table","r":{…row…}}`, every base table in `public` and `rls_audit`, read in **one repeatable-read transaction** (a consistent snapshot), plus `auth.users` and `auth.identities` **without** passwords or tokens (the uuids every FK points at must survive) |

Not written: generated columns (recomputed on load), anything in `BACKUP_EXCLUDE_COLUMNS` (default `public.chef_turns.audio` — no such column today; the rule is there so a future audio column cannot slip into a dump), the `vault` schema (secrets are never backed up — see "Secrets" below), Storage **objects** (photos, PDFs, CVs — see "What is NOT covered").

First run 2026-10-02: 215 tables, 48 461 rows, 4.1 MB gzipped, 6.6 s. Restore check: 215/215 tables, 48 461/48 461 rows, 0 mismatches, 6.5 s.

## Where

- Bucket `backups` (Supabase Storage, project `rfdsysrdoncyoytcrzpg`, eu-west-1). **Private** — no policy for anon or authenticated; only the service role (the edge function, the dashboard) reads it. Dashboard → Storage → backups.
- Log: table `public.backup_runs` (one row per backup / restore check / prune; platform owner can read it from the SQL editor: `select * from backup_runs order by started_at desc;`).
- Code: `supabase/functions/db-backup/index.ts`. Deployed with the Supabase MCP / CLI (`supabase functions deploy db-backup --no-verify-jwt`).
- Schedule: pg_cron job `db-backup-weekly`, `0 4 * * 0`. Secret: Vault `db_backup_secret`, checked back by `db_backup_secret_ok()`.

## Run one by hand

From the SQL editor (this is exactly what the cron does):

```sql
select net.http_post(
  url := 'https://rfdsysrdoncyoytcrzpg.supabase.co/functions/v1/db-backup',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'db_backup_secret')),
  body := '{"via":"manual"}'::jsonb, timeout_milliseconds := 150000);
-- a few seconds later:
select status_code, content::text from net._http_response order by id desc limit 1;
select * from backup_runs order by started_at desc limit 1;
```

Bodies: `{}` backup now · `{"restore_check":true}` restore the latest copy into a scratch schema and compare counts · `{"restore_check":true,"prefix":"2026-10-02T13-27-15Z"}` a specific copy · `{"restore_check":true,"keep_schema":true}` leave the scratch schema `restore_check` in place to look at · `{"prune":true}` apply the retention.

## The restore test (run it after any schema change you care about, and once a month)

`{"restore_check":true}` does, inside this database:

1. downloads the newest `manifest.json` + `data.ndjson.gz`;
2. `create schema restore_check`; for every table in the manifest `create table restore_check.<schema>__<table> (like <schema>.<table>)` — same columns, no constraints, triggers or RLS; excluded columns lose `not null`;
3. streams the gzip line by line and loads each table in batches of 2 000 rows through `json_populate_recordset` (so types, arrays, jsonb, timestamps all go through Postgres's own input functions — a column that cannot be loaded fails loudly);
4. counts every scratch table against the manifest; reports mismatches;
5. drops the schema (unless `keep_schema`), writes a `backup_runs` row `kind=restore_check`.

`ok: true, mismatches: []` is the pass. It ran on 2026-10-02 against the first copy and passed.

## A real restore (disaster) — step by step

You need: a Postgres to restore into (a fresh Supabase project, or this one after the damage), `psql`, and the copy's three files downloaded from the bucket.

1. **Schema.** Preferred: apply `supabase/migrations/*.sql` from git in order (`supabase db push`, or `psql -f` each file). Fallback when git is not to hand: `psql -f schema.sql` — it recreates tables, constraints, indexes, views, functions, triggers and policies; cron jobs and buckets are listed as comments to redo by hand.
2. **Auth users first** (FKs point at them). From `data.ndjson.gz`, lines with `"t":"auth.users"` → `insert into auth.users (…columns in the manifest…) select … from json_populate_recordset(null::auth.users, '[…]')`. Passwords are not in the copy: people sign in again with Google / magic link. Then `auth.identities`.
3. **Data.** For every other table in manifest order, disable triggers and load:
   ```sql
   alter table public.<t> disable trigger all;
   insert into public.<t> (<manifest.columns>) select <manifest.columns>
     from json_populate_recordset(null::public.<t>, $$[ …rows for this table, comma-joined… ]$$::json);
   alter table public.<t> enable trigger all;
   ```
   A small script does this from the NDJSON: group lines by `t`, strip the `{"t":…,"r":` wrapper and the last `}`, join with commas. The edge function's `runRestoreCheck` is that script in TypeScript — copy it.
   Generated columns fill themselves. Sequences: `select setval(pg_get_serial_sequence('public.<t>','id'), max(id)) from public.<t>` for the few serial tables.
4. **Secrets and cron.** Re-create Vault secrets (`select vault.create_secret(...)` — values from the password manager, never from a backup), re-run the `cron.schedule` lines at the bottom of `schema.sql`, re-deploy edge functions from git.
5. **Storage objects** are not in this copy — see below.
6. Point Vercel at the new project (`NEXT_PUBLIC_SUPABASE_URL`, anon key, service key), redeploy, sign in, run `{"restore_check":true}` once more on the new project to prove the pipeline works there too.

## What is NOT covered

- **Storage objects**: `captures` (photographed invoices/delivery notes), `documents`, `documents-inbox`, `hiring-cvs`, `pa_inbox`, `email-attachments`, `recipe-images`, `social-media`. Tens of thousands of files are not a job for a 150-second edge function. Follow-up: a weekly `rclone`/`supabase storage cp` of these buckets to Drive from a machine with the service key — or Supabase Pro, where Storage is included in the platform backup.
- **Vault secrets** — by design. Keep them in the password manager.
- **WAL / point-in-time** — only Supabase Pro + PITR gives that. Our granularity is one week (plus whatever Pro adds).
- `email_*` tables (the parallel comms/email lane, 2026-10) are backed up like every other `public` table — nothing to do. **Retention** of their contents is S6's business, not the backup's.

## Secrets

`db_backup_secret` lives in Vault. pg_cron reads it with `vault.decrypted_secrets`; the function checks it back with `db_backup_secret_ok()` (only `service_role`/`postgres` may call that). To rotate: `select vault.update_secret((select id from vault.secrets where name='db_backup_secret'), encode(gen_random_bytes(32),'hex'));` — nothing else to change.

## When the org moves to Pro

Keep this job. Turn on daily backups and PITR in the dashboard; add a line here with the date. Optionally raise `BACKUP_KEEP` (edge function env) to 12.

## Rollback of the slice

`supabase/migrations/20261002_security_s2_backup_ROLLBACK.sql` — unschedules the job, drops the two functions and the log table. The bucket and its copies are **kept** (delete by hand if you really want them gone). The edge function is deleted from the dashboard (Edge Functions → db-backup → Delete) or left — without the secret check passing it does nothing.
