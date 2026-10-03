-- Rollback for 20261002_security_s2_backup.sql.
-- Unschedules the weekly job, drops the secret check, the DDL generator and the
-- backup_runs log. KEPT: the bucket `backups` and every copy in it (delete by
-- hand if wanted), the Vault secret db_backup_secret (harmless; delete with
-- `delete from vault.secrets where name='db_backup_secret'` if wanted), and the
-- edge function (Dashboard → Edge Functions → db-backup → Delete).

do $$ begin
  if exists (select 1 from cron.job where jobname = 'db-backup-weekly') then
    perform cron.unschedule('db-backup-weekly');
  end if;
end $$;

drop function if exists public.backup_schema_ddl(text[]);
drop function if exists public.db_backup_secret_ok(text);
drop table if exists public.backup_runs;
