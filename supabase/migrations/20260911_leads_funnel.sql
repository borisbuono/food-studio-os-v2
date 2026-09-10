-- Sales funnel — leads + lead_touches
--
-- Overnight 2026-09-11 scaffolding. Boris asked for the OS-side plumbing to
-- land while the comm/design agent works up brand copy and the funnel visual
-- design in parallel. Schema, endpoints, admin board and content stub all
-- ship together; the brand agent fills the content stub tomorrow, and the
-- placeholder /leads/capture form gets swapped for the branded component
-- when the design lands.
--
-- Scope model matches the rest of the app: leads are keyed by entity_id
-- (the "which venue/holding gets the lead" cut). No hard FK to
-- public.entities because that table exists in prod but wasn't declared in
-- an in-repo migration (Phase 1 model add), so a REFERENCES clause here
-- would leave dev environments without the parent table failing on apply.
-- The column is UUID and the read paths join through entities.id as usual.
--
-- RLS: authenticated-all matches the guest_feedback pattern (20260711_guest_feedback).
-- Writes to /api/leads/capture route through the service-role client on the
-- server, exactly like /api/guest/book; the anon role never touches the table.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid,                     -- which venue/holding gets the lead (soft FK to public.entities.id)
  source text,                        -- 'website' | 'instagram' | 'referral' | 'walk-in' | 'inbound-email'
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_url text,
  referrer_url text,
  email text,
  phone text,
  name text,
  party_size int,
  intent text,                        -- 'booking' | 'event' | 'private-dining' | 'catering' | 'general'
  requested_date date,
  message text,
  state text not null default 'new',  -- 'new' | 'contacted' | 'qualified' | 'converted' | 'lost'
  state_history jsonb not null default '[]'::jsonb,
  assigned_to uuid,                   -- soft FK to auth.users.id
  converted_to_booking_id uuid,       -- soft FK to bookings.id when state='converted'
  lost_reason text,
  ip_hash text,                       -- for rate-limit accounting (never store raw IP)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_state_check
    check (state in ('new','contacted','qualified','converted','lost')),
  constraint leads_intent_check
    check (intent is null or intent in ('booking','event','private-dining','catering','general')),
  constraint leads_party_size_check
    check (party_size is null or (party_size between 1 and 200))
);

create index if not exists idx_leads_entity_state on public.leads(entity_id, state);
create index if not exists idx_leads_created on public.leads(created_at desc);
create index if not exists idx_leads_state on public.leads(state);
create index if not exists idx_leads_email on public.leads(lower(email));
create index if not exists idx_leads_ip_hash_recent
  on public.leads(ip_hash, created_at desc)
  where ip_hash is not null;

alter table public.leads enable row level security;
do $$ begin
  create policy leads_auth_all on public.leads
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public.lead_touches (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  touched_at timestamptz not null default now(),
  channel text,                       -- 'email' | 'whatsapp' | 'call' | 'in-person' | 'system'
  direction text,                     -- 'outbound' | 'inbound' | 'internal'
  notes text,
  by_user uuid,                       -- soft FK to auth.users.id
  constraint lead_touches_channel_check
    check (channel is null or channel in ('email','whatsapp','call','in-person','system')),
  constraint lead_touches_direction_check
    check (direction is null or direction in ('outbound','inbound','internal'))
);

create index if not exists idx_lead_touches_lead on public.lead_touches(lead_id, touched_at desc);
create index if not exists idx_lead_touches_recent on public.lead_touches(touched_at desc);

alter table public.lead_touches enable row level security;
do $$ begin
  create policy lead_touches_auth_all on public.lead_touches
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Touch updated_at on every leads update.
create or replace function public.leads_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_leads_touch_updated_at on public.leads;
create trigger trg_leads_touch_updated_at
  before update on public.leads
  for each row execute function public.leads_touch_updated_at();

comment on table public.leads is
  'Inbound sales/marketing leads across all venues. State machine: '
  'new -> contacted -> qualified -> converted/lost. Captured via '
  '/api/leads/capture (public, rate-limited, honeypot-guarded) and '
  'managed from /studio/growth. Wire from website forms once brand copy '
  'lands (content/funnel/config.ts).';

comment on table public.lead_touches is
  'Per-lead activity log. Every state change writes a system touch, and '
  'operators log outbound/inbound touches manually from /studio/growth.';
