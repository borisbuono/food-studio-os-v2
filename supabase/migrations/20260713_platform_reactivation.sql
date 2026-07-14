-- Social Workstream Sprint 3 — platform reactivation state.
--
-- BM's Meta ad account (605781129956113) has been DISABLED since 2026-04-04
-- for payment method failure (memo: payment_method_rotation_needed). The
-- Reach · Ads surface (added in the same sprint) walks Boris through a
-- checklist to reactivate — this table backs each checkbox so the state
-- survives page reloads and can be summarised into the Chef FAB context.
--
-- Shape: one row per (entity, platform, step_key). No enum on step_key so
-- we can add more steps without a migration. `platform` covers meta-ads,
-- google-ads, tiktok-ads etc.

create table if not exists public.platform_reactivation_state (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null,
  platform text not null,
  step_key text not null,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pr_state_entity_check   check (entity_code in ('IFL','BM','BBH') or entity_code like 'ADV-%'),
  constraint pr_state_unique unique (entity_code, platform, step_key)
);
create index if not exists idx_pr_state_entity_platform on public.platform_reactivation_state(entity_code, platform);

alter table public.platform_reactivation_state enable row level security;
do $$ begin
  create policy pr_state_auth_all on public.platform_reactivation_state
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create or replace function public.pr_state_touch_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;
drop trigger if exists trg_pr_state_touch on public.platform_reactivation_state;
create trigger trg_pr_state_touch before update on public.platform_reactivation_state
  for each row execute function public.pr_state_touch_updated_at();

comment on table public.platform_reactivation_state is 'Per-step reactivation checklist for a disabled ad / marketing account. BM · meta-ads is the launch case (disabled 2026-04-04, payment method failed).';
