-- Day 8: onboarding funnel — invite roster fields + first-run tracking
alter table public.team_members add column if not exists phone text;
alter table public.profiles add column if not exists gdpr_accepted_at timestamptz;
alter table public.profiles add column if not exists first_run_done_at timestamptz;

-- Signed-in users may add to the invite roster (manager-gated in the UI; RLS gate = authenticated)
do $$ begin
  create policy team_members_auth_insert on public.team_members
    for insert to authenticated with check (true);
exception when duplicate_object then null; end $$;

-- A user may update their own profile row (name, gdpr, first-run marks)
do $$ begin
  create policy profiles_self_update on public.profiles
    for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
exception when duplicate_object then null; end $$;
