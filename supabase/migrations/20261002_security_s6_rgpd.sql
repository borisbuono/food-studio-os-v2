-- =====================================================================
-- Security hardening S6 (2026-10-02) — the RGPD pack, database side.
--
-- 1. Retention, as promised in the privacy notice, enforced by a job:
--    · candidates not hired → anonymised when `retain_until` passes
--      (6 months from the application for new applicants — the apply form
--      says so; rows that were promised 12 months keep their date);
--    · guests → anonymised 3 years after the last visit/booking (bookings,
--      feedback, visits, newsletter opt-ins follow);
--    · chef_turns → transcript and result scrubbed after 90 days (metrics stay).
--    fn_retention_sweep() runs the three, logs to data_retention_log, and
--    returns the CV files to delete — the edge function `retention-sweep`
--    (pg_cron daily 04:20 UTC) calls it and removes those files from the
--    `hiring-cvs` bucket (SQL cannot delete Storage objects properly).
-- 2. Clean exit: export_tenant_rows(entity) returns every row that belongs
--    to a tenant — tables keyed by entity_id / operator_entity_id /
--    restaurant_id / entity_code directly, and child tables one FK hop away
--    (recipe_ingredients → recipes, interviews → candidates …). The edge
--    function `tenant-export` zips it (one JSON per table + manifest) into
--    the private bucket `exports` and logs it in tenant_exports.
-- 3. One Vault secret (rgpd_secret) + rgpd_secret_ok() for both functions,
--    same model as db_backup_secret / social_inbox_secret.
--
-- Additive. Rollback: 20261002_security_s6_rgpd_ROLLBACK.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Secret + check
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'rgpd_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'rgpd_secret',
      'S6 2026-10-02: pg_cron → edge functions retention-sweep and tenant-export (x-scheduler-secret), checked back by rgpd_secret_ok().');
  end if;
end $$;

create or replace function public.rgpd_secret_ok(p_secret text)
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
    select 1 from vault.decrypted_secrets where name = 'rgpd_secret' and decrypted_secret = p_secret);
end $$;
revoke all on function public.rgpd_secret_ok(text) from public, anon, authenticated;
grant execute on function public.rgpd_secret_ok(text) to service_role;

-- ---------------------------------------------------------------------
-- 1. Retention
-- ---------------------------------------------------------------------
alter table public.candidates add column if not exists anonymised_at timestamptz;
alter table public.guests     add column if not exists anonymised_at timestamptz;
comment on column public.candidates.anonymised_at is 'S6: set by fn_retention_candidates when the personal data was removed (retain_until passed, not hired).';
comment on column public.guests.anonymised_at     is 'S6: set by fn_retention_guests 3 years after the last visit/booking.';

create table if not exists public.data_retention_log (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  job         text not null,
  affected    int not null default 0,
  detail      jsonb
);
comment on table public.data_retention_log is 'S6 2026-10-02: one row per retention job run (candidates, guests, chef_turns). Platform owner reads.';
alter table public.data_retention_log enable row level security;
drop policy if exists data_retention_log_owner_read on public.data_retention_log;
create policy data_retention_log_owner_read on public.data_retention_log for select to authenticated
  using (public.app_is_platform_owner());
create index if not exists data_retention_log_ran_idx on public.data_retention_log (ran_at desc);

-- Candidates: not hired, promise date passed → personal data gone, the row and
-- its funnel statistics stay. Returns the CV storage paths to delete.
create or replace function public.fn_retention_candidates()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text := current_setting('request.jwt.claim.role', true);
  ids uuid[];
  paths text[];
  n int;
begin
  if coalesce(v_role, current_user) not in ('service_role', 'postgres') then
    raise exception 'forbidden';
  end if;

  select array_agg(c.id), array_agg(c.cv_path) filter (where c.cv_path is not null)
    into ids, paths
    from public.candidates c
   where c.anonymised_at is null
     and coalesce(c.status, '') <> 'hired'
     and c.team_member_id is null
     and coalesce(c.retain_until, (c.created_at + interval '6 months')::date) < current_date;

  if ids is null then
    insert into public.data_retention_log (job, affected, detail) values ('candidates', 0, '{"cv_paths":[]}'::jsonb);
    return jsonb_build_object('affected', 0, 'cv_paths', '[]'::jsonb);
  end if;

  update public.candidates c
     set name = 'Candidato anonimizado',
         email = null, phone = null, cv_url = null, cv_path = null,
         notes = null, profile = '{}'::jsonb, summary = null, answers = null,
         score_reasons = '[]'::jsonb, languages = null, location = null, availability = null,
         right_to_work = null, source_ref = null, ip_hash = null,
         apply_token = null, interview_token = null,
         anonymised_at = now(), updated_at = now()
   where c.id = any(ids);
  get diagnostics n = row_count;

  update public.interviews i set strengths = null, concerns = null, notes = null where i.candidate_id = any(ids);
  update public.candidate_touches t set subject = null, body = null, body_alt = null, notes = null where t.candidate_id = any(ids);

  insert into public.data_retention_log (job, affected, detail)
  values ('candidates', n, jsonb_build_object('cv_paths', to_jsonb(coalesce(paths, '{}'::text[])), 'ids', to_jsonb(ids)));
  return jsonb_build_object('affected', n, 'cv_paths', to_jsonb(coalesce(paths, '{}'::text[])));
end $$;
revoke all on function public.fn_retention_candidates() from public, anon, authenticated;
grant execute on function public.fn_retention_candidates() to service_role;

-- Guests: nothing in three years → name, contact, allergies, birthday, notes
-- gone; the booking history keeps its dates and covers (operations numbers).
create or replace function public.fn_retention_guests()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text := current_setting('request.jwt.claim.role', true);
  ids uuid[];
  n int := 0; nb int := 0;
  cutoff timestamptz := now() - interval '3 years';
begin
  if coalesce(v_role, current_user) not in ('service_role', 'postgres') then
    raise exception 'forbidden';
  end if;

  select array_agg(g.id) into ids
    from public.guests g
   where g.anonymised_at is null
     and coalesce(g.last_visit_at, g.created_at) < cutoff
     and not exists (select 1 from public.bookings b where b.guest_id = g.id and b.service_date >= cutoff::date)
     and not exists (select 1 from public.guest_visits v where v.guest_id = g.id and v.visit_date >= cutoff::date);

  if ids is not null then
    update public.guests g
       set name = 'Anonimizado', email = null, phone = null, allergies = null, dietary = null,
           birthday = null, notes = null, anonymised_at = now(), updated_at = now()
     where g.id = any(ids);
    get diagnostics n = row_count;
    update public.bookings b set guest_name = 'Anonimizado', notes = null where b.guest_id = any(ids);
    update public.guest_feedback f set body = null where f.guest_id = any(ids) and f.body is not null;
    update public.guest_visits v set notes = null where v.guest_id = any(ids) and v.notes is not null;
    -- a live opt-in for a person we no longer know is meaningless → gone; an
    -- opt-out stays as a fact, with the address replaced by a hash (email is not null)
    delete from public.guest_newsletter_optins o where o.guest_id = any(ids) and o.opted_out_at is null;
    update public.guest_newsletter_optins o set email = 'anonymised-' || left(md5(o.email), 12) || '@invalid'
     where o.guest_id = any(ids) and o.email not like 'anonymised-%';
  end if;

  -- Walk-in bookings with a name but no guest row, older than three years.
  update public.bookings b
     set guest_name = 'Anonimizado', notes = null
   where b.guest_id is null
     and b.service_date < cutoff::date
     and (b.guest_name is distinct from 'Anonimizado' or b.notes is not null);
  get diagnostics nb = row_count;

  insert into public.data_retention_log (job, affected, detail)
  values ('guests', n, jsonb_build_object('bookings_without_guest', nb, 'ids', to_jsonb(coalesce(ids, '{}'::uuid[]))));
  return jsonb_build_object('affected', n, 'bookings_without_guest', nb);
end $$;
revoke all on function public.fn_retention_guests() from public, anon, authenticated;
grant execute on function public.fn_retention_guests() to service_role;

-- Chef turns: what was said is gone after 90 days; what it cost and whether it
-- worked stays for the metrics.
create or replace function public.fn_retention_chef_turns()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text := current_setting('request.jwt.claim.role', true);
  n int;
begin
  if coalesce(v_role, current_user) not in ('service_role', 'postgres') then
    raise exception 'forbidden';
  end if;
  update public.chef_turns t
     set transcript = null, result = null
   where t.created_at < now() - interval '90 days'
     and (t.transcript is not null or t.result is not null);
  get diagnostics n = row_count;
  insert into public.data_retention_log (job, affected) values ('chef_turns', n);
  return jsonb_build_object('affected', n);
end $$;
revoke all on function public.fn_retention_chef_turns() from public, anon, authenticated;
grant execute on function public.fn_retention_chef_turns() to service_role;

create or replace function public.fn_retention_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text := current_setting('request.jwt.claim.role', true);
  c jsonb; g jsonb; t jsonb;
begin
  if coalesce(v_role, current_user) not in ('service_role', 'postgres') then
    raise exception 'forbidden';
  end if;
  c := public.fn_retention_candidates();
  g := public.fn_retention_guests();
  t := public.fn_retention_chef_turns();
  return jsonb_build_object('ran_at', now(), 'candidates', c, 'guests', g, 'chef_turns', t);
end $$;
revoke all on function public.fn_retention_sweep() from public, anon, authenticated;
grant execute on function public.fn_retention_sweep() to service_role;

-- ---------------------------------------------------------------------
-- 2. Clean exit — every row that belongs to one tenant
-- ---------------------------------------------------------------------
create table if not exists public.tenant_exports (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.entities(id) on delete cascade,
  requested_by uuid,
  created_at  timestamptz not null default now(),
  path        text,
  bytes       bigint,
  tables      int,
  rows_total  bigint,
  skipped     jsonb,
  status      text not null default 'running' check (status in ('running','ok','error')),
  error       text
);
comment on table public.tenant_exports is 'S6 2026-10-02: every tenant export (clean exit / portability) the tenant-export edge function produced. Owners of the entity and the platform owner read.';
alter table public.tenant_exports enable row level security;
drop policy if exists tenant_exports_read on public.tenant_exports;
create policy tenant_exports_read on public.tenant_exports for select to authenticated
  using (entity_id in (select public.app_my_managed_entities()) or public.app_is_platform_owner());

insert into storage.buckets (id, name, public) values ('exports', 'exports', false)
on conflict (id) do update set public = false;

-- Tables that never leave: credentials, platform plumbing, other tenants' audit.
create or replace function public._export_denylist()
returns text[] language sql immutable as $$
  select array['pos_credentials','integrations','entity_integrations','accounting_integrations','booking_integrations',
               'google_calendar_tokens','chef_confirm_tokens','backup_runs','tenant_exports','data_retention_log',
               'booking_attempts','cron_runs','email_pulls','social_inbox_pulls','platform_billing_status','platform_reactivation_state']
$$;

create or replace function public.export_tenant_rows(p_entity uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text := current_setting('request.jwt.claim.role', true);
  ent record;
  rids uuid[];
  codes text[];
  t record;
  pred text;
  rows jsonb;
  n int;
  out_tables jsonb := '{}'::jsonb;
  counts jsonb := '{}'::jsonb;
  skipped text[] := '{}';
  direct jsonb := '{}'::jsonb;   -- table -> predicate, for the FK hop
  fk record;
begin
  if coalesce(v_role, current_user) not in ('service_role', 'postgres') then
    raise exception 'forbidden';
  end if;
  select * into ent from public.entities where id = p_entity;
  if ent.id is null then raise exception 'entity % not found', p_entity; end if;

  select coalesce(array_agg(r.id), '{}') into rids from public.restaurants r where r.entity_id = p_entity;
  select coalesce(array_agg(k), '{}') into codes from public._entity_keys(array[p_entity]) k;

  -- pass 1: direct predicates
  for t in
    select c.relname as tbl,
           bool_or(a.attname = 'entity_id')          as has_e,
           bool_or(a.attname = 'operator_entity_id') as has_o,
           bool_or(a.attname = 'restaurant_id')      as has_r,
           bool_or(a.attname = 'entity_code')        as has_k,
           bool_or(a.attname = 'id')                 as has_id
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where ns.nspname = 'public' and c.relkind = 'r'
       and c.relname <> all (public._export_denylist())
       and c.relname not like '\_%'
     group by c.relname order by c.relname
  loop
    pred := null;
    if t.tbl = 'entities' then pred := format('id = %L', p_entity);
    elsif t.tbl = 'team_members' then
      pred := format('(operator_entity_id = %L or id in (select person_id from public.memberships where entity_id = %L))', p_entity, p_entity);
    elsif t.tbl = 'person_auth_link' then
      pred := format('person_id in (select person_id from public.memberships where entity_id = %L)', p_entity);
    elsif t.has_e then pred := format('entity_id = %L', p_entity);
    elsif t.has_o then pred := format('operator_entity_id = %L', p_entity);
    elsif t.has_r then pred := format('restaurant_id = any(%L::uuid[])', rids);
    elsif t.has_k then pred := format('entity_code = any(%L::text[])', codes);
    end if;
    if pred is not null then direct := direct || jsonb_build_object(t.tbl, pred); end if;
  end loop;

  -- pass 2: one FK hop into a direct table (child rows of exported parents)
  for t in
    select c.relname as tbl from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and c.relname <> all (public._export_denylist()) and c.relname not like '\_%'
       and not (direct ? c.relname)
     order by c.relname
  loop
    pred := null;
    for fk in
      select a.attname as col, pc.relname as parent, pa.attname as pcol
        from pg_constraint k
        join pg_class cc on cc.oid = k.conrelid and cc.relname = t.tbl
        join pg_class pc on pc.oid = k.confrelid
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
        join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
       where k.contype = 'f' and array_length(k.conkey, 1) = 1
         and direct ? pc.relname
       order by pc.relname
    loop
      pred := concat_ws(' or ', pred,
        format('%I in (select %I from public.%I where %s)', fk.col, fk.pcol, fk.parent, direct ->> fk.parent));
    end loop;
    if pred is not null then direct := direct || jsonb_build_object(t.tbl, '(' || pred || ')');
    else skipped := skipped || t.tbl;
    end if;
  end loop;

  -- pass 3: read
  for t in select key as tbl, value #>> '{}' as pred from jsonb_each(direct) order by key loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*) from public.%I x where %s', t.tbl, t.pred) into rows, n;
    if n > 0 then
      out_tables := out_tables || jsonb_build_object(t.tbl, rows);
      counts := counts || jsonb_build_object(t.tbl, n);
    end if;
  end loop;

  return jsonb_build_object(
    'format', 'fsos-tenant-export/1',
    'exported_at', now(),
    'entity', jsonb_build_object('id', ent.id, 'slug', ent.slug, 'name', ent.name, 'legal_name', ent.legal_name),
    'restaurants', to_jsonb(rids), 'entity_codes', to_jsonb(codes),
    'counts', counts,
    'skipped_no_tenant_key', to_jsonb(skipped),
    'denied', to_jsonb(public._export_denylist()),
    'tables', out_tables);
end $$;
revoke all on function public.export_tenant_rows(uuid) from public, anon, authenticated;
grant execute on function public.export_tenant_rows(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3. Daily sweep, 04:20 UTC (after the Sunday backup at 04:00 — a copy of the
--    data as promised still exists for one week after anonymisation)
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from cron.job where jobname = 'retention-sweep-daily') then
    perform cron.unschedule('retention-sweep-daily');
  end if;
end $$;
select cron.schedule(
  'retention-sweep-daily',
  '20 4 * * *',
  $job$
  select net.http_post(
    url := 'https://rfdsysrdoncyoytcrzpg.supabase.co/functions/v1/retention-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets
                              where name = 'rgpd_secret')),
    body := '{"via":"pg_cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
