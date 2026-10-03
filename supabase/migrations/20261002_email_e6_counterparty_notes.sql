-- Email channel — E6: the one-line note on a counterparty, read by the drafter.
--
-- Two kinds of counterparty: suppliers (public.providers — `notes text` ALREADY
-- exists on prod; nothing changed on that table, no policy touched: the
-- sec/hardening builder owns providers' policies) and clients (new table
-- public.clients, this migration). One view joins them by e-mail address so
-- lib/email/draft.ts asks ONE question before drafting: "what do we know about
-- the person who wrote this?"
--
-- Additive only.

-- providers: column only. Idempotent; prod already has it.
alter table public.providers add column if not exists notes text;
comment on column public.providers.notes is 'One line the drafter reads before answering this supplier (E6). Plain text, human-written.';

-- clients: the people and companies who book, enquire, hire us.
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  name text,
  email text,
  phone text,
  company text,
  kind text not null default 'guest' check (kind in ('guest','company','agency','planner','partner','other')),
  notes text,                         -- ONE line the drafter reads before answering
  lead_id uuid references public.leads(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clients_entity_email_uidx on public.clients (entity_id, lower(email)) where email is not null;
create index if not exists clients_entity_idx on public.clients (entity_id, updated_at desc);
create or replace function public.clients_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_clients_touch on public.clients;
create trigger trg_clients_touch before update on public.clients for each row execute function public.clients_touch();

alter table public.clients enable row level security;
revoke all on public.clients from anon;
drop policy if exists rls35_clients_select on public.clients;
drop policy if exists rls35_clients_insert on public.clients;
drop policy if exists rls35_clients_update on public.clients;
drop policy if exists rls35_clients_delete on public.clients;
create policy rls35_clients_select on public.clients for select to authenticated
  using (entity_id in (select public.current_person_entities()));
create policy rls35_clients_insert on public.clients for insert to authenticated
  with check (entity_id in (select public.app_my_managed_entities()));
create policy rls35_clients_update on public.clients for update to authenticated
  using (entity_id in (select public.app_my_managed_entities()))
  with check (entity_id in (select public.app_my_managed_entities()));
create policy rls35_clients_delete on public.clients for delete to authenticated
  using (entity_id in (select public.app_my_managed_entities()));
grant select, insert, update, delete on public.clients to authenticated;
comment on table public.clients is 'Counterparties on the sales side (E6). notes = the one line the email drafter reads. RLS rls35: members read, managers write.';

-- the drafter's one question, by address. security_invoker → each half obeys
-- its own table''s RLS (providers: member read; clients: rls35).
-- providers has no entity_id today (suppliers are shared across houses): its
-- rows come back with entity_id null; the drafter asks for "mine or shared".
create or replace view public.email_counterparties
with (security_invoker = true) as
select c.entity_id, lower(c.email) as address, c.name, c.kind, c.notes, 'client'::text as side, c.id as row_id
  from public.clients c where c.email is not null and c.notes is not null and btrim(c.notes) <> ''
union all
select null::uuid, lower(p.email), p.name, 'supplier'::text, p.notes, 'provider'::text, p.id
  from public.providers p where p.email is not null and p.notes is not null and btrim(p.notes) <> '';
grant select on public.email_counterparties to authenticated;
comment on view public.email_counterparties is 'E6: one-line notes on senders, by address. Read by lib/email/draft.ts before every draft. Clients carry entity_id; providers (shared) null.';
-- the view is security_invoker (anon would get 0 rows via RLS anyway) — keep anon off it outright
revoke all on public.email_counterparties from anon, public;
grant select on public.email_counterparties to authenticated;
