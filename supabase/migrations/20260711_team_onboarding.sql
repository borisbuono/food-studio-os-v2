-- Team Onboarding Wizard — schema for magic-link invitations, per-user
-- onboarding step tracking, and signed acknowledgment documents.
--
-- Pattern echoes:
--   - existing team_members roster (kept as the "invited from the admin UI"
--     shortcut). team_invitations is the fuller, signed-token flow — everything
--     needed to hand a new hire a URL they can open on their own phone.
--   - guest self-service token pattern: gen_random_uuid() token, expires_at,
--     accepted_at/revoked_at markers, RLS anon-select on the token row so the
--     landing page can be reached without a signed-in session.
--
-- Additive. Existing team_members flow keeps working; the new tables live
-- alongside and are wired to a new /administrate/team/onboard/new wizard.

-- ---------- team_invitations ----------
create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,                    -- BM | IFL | BBH | ADV-<slug>
  restaurant_id uuid,                           -- specific venue (nullable for holdings roles)
  invited_email text not null,
  invited_name text,
  invited_phone text,
  invited_by_user_id uuid,                      -- soft FK to auth.users
  role text not null,                           -- owner|manager|chef|foh|pastry|porter|host|other
  starting_date date,
  language text default 'es',                   -- inherited on the /team/join landing
  magic_link_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  expires_at timestamptz not null default (now() + interval '30 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_inv_entity_check check (entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%'),
  constraint team_inv_role_check check (role in ('owner','manager','chef','foh','pastry','porter','host','other'))
);
create index if not exists idx_team_inv_email      on public.team_invitations(invited_email);
create index if not exists idx_team_inv_entity     on public.team_invitations(entity_code, created_at desc);
create index if not exists idx_team_inv_pending    on public.team_invitations(accepted_at) where accepted_at is null and revoked_at is null;

alter table public.team_invitations enable row level security;
-- Signed-in staff can create + read invitations (manager-gated in the UI).
do $$ begin
  create policy team_inv_auth_all on public.team_invitations
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
-- Anon read matches guest self-service: the /team/join page reads by the exact
-- token before sign-in. RLS gates rows to live invitations only; the app
-- filters by token on top of that.
do $$ begin
  create policy team_inv_anon_by_token on public.team_invitations
    for select to anon using (revoked_at is null and expires_at > now());
exception when duplicate_object then null; end $$;

create or replace function public.team_invitations_touch_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;
drop trigger if exists trg_team_inv_touch on public.team_invitations;
create trigger trg_team_inv_touch before update on public.team_invitations
  for each row execute function public.team_invitations_touch_updated_at();

-- ---------- onboarding_steps ----------
-- One row per (user_id, step_key). Written as steps land. First-week checklist,
-- training progress, first-shift observations all rendezvous here.
create table if not exists public.onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,                        -- profiles.id / auth.users.id
  entity_code text not null,
  step_key text not null,
  done_at timestamptz,
  notes text,
  observer_user_id uuid,                        -- manager / buddy who marked it
  created_at timestamptz not null default now(),
  constraint onb_steps_entity_check check (entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%'),
  constraint onb_steps_key_check check (step_key in (
    'profile_completed',
    'photo_uploaded',
    'documents_signed',
    'system_walked',
    'first_shift_scheduled',
    'first_meal_briefed',
    'team_introduced',
    'pos_trained',
    'clock_in_configured',
    'buddy_assigned',
    'first_solo_shift',
    'week_review_meeting'
  )),
  constraint onb_steps_uniq unique (user_id, step_key)
);
create index if not exists idx_onb_steps_user   on public.onboarding_steps(user_id);
create index if not exists idx_onb_steps_entity on public.onboarding_steps(entity_code, done_at desc);

alter table public.onboarding_steps enable row level security;
do $$ begin
  create policy onb_steps_auth_all on public.onboarding_steps
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ---------- onboarding_documents ----------
create table if not exists public.onboarding_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  entity_code text,
  doc_type text not null,                       -- contract|id|handbook_ack|food_safety_ack|gdpr_ack
  doc_url text,                                 -- optional pointer to Drive / Storage
  signed_at timestamptz,
  signature_name text,                          -- typed-name signature capture
  ip_address text,                              -- lightweight audit
  created_at timestamptz not null default now(),
  constraint onb_docs_type_check check (doc_type in ('contract','id','handbook_ack','food_safety_ack','gdpr_ack'))
);
create index if not exists idx_onb_docs_user on public.onboarding_documents(user_id);
create index if not exists idx_onb_docs_uniq on public.onboarding_documents(user_id, doc_type);

alter table public.onboarding_documents enable row level security;
do $$ begin
  create policy onb_docs_auth_all on public.onboarding_documents
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
-- Anon writes go through server routes (/api/team/join) so they can validate
-- the invitation token before insert. Keep direct anon writes locked.

comment on table public.team_invitations is 'Magic-link invitations for new team members. /team/join?token=... reads by token (anon select).';
comment on table public.onboarding_steps is 'Per-user onboarding progress. One row per (user, step_key). Manager checklists + training + first-shift all write here.';
comment on table public.onboarding_documents is 'Signed acknowledgments (handbook, food safety, GDPR) + optional contract/id uploads captured during /team/join.';
