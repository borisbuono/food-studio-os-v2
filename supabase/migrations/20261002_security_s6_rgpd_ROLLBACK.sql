-- Rollback for 20261002_security_s6_rgpd.sql (+ _s6b_privacy_controller).
-- Unschedules the daily sweep, drops the retention + export functions and the two
-- log tables. KEPT: candidates.anonymised_at / guests.anonymised_at (data), rows
-- already anonymised (that is the point of the job), the buckets `exports` and
-- their zips, the Vault secret rgpd_secret, and the edge functions retention-sweep
-- / tenant-export (Dashboard → Edge Functions → Delete; without rgpd_secret_ok()
-- they refuse every call).

do $$ begin
  if exists (select 1 from cron.job where jobname = 'retention-sweep-daily') then
    perform cron.unschedule('retention-sweep-daily');
  end if;
end $$;

drop function if exists public.privacy_page_controller(text);
drop function if exists public.export_tenant_rows(uuid);
drop function if exists public._export_denylist();
drop function if exists public.fn_retention_sweep();
drop function if exists public.fn_retention_chef_turns();
drop function if exists public.fn_retention_guests();
drop function if exists public.fn_retention_candidates();
drop function if exists public.rgpd_secret_ok(text);
drop table if exists public.tenant_exports;
drop table if exists public.data_retention_log;
