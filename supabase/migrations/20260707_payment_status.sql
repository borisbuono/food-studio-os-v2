-- Payment tile #1 — schema + seed known billing states
-- Boris's card is failing silently across Wix, Meta Ads (BM disabled since Apr 4),
-- Holded (retry loop since Jun 13), Google Workspace (chronic decline across 4 card
-- rotations). None of it was surfaced. This is the substrate for the tile that would
-- have caught it. See memory/payment_method_rotation_needed.md and
-- 02_Build/decisions/marketing_invoice_map_2026-07-05.md.

do $$ begin
  create type public.payment_state as enum ('healthy','at_risk','failing','disabled','missing_card');
exception when duplicate_object then null; end $$;

create table if not exists public.platform_billing_status (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null check (entity_code in ('IFL','BM','BBH')),
  -- platform slug matches vendor names in lib/integrations/registry.ts where applicable
  -- (holded, apideck, stripe, fresto...) plus non-registry SaaS (google-workspace, wix, meta-ads)
  platform text not null,
  state public.payment_state not null default 'healthy',
  card_last4 text,
  next_charge_date date,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count_30d int not null default 0,
  billing_url text,
  notes text,
  updated_at timestamptz not null default now(),
  unique (entity_code, platform)
);

create index if not exists idx_pbs_state on public.platform_billing_status (state);
create index if not exists idx_pbs_entity on public.platform_billing_status (entity_code);

alter table public.platform_billing_status enable row level security;

do $$ begin
  create policy pbs_auth_read on public.platform_billing_status
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- Only the service role writes. Manual UI updates go via the API route
-- /api/finance/payment-status/sync which uses the service key server-side.
do $$ begin
  create policy pbs_service_write on public.platform_billing_status
    for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Seed the known state as of 2026-07-07 --------------------------------------
-- IFL / google-workspace: at_risk, chronic decline since Sept 2025 across 4 cards.
-- Boris paid €154 catch-up on 2026-06-10 (Mastercard 2134); July invoice already
-- issued 2026-07-02 and will fail. AI Expanded Access add-on also degraded.
insert into public.platform_billing_status
  (entity_code, platform, state, card_last4, next_charge_date, last_success_at, last_failure_at, failure_count_30d, billing_url, notes)
values
  ('IFL','google-workspace','at_risk','2134','2026-08-01','2026-06-10T00:00:00Z','2026-06-03T00:00:00Z',7,
   'https://admin.google.com/ac/billing',
   'Chronic decline every ~month since Sept 2025 across 4 cards (5556 → 5049 → 6693 → 2134). €154 catch-up 2026-06-10. AI add-on suspended 2026-06-04. July invoice issued 2026-07-02, will re-fail.'),

  -- BM / wix-newsletter: failing since 2026-05-18, 14 retry attempts. Same €35.09
  -- coincidence as Holded. Site + Email Marketing at risk before we build against them.
  ('BM','wix-newsletter','failing','2134','2026-07-08','2026-05-14T00:00:00Z','2026-06-26T00:00:00Z',12,
   'https://manage.wix.com/premium-purchase-plan/checkout',
   'Wix Core app retry loop since 2026-05-18. €35.09/mo failing every ~3-4 days. 14+ retry emails. Domain bistro-mondo.com renewed 2026-04-26 (assumed paid).'),

  -- BM / meta-ads: fully DISABLED since 2026-04-04. Account 605781129956113.
  -- Meta scraped €30.21 in split micro-payments Apr 4-6 before giving up. Zero campaigns
  -- running because Meta shut it, not because none were planned.
  ('BM','meta-ads','disabled','2134','2026-04-04','2026-03-16T00:00:00Z','2026-04-06T09:38:00Z',0,
   'https://business.facebook.com/billing_hub/accounts/details/?asset_id=605781129956113',
   'Ad account 605781129956113 DISABLED 2026-04-04. Meta scraped €30.21 in split micropayments over 30h Apr 4-6 then gave up. €30.21 outstanding — pay + reactivate, or open new account under BM SL.'),

  -- IFL / holded: retry loop since 2026-06-13. Same card, same amount as Wix.
  -- Losing Holded would cost the accounting substrate for all 3 entities.
  ('IFL','holded','at_risk','2134','2026-07-13','2026-05-13T00:00:00Z','2026-06-22T10:46:00Z',8,
   'https://app.holded.com/account/subscription',
   'Retry loop since 2026-06-13. 5 failure emails in 5 minutes on 2026-06-22 = aggressive retry. Same Mastercard 2134, same €35.09/mo as Wix. Accounting substrate for all 3 entities — losing this is catastrophic.'),

  -- IFL / apideck: healthy, trial signed up 2026-07-04 (29 days left as of today).
  ('IFL','apideck','healthy',null,'2026-08-03',null,null,0,
   'https://platform.apideck.com/billing',
   'Free trial signed up 2026-07-04. 29 days left. No card on file yet — needs card before trial expires or accounting substrate reverts to Holded direct.'),

  -- BBH: no card issued yet — every platform is technically missing_card.
  -- Track one row per BBH-scoped platform so the tile surfaces the gap.
  ('BBH','holded','missing_card',null,null,null,null,0,
   'https://app.holded.com/account/subscription',
   'BBH has no card issued yet — needs a 5720xxxx PGC line per entity_card_setup memory. Holded BBH subscription is billed to Boris personally.'),
  ('BBH','google-workspace','missing_card',null,null,null,null,0,
   'https://admin.google.com/ac/billing',
   'BBH has no card issued yet. Google Workspace charges bleed onto ibzfoodstudio.com (IFL profile) so BBH share is untracked.'),
  ('BBH','apideck','missing_card',null,null,null,null,0,
   'https://platform.apideck.com/billing',
   'BBH has no card issued yet. Apideck trial covers IFL only today.')
on conflict (entity_code, platform) do nothing;
