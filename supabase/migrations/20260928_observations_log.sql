-- The observation log — Foundation §3 store 2 (BUILD SPEC 28-09-2026).
--
-- "No bar at all. One line. Append-only. Unstructured. Never read at session
-- open." This table is where every agent, and the Chef `remember` intent, put
-- the thing that struck them as slightly odd. Nothing acts on a single row.
-- The only reader is the weekly synthesis job (observations_synthesis_*),
-- which asks one question — "what pattern has formed that nobody has named
-- yet?" — and writes candidates to observation_patterns for a human tick.
--
-- CEO deviation from the spec (foundation §5 + rls_owner_scope 21-09): the
-- tenant key is entity_id uuid → entities, RLS-scoped like every tenant table.
-- entity_code (BM | IFL | BBH | UTOPIA …) is DERIVED by trigger from
-- entities.slug so agents can write by code exactly as the spec says; a write
-- may pass either column and the other is resolved. No CHECK on a code list.
--
-- Rules enforced HERE, not in prose:
--   • append-only: UPDATE may touch only synthesised_at / promoted_to
--     (trigger rejects anything else); DELETE has no policy and the privilege
--     is revoked for anon + authenticated — service role only (Chef undo ≤24h).
--   • staff data never (§5.5): a subject equal to a team member's or a
--     candidate's name for the same entity is refused. Best effort — a body
--     naming a person is not caught.
--   • never read at session open: nothing in the app shell, /api/ask context,
--     chef/now, predict.ts or the brief may query this table. Grep-asserted
--     in the ship note; there is no UI list page.

-- ---------------------------------------------------------------- code ⇄ id
-- Canonical code for an entity (mirrors _entity_keys(): taller → IFL,
-- holdings → BBH, else upper(slug)).
create or replace function public.entity_code_for(p_entity_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case e.slug when 'taller' then 'IFL' when 'holdings' then 'BBH' else upper(e.slug) end
    from public.entities e where e.id = p_entity_id;
$$;

create or replace function public.entity_id_for_code(p_code text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select e.id from public.entities e where upper(btrim(p_code)) = 'IFL' and e.slug = 'taller'),
    (select e.id from public.entities e where upper(btrim(p_code)) = 'BBH' and e.slug = 'holdings'),
    (select e.id from public.entities e where lower(e.slug) = lower(btrim(p_code))),
    public.resolve_entity(btrim(p_code)));
$$;
revoke all on function public.entity_code_for(uuid) from public, anon;
revoke all on function public.entity_id_for_code(text) from public, anon;
grant execute on function public.entity_code_for(uuid) to authenticated, service_role;
grant execute on function public.entity_id_for_code(text) to authenticated, service_role;

-- ---------------------------------------------------------------- table
create table if not exists public.observations (
  id             uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references public.entities(id),
  entity_code    text,                                   -- derived, never trusted from the writer
  observed_at    timestamptz not null default now(),
  body           text not null,                          -- one line, free text. No more fields, ever.
  domain         text,                                   -- finance|purchasing|comms|legal|hiring|menu|web|other (optional)
  source         text not null,                          -- agent / session name ('chef', 'ceo-harvest', 'purchasing-agent'…)
  subject        text,                                   -- optional supplier / counterparty / document
  synthesised_at timestamptz,                            -- stamped by the synthesis job; the ONLY mutable stamp #1
  promoted_to    uuid references public.master_todos(id) on delete set null,  -- set when a human accepts a pattern; stamp #2
  created_at     timestamptz not null default now()
);
comment on table public.observations is
  'Observation log (Foundation §3 store 2). One line, append-only, unstructured. NEVER read at session open — only by the weekly synthesis. Staff data never (§5.5): no line about an employee or a candidate. UPDATE only synthesised_at/promoted_to; DELETE service role only.';

create index if not exists observations_entity_time_idx  on public.observations (entity_id, observed_at desc);
create index if not exists observations_domain_time_idx  on public.observations (domain, observed_at desc);
create index if not exists observations_subject_idx      on public.observations (subject);
create index if not exists observations_unsynth_idx      on public.observations (synthesised_at) where synthesised_at is null;

-- ---------------------------------------------------------------- triggers
create or replace function public.observations_before_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_domains text[] := array['finance','purchasing','comms','legal','hiring','menu','web','other'];
begin
  -- Resolve the tenant from whichever key the writer gave.
  if new.entity_id is null and nullif(btrim(coalesce(new.entity_code,'')),'') is not null then
    new.entity_id := public.entity_id_for_code(new.entity_code);
  end if;
  if new.entity_id is null then
    raise exception 'observations: unknown entity (entity_code=%)', new.entity_code using errcode = '23503';
  end if;
  new.entity_code := public.entity_code_for(new.entity_id);
  if new.entity_code is null then
    raise exception 'observations: entity % does not exist', new.entity_id using errcode = '23503';
  end if;

  -- One line. Collapse whitespace and newlines; refuse an empty body.
  new.body := regexp_replace(btrim(coalesce(new.body,'')), '\s+', ' ', 'g');
  if new.body = '' then raise exception 'observations: body required' using errcode = '23514'; end if;
  new.source := nullif(btrim(coalesce(new.source,'')), '');
  if new.source is null then raise exception 'observations: source required' using errcode = '23514'; end if;
  new.subject := nullif(btrim(coalesce(new.subject,'')), '');
  new.domain := nullif(lower(btrim(coalesce(new.domain,''))), '');
  if new.domain is not null and not (new.domain = any(v_domains)) then new.domain := 'other'; end if;
  new.observed_at := coalesce(new.observed_at, now());
  new.synthesised_at := null;   -- a new line is by definition unsynthesised
  new.promoted_to := null;

  -- §5.5 staff data never — best effort on the subject column.
  if new.subject is not null and (
       exists (select 1 from public.team_members tm
                left join public.memberships m on m.person_id = tm.id
               where lower(btrim(tm.name)) = lower(new.subject)
                 and (m.entity_id = new.entity_id or tm.operator_entity_id = new.entity_id))
    or exists (select 1 from public.candidates c
               where c.entity_id = new.entity_id and lower(btrim(c.name)) = lower(new.subject))
  ) then
    raise exception 'observations: subject "%" is a team member or candidate — staff data is never an observation (Foundation §5.5)', new.subject
      using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function public.observations_before_update()
returns trigger language plpgsql as $$
begin
  if row(new.id, new.entity_id, new.entity_code, new.observed_at, new.body, new.domain, new.source, new.subject, new.created_at)
     is distinct from
     row(old.id, old.entity_id, old.entity_code, old.observed_at, old.body, old.domain, old.source, old.subject, old.created_at) then
    raise exception 'observations is append-only: only synthesised_at and promoted_to may change' using errcode = '55000';
  end if;
  return new;
end $$;

drop trigger if exists observations_bi on public.observations;
create trigger observations_bi before insert on public.observations
  for each row execute function public.observations_before_insert();
drop trigger if exists observations_bu on public.observations;
create trigger observations_bu before update on public.observations
  for each row execute function public.observations_before_update();

-- ---------------------------------------------------------------- RLS
alter table public.observations enable row level security;
drop policy if exists observations_select on public.observations;
create policy observations_select on public.observations for select to authenticated
  using (entity_id in (select public.app_my_scope_entities()));
drop policy if exists observations_insert on public.observations;
create policy observations_insert on public.observations for insert to authenticated
  with check (entity_id in (select public.app_my_scope_entities()));
drop policy if exists observations_stamp on public.observations;
create policy observations_stamp on public.observations for update to authenticated
  using (entity_id in (select public.app_my_scope_entities()))
  with check (entity_id in (select public.app_my_scope_entities()));
drop policy if exists observations_service_all on public.observations;
create policy observations_service_all on public.observations for all to service_role using (true) with check (true);
-- No DELETE policy for authenticated, and the privilege itself is gone.
revoke all on public.observations from anon;
revoke delete, truncate on public.observations from authenticated;
grant select, insert, update on public.observations to authenticated;
grant all on public.observations to service_role;

-- ---------------------------------------------------------------- RPC observe()
-- The one call. Works from the Supabase MCP (lab agents) and from the app
-- (SECURITY INVOKER, RLS applies). Returns the new row id.
create or replace function public.observe(
  p_entity_code text, p_body text, p_source text, p_domain text default null, p_subject text default null)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into public.observations (entity_code, body, source, domain, subject)
  values (p_entity_code, p_body, p_source, p_domain, p_subject)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.observe(text,text,text,text,text) from public, anon;
grant execute on function public.observe(text,text,text,text,text) to authenticated, service_role;
comment on function public.observe(text,text,text,text,text) is
  'Append one line to the observation log. observe(''BM'', ''what struck you as odd'', ''<agent name>'', domain?, subject?) → id. Never read this table at session open.';

-- ---------------------------------------------------------------- Chef undo (the one sanctioned delete)
-- /api/chef/act undo prefers the service role; when the key is not set on
-- Vercel this definer RPC does the same thing under the same rule: the caller
-- must hold an unused, unexpired chef_undo token for exactly this row.
create or replace function public.observation_chef_undo(p_token uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row uuid;
begin
  select u.row_id into v_row from public.chef_undo u
   where u.token = p_token and u.user_id = auth.uid() and u.table_name = 'observations'
     and u.used_at is null and u.expires_at > now();
  if v_row is null then return false; end if;
  delete from public.observations where id = v_row and synthesised_at is null;
  if not found then return false; end if;
  update public.chef_undo set used_at = now() where token = p_token;
  return true;
end $$;
revoke all on function public.observation_chef_undo(uuid) from public, anon;
grant execute on function public.observation_chef_undo(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- patterns
create table if not exists public.observation_patterns (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references public.entities(id),
  entity_code     text,
  pattern         text not null,
  evidence_ids    uuid[] not null default '{}',
  proposed_target text not null check (proposed_target in ('register','counterparty_note','decision')),
  status          text not null default 'proposed' check (status in ('proposed','accepted','dismissed')),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid,
  promoted_to     uuid references public.master_todos(id) on delete set null,
  run_id          uuid
);
comment on table public.observation_patterns is
  'Candidates from the weekly observation synthesis. status=proposed until a human accepts (→ master_todos row, observations.promoted_to) or dismisses. Never written by hand.';
create index if not exists observation_patterns_status_idx on public.observation_patterns (status, created_at desc);
create index if not exists observation_patterns_entity_idx on public.observation_patterns (entity_id, created_at desc);

alter table public.observation_patterns enable row level security;
drop policy if exists observation_patterns_select on public.observation_patterns;
create policy observation_patterns_select on public.observation_patterns for select to authenticated
  using (entity_id in (select public.app_my_scope_entities()));
drop policy if exists observation_patterns_decide on public.observation_patterns;
create policy observation_patterns_decide on public.observation_patterns for update to authenticated
  using (entity_id in (select public.app_my_managed_entities()))
  with check (entity_id in (select public.app_my_managed_entities()));
drop policy if exists observation_patterns_service_all on public.observation_patterns;
create policy observation_patterns_service_all on public.observation_patterns for all to service_role using (true) with check (true);
revoke all on public.observation_patterns from anon;
revoke insert, delete, truncate on public.observation_patterns from authenticated;
grant select, update on public.observation_patterns to authenticated;
grant all on public.observation_patterns to service_role;

-- Human tick: accept → master_todos row + promoted_to on every evidence line.
create or replace function public.observation_pattern_accept(p_id uuid)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare p record; v_todo uuid;
begin
  select * into p from public.observation_patterns where id = p_id and status = 'proposed' for update;
  if p.id is null then raise exception 'pattern not found or already decided' using errcode = 'P0002'; end if;
  insert into public.master_todos (entity_code, title, source, status, priority, impact_score, created_by_user_id, context)
  values (p.entity_code, left(p.pattern, 500), 'observation_synthesis', 'pending', 3, 3, auth.uid(),
          jsonb_build_object('pattern_id', p.id, 'proposed_target', p.proposed_target, 'evidence_ids', to_jsonb(p.evidence_ids)))
  returning id into v_todo;
  update public.observations set promoted_to = v_todo where id = any(p.evidence_ids);
  update public.observation_patterns set status = 'accepted', decided_at = now(), decided_by = auth.uid(), promoted_to = v_todo where id = p_id;
  return v_todo;
end $$;
create or replace function public.observation_pattern_dismiss(p_id uuid)
returns boolean language sql security invoker set search_path = public, pg_temp as $$
  update public.observation_patterns set status = 'dismissed', decided_at = now(), decided_by = auth.uid()
   where id = p_id and status = 'proposed' returning true;
$$;
revoke all on function public.observation_pattern_accept(uuid) from public, anon;
revoke all on function public.observation_pattern_dismiss(uuid) from public, anon;
grant execute on function public.observation_pattern_accept(uuid) to authenticated, service_role;
grant execute on function public.observation_pattern_dismiss(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- synthesis plumbing
-- The weekly job runs on Vercel with no session and (today) no service key,
-- so it authenticates to Postgres the way the Meta inbox puller does: a
-- Vault secret sent by pg_cron as x-scheduler-secret, checked by definer
-- RPCs. pull = ALL unsynthesised rows in ONE query; commit = write the
-- candidates and stamp every row that was read. Never writes master_todos.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'observations_synthesis_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'observations_synthesis_secret',
      'x-scheduler-secret for /api/cron/observations-synthesis (pg_cron → Vercel)');
  end if;
end $$;

create or replace function public.observations_synthesis_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = public, vault, pg_temp as $$
  select p_secret is not null and length(p_secret) > 16 and exists (
    select 1 from vault.decrypted_secrets where name = 'observations_synthesis_secret' and decrypted_secret = p_secret);
$$;

create or replace function public.observations_synthesis_pull(p_secret text)
returns setof public.observations language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.observations_synthesis_secret_ok(p_secret) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select * from public.observations where synthesised_at is null order by entity_code, observed_at;
end $$;

-- p_patterns: [{entity_code|entity_id, pattern, evidence_ids[], proposed_target}]
create or replace function public.observations_synthesis_commit(p_secret text, p_read_ids uuid[], p_patterns jsonb, p_run_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int := 0; v_stamped int := 0; x jsonb; v_eid uuid; v_ev uuid[];
begin
  if not public.observations_synthesis_secret_ok(p_secret) then raise exception 'forbidden' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_patterns, '[]'::jsonb)) loop
    v_eid := coalesce(nullif(x->>'entity_id','')::uuid, public.entity_id_for_code(x->>'entity_code'));
    if v_eid is null or nullif(btrim(coalesce(x->>'pattern','')),'') is null then continue; end if;
    select coalesce(array_agg(e::uuid), '{}') into v_ev from jsonb_array_elements_text(coalesce(x->'evidence_ids','[]'::jsonb)) e
     where e ~* '^[0-9a-f-]{36}$' and e::uuid = any(p_read_ids);
    insert into public.observation_patterns (entity_id, entity_code, pattern, evidence_ids, proposed_target, run_id)
    values (v_eid, public.entity_code_for(v_eid), regexp_replace(btrim(x->>'pattern'), '\s+', ' ', 'g'), v_ev,
            case when x->>'proposed_target' in ('register','counterparty_note','decision') then x->>'proposed_target' else 'decision' end,
            p_run_id);
    v_n := v_n + 1;
  end loop;
  update public.observations set synthesised_at = now() where id = any(p_read_ids) and synthesised_at is null;
  get diagnostics v_stamped = row_count;
  return jsonb_build_object('patterns', v_n, 'stamped', v_stamped, 'run_id', p_run_id);
end $$;
revoke all on function public.observations_synthesis_secret_ok(text) from public;
revoke all on function public.observations_synthesis_pull(text) from public;
revoke all on function public.observations_synthesis_commit(text,uuid[],jsonb,uuid) from public;
-- The route reaches these with the cookie-less (anon) client; the secret is the gate.
grant execute on function public.observations_synthesis_secret_ok(text) to anon, authenticated, service_role;
grant execute on function public.observations_synthesis_pull(text) to anon, authenticated, service_role;
grant execute on function public.observations_synthesis_commit(text,uuid[],jsonb,uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- pg_cron (weekly, Monday 05:30 UTC)
-- Vercel Hobby cron slots are full (finance nightly-scan, pos-nightly) — same
-- trigger model as social-inbox-pull.
select cron.unschedule(jobid) from cron.job where jobname = 'observations-synthesis';
select cron.schedule('observations-synthesis', '30 5 * * 1', $$
  select net.http_post(
    url := 'https://www.foodstudio.ai/api/cron/observations-synthesis',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets
                              where name = 'observations_synthesis_secret')),
    body := '{"via":"pg_cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);
