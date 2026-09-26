-- Chef v3 slice A — server-side confirmation gate
-- (06_PA/_INBOX/TO_BORIS_chef_architecture_check_2026-09-26.md, rework A).
--
-- Before: `needs_confirm` was decided in the router and enforced ONLY in the
-- browser (ChefRoot.openConfirm → onYes). A direct POST /api/chef/act
-- {type:"run_agent"|"approve_reply"} from any signed-in session executed at
-- once. Now /api/ask mints a one-shot token bound to user + turn + action
-- hash whenever a turn needs confirmation; /api/chef/act requires and
-- consumes it for the outbound class and writes chef_turns.resolution itself.
--
-- Own rows only. The route code is the only writer; a user can see their own
-- tokens (harmless — the token is theirs anyway) but cannot forge one for a
-- different action: the hash is checked server-side on consume.

create table if not exists public.chef_confirm_tokens (
  token        uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  turn_id      uuid references public.chef_turns(id) on delete set null,
  action_type  text not null,
  action_hash  text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '10 minutes',
  used_at      timestamptz,
  used_via     text check (used_via in ('tap','voice','page_tick','mint'))
);
create index if not exists chef_confirm_tokens_user_idx on public.chef_confirm_tokens (user_id, created_at desc);
create index if not exists chef_confirm_tokens_turn_idx on public.chef_confirm_tokens (turn_id);

alter table public.chef_confirm_tokens enable row level security;

drop policy if exists chef_confirm_tokens_own_select on public.chef_confirm_tokens;
create policy chef_confirm_tokens_own_select on public.chef_confirm_tokens
  for select to authenticated using (user_id = auth.uid());
drop policy if exists chef_confirm_tokens_own_insert on public.chef_confirm_tokens;
create policy chef_confirm_tokens_own_insert on public.chef_confirm_tokens
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists chef_confirm_tokens_own_update on public.chef_confirm_tokens;
create policy chef_confirm_tokens_own_update on public.chef_confirm_tokens
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists chef_confirm_tokens_service_all on public.chef_confirm_tokens;
create policy chef_confirm_tokens_service_all on public.chef_confirm_tokens
  for all to service_role using (true) with check (true);

revoke all on public.chef_confirm_tokens from anon;
grant select, insert, update on public.chef_confirm_tokens to authenticated;
grant all on public.chef_confirm_tokens to service_role;

comment on table public.chef_confirm_tokens is
  'One-shot confirmation tokens minted by /api/ask (or /api/chef/confirm) for needs_confirm turns; consumed by /api/chef/act. 10-min TTL, bound to user + turn + sha256(action).';
