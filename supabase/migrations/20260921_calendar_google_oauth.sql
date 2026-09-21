-- calendar: _google_oauth — read-only Google Calendar overlay (2026-09-21)
-- One row per team member who connected Google. The refresh token never
-- leaves the DB through a table read: authenticated has no SELECT on the
-- token columns; only definer RPCs scoped to the caller's own person_id
-- (and service_role) can read it.

create table if not exists public.google_calendar_tokens (
  person_id uuid primary key references public.team_members(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  access_token text,
  access_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text
);
alter table public.google_calendar_tokens enable row level security;
revoke all on public.google_calendar_tokens from anon, authenticated;
grant select (person_id, google_email, scopes, connected_at, last_synced_at, last_error)
  on public.google_calendar_tokens to authenticated;
drop policy if exists gcal_tokens_own on public.google_calendar_tokens;
create policy gcal_tokens_own on public.google_calendar_tokens for select to authenticated
  using (auth_user_id = auth.uid());

-- store / replace my tokens (called by the OAuth callback as the signed-in user)
create or replace function public.gcal_save_tokens(p_refresh text, p_access text, p_expires timestamptz,
  p_scopes text[], p_email text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid;
begin
  select id into pid from public.team_members where auth_user_id = auth.uid() order by created_at limit 1;
  if pid is null then raise exception 'no team member for this user' using errcode = '42501'; end if;
  insert into public.google_calendar_tokens (person_id, auth_user_id, google_email, refresh_token, access_token,
                                            access_expires_at, scopes, connected_at, last_error)
  values (pid, auth.uid(), p_email, p_refresh, p_access, p_expires, coalesce(p_scopes,'{}'), now(), null)
  on conflict (person_id) do update set
    auth_user_id = excluded.auth_user_id, google_email = excluded.google_email,
    refresh_token = coalesce(nullif(excluded.refresh_token,''), google_calendar_tokens.refresh_token),
    access_token = excluded.access_token, access_expires_at = excluded.access_expires_at,
    scopes = excluded.scopes, connected_at = now(), last_error = null;
  return pid;
end $$;

-- my tokens, for the on-demand sync route running as me
create or replace function public.gcal_my_tokens() returns table(person_id uuid, refresh_token text,
  access_token text, access_expires_at timestamptz, last_synced_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.person_id, g.refresh_token, g.access_token, g.access_expires_at, g.last_synced_at
    from public.google_calendar_tokens g where g.auth_user_id = auth.uid();
$$;

-- replace my external rows in a window with a fresh pull.
-- p_events: [{id, title, start, end, all_day, location}]
create or replace function public.gcal_replace_external(p_person uuid, p_from timestamptz, p_to timestamptz,
  p_events jsonb, p_access text default null, p_expires timestamptz default null, p_error text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; is_service boolean := coalesce(auth.role(),'') = 'service_role';
begin
  if not is_service and not exists (select 1 from public.team_members where id = p_person and auth_user_id = auth.uid()) then
    raise exception 'not your calendar' using errcode = '42501';
  end if;
  update public.google_calendar_tokens set
    access_token = coalesce(p_access, access_token), access_expires_at = coalesce(p_expires, access_expires_at),
    last_synced_at = case when p_error is null then now() else last_synced_at end, last_error = p_error
   where person_id = p_person;
  if p_error is not null or p_events is null then return 0; end if;
  delete from public.events
   where source_type = 'external' and person_ids = array[p_person]
     and start_ts < p_to and coalesce(end_ts, start_ts) >= p_from;
  insert into public.events (source_type, source_id, entity_id, title, start_ts, end_ts, all_day, location,
                             person_ids, external_ref, colour, status, created_by)
  select 'external', null, null, left(coalesce(nullif(x->>'title',''), 'Busy'), 200),
         (x->>'start')::timestamptz, nullif(x->>'end','')::timestamptz, coalesce((x->>'all_day')::boolean, false),
         left(x->>'location', 200), array[p_person], 'gcal:' || p_person || ':' || (x->>'id'), '#9AA3AB', 'busy',
         (select auth_user_id from public.team_members where id = p_person)
    from jsonb_array_elements(p_events) x
   where x->>'id' is not null and x->>'start' is not null
  on conflict (external_ref) where external_ref is not null do update set
    title = excluded.title, start_ts = excluded.start_ts, end_ts = excluded.end_ts,
    all_day = excluded.all_day, location = excluded.location;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.gcal_disconnect() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.events e using public.team_members t
   where e.source_type = 'external' and t.auth_user_id = auth.uid() and e.person_ids = array[t.id];
  delete from public.google_calendar_tokens where auth_user_id = auth.uid();
$$;

revoke all on function public.gcal_save_tokens(text,text,timestamptz,text[],text) from public, anon;
revoke all on function public.gcal_my_tokens() from public, anon;
revoke all on function public.gcal_replace_external(uuid,timestamptz,timestamptz,jsonb,text,timestamptz,text) from public, anon;
revoke all on function public.gcal_disconnect() from public, anon;
grant execute on function public.gcal_save_tokens(text,text,timestamptz,text[],text) to authenticated;
grant execute on function public.gcal_my_tokens() to authenticated;
grant execute on function public.gcal_replace_external(uuid,timestamptz,timestamptz,jsonb,text,timestamptz,text) to authenticated, service_role;
grant execute on function public.gcal_disconnect() to authenticated;
