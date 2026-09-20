-- Runway D1 — self-serve /onboard flow.
--
-- Adds country / VAT / timezone / fiscal profile to entities so an operator
-- can spin up a new house in any country. First customer: an Amsterdam
-- venue (NL / Europe/Amsterdam / KVK). Existing ES rows keep defaults.
-- Also adds profiles.onboarding_state so the wizard survives a refresh,
-- and a pending_invites table for the team-invite email flow.

alter table public.entities
  add column if not exists country_code text default 'ES',
  add column if not exists currency_code text default 'EUR',
  add column if not exists vat_regime jsonb,
  add column if not exists fiscal_year_end text default '12-31',
  add column if not exists timezone text default 'Europe/Madrid',
  add column if not exists tax_id text,
  add column if not exists address_line1 text,
  add column if not exists postal_code text,
  add column if not exists website_url text,
  add column if not exists onboarded_at timestamptz,
  add column if not exists onboarded_by uuid references auth.users(id);

-- legal_name and city already exist on entities; do not re-add.

-- Backfill country_code from legacy `country` where present so downstream
-- helpers can key off country_code uniformly.
update public.entities
   set country_code = upper(left(coalesce(country_code, country, 'ES'), 2))
 where country_code is null or length(country_code) <> 2;

-- Seed Spain VAT regime for existing ES rows that don't have one yet.
update public.entities
   set vat_regime = '{"standard":21,"reduced_food":10,"zero":0}'::jsonb
 where vat_regime is null and coalesce(country_code, 'ES') = 'ES';

-- onboarding_state on profiles keeps step-by-step wizard progress so a
-- browser refresh doesn't drop the operator back to step 1.
alter table public.profiles
  add column if not exists onboarding_state jsonb;

-- pending_invites — team invite tokens issued by /api/team/invite.
-- Redeemed on the invited email's magic-link callback.
create table if not exists public.pending_invites (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  email text not null,
  role text not null,
  token text not null unique,
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id)
);

create index if not exists pending_invites_entity_idx on public.pending_invites (entity_id);
create index if not exists pending_invites_email_idx  on public.pending_invites (lower(email));
create index if not exists pending_invites_token_idx  on public.pending_invites (token);

alter table public.pending_invites enable row level security;

drop policy if exists pending_invites_select on public.pending_invites;
create policy pending_invites_select on public.pending_invites
  for select to authenticated
  using (
    invited_by = auth.uid()
    or lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  );

drop policy if exists pending_invites_insert on public.pending_invites;
create policy pending_invites_insert on public.pending_invites
  for insert to authenticated
  with check (invited_by = auth.uid());

drop policy if exists pending_invites_update on public.pending_invites;
create policy pending_invites_update on public.pending_invites
  for update to authenticated
  using (
    invited_by = auth.uid()
    or lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  )
  with check (
    invited_by = auth.uid()
    or lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  );
