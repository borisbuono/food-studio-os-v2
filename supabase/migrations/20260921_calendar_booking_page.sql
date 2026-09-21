-- calendar: _booking_page — Cal.com-style public page /book/<slug> (2026-09-21)
-- booking_profiles: one per team member who takes bookings. Anon never reads
-- tables; three definer RPCs do the work:
--   booking_page_info(slug)                 -> public card (first name, venue, hours, slot, tz)
--   booking_busy(slug, from, to)            -> busy intervals ONLY (no titles)
--   booking_create(slug, start, name, …)    -> re-validates hours/notice/overlap, rate-capped
--     (returns host_email for the server route's notification; the route never echoes it)
-- Interview links (slice 7) carry candidate + interview_token; the RPC then
-- writes an `interviews` row (the trigger mirrors it) instead of a meeting.

create table if not exists public.booking_profiles (
  person_id uuid primary key references public.team_members(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  entity_id uuid not null references public.entities(id) on delete cascade,
  display_name text not null,
  intro text,
  slot_minutes int not null default 30 check (slot_minutes between 10 and 240),
  buffer_minutes int not null default 15 check (buffer_minutes between 0 and 120),
  min_notice_hours int not null default 12 check (min_notice_hours between 0 and 336),
  days_ahead int not null default 14 check (days_ahead between 1 and 60),
  -- local wall-clock windows per ISO weekday key: {"mon":[["10:00","13:00"],["16:00","18:00"]],…}
  hours jsonb not null default '{"mon":[["10:00","13:00"],["16:00","18:00"]],"tue":[["10:00","13:00"],["16:00","18:00"]],"wed":[["10:00","13:00"],["16:00","18:00"]],"thu":[["10:00","13:00"],["16:00","18:00"]],"fri":[["10:00","13:00"],["16:00","18:00"]],"sat":[],"sun":[]}'::jsonb,
  location text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.booking_profiles enable row level security;
revoke all on public.booking_profiles from anon;
revoke truncate on public.booking_profiles from authenticated;
grant select, insert, update, delete on public.booking_profiles to authenticated;
drop policy if exists booking_profiles_read on public.booking_profiles;
create policy booking_profiles_read on public.booking_profiles for select to authenticated
  using (person_id in (select public.app_my_person_ids()) or entity_id in (select public.current_person_entities()));
drop policy if exists booking_profiles_write on public.booking_profiles;
create policy booking_profiles_write on public.booking_profiles for all to authenticated
  using (person_id in (select public.app_my_person_ids()) or entity_id in (select public.app_my_managed_entities()))
  with check ((person_id in (select public.app_my_person_ids()) and entity_id in (select public.current_person_entities()))
              or entity_id in (select public.app_my_managed_entities()));

-- rate-cap ledger (hashes only)
create table if not exists public.booking_attempts (
  id bigserial primary key,
  slug text not null,
  ip_hash text,
  created_at timestamptz not null default now()
);
alter table public.booking_attempts enable row level security;
revoke all on public.booking_attempts from anon, authenticated;
create index if not exists booking_attempts_slug_ts on public.booking_attempts (slug, created_at desc);
create index if not exists booking_attempts_ip_ts on public.booking_attempts (ip_hash, created_at desc);

-- one-shot interview link token (slice 7 writes it when slots are offered)
alter table public.candidates add column if not exists interview_token uuid;
alter table public.candidates add column if not exists interview_offered_at timestamptz;

create or replace function public._booking_within_hours(p_hours jsonb, p_tz text, p_start timestamptz, p_end timestamptz)
returns boolean language plpgsql stable as $$
declare ls timestamp := p_start at time zone p_tz; le timestamp := p_end at time zone p_tz;
        k text := lower(to_char(ls, 'dy')); w jsonb;
begin
  if ls::date <> (le - interval '1 second')::date then return false; end if;
  for w in select * from jsonb_array_elements(coalesce(p_hours -> k, '[]'::jsonb)) loop
    if ls::time >= (w->>0)::time and le::time <= (w->>1)::time and le::time > ls::time then return true; end if;
    if (w->>1) = '24:00' and ls::time >= (w->>0)::time then return true; end if;
  end loop;
  return false;
end $$;

create or replace function public.booking_page_info(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'slug', b.slug, 'name', b.display_name, 'intro', b.intro, 'venue', e.name, 'venue_slug', e.slug,
    'tz', coalesce(e.timezone, 'Europe/Madrid'), 'slot_minutes', b.slot_minutes, 'buffer_minutes', b.buffer_minutes,
    'min_notice_hours', b.min_notice_hours, 'days_ahead', b.days_ahead, 'hours', b.hours,
    'location', coalesce(b.location, e.address_line1, e.name), 'accent', e.accent_color)
  from public.booking_profiles b join public.entities e on e.id = b.entity_id
  where b.slug = lower(p_slug) and b.active;
$$;

-- busy = any events row with this person on it (shifts, interviews, meetings,
-- Google external…) that is not all-day, plus the whole of any all-day
-- external (a day off in Google blocks the day). No titles leave the DB.
create or replace function public.booking_busy(p_slug text, p_from timestamptz, p_to timestamptz)
returns table(start_ts timestamptz, end_ts timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.start_ts, coalesce(e.end_ts, e.start_ts + interval '30 minutes')
    from public.booking_profiles b
    join public.events e on b.person_id = any(e.person_ids)
   where b.slug = lower(p_slug) and b.active
     and (not e.all_day or e.source_type = 'external')
     and e.source_type not in ('task','social','prep','haccp','commercial')
     and e.start_ts < p_to and coalesce(e.end_ts, e.start_ts + interval '30 minutes') > p_from
     and p_to - p_from <= interval '62 days';
$$;

create or replace function public.booking_create(p_slug text, p_start timestamptz, p_name text, p_email text,
  p_phone text default null, p_note text default null, p_intent text default 'meeting',
  p_candidate uuid default null, p_token uuid default null, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b record; tz text; host_email text; p_end timestamptz; eid uuid; iid uuid; cname text; buf interval;
begin
  select bp.*, coalesce(en.timezone,'Europe/Madrid') tz, en.name venue into b
    from public.booking_profiles bp join public.entities en on en.id = bp.entity_id
   where bp.slug = lower(p_slug) and bp.active;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  tz := b.tz;
  select t.email into host_email from public.team_members t where t.id = b.person_id;
  -- rate caps: 5 / IP / hour, 30 / page / day
  if p_ip_hash is not null and (select count(*) from public.booking_attempts
       where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if (select count(*) from public.booking_attempts where slug = b.slug and created_at > now() - interval '1 day') >= 30 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.booking_attempts (slug, ip_hash) values (b.slug, p_ip_hash);

  if coalesce(trim(p_name),'') = '' or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'name_and_email_required');
  end if;
  p_end := p_start + make_interval(mins => b.slot_minutes);
  if p_intent = 'interview' then p_end := p_start + make_interval(mins => greatest(b.slot_minutes, 45)); end if;
  buf := make_interval(mins => b.buffer_minutes);
  if p_start < now() + make_interval(hours => b.min_notice_hours)
     or p_start > now() + make_interval(days => b.days_ahead + 1)
     or extract(minute from p_start)::int % 5 <> 0 then
    return jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  end if;
  if not public._booking_within_hours(b.hours, tz, p_start, p_end) then
    return jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  end if;
  -- serialise per person so two visitors can't take the same slot
  perform pg_advisory_xact_lock(hashtext('booking:' || b.person_id::text));
  if exists (select 1 from public.events e
              where b.person_id = any(e.person_ids)
                and (not e.all_day or e.source_type = 'external')
                and e.source_type not in ('task','social','prep','haccp','commercial')
                and e.start_ts < p_end + buf and coalesce(e.end_ts, e.start_ts + interval '30 minutes') > p_start - buf) then
    return jsonb_build_object('ok', false, 'error', 'slot_taken');
  end if;

  if p_intent = 'interview' and p_candidate is not null then
    select c.name into cname from public.candidates c
     where c.id = p_candidate and c.entity_id = b.entity_id
       and c.interview_token is not null and c.interview_token = p_token;
    if cname is null then return jsonb_build_object('ok', false, 'error', 'invalid_interview_link'); end if;
    insert into public.interviews (candidate_id, scheduled_at, format, location, interviewer_ids, status, notes)
    values (p_candidate, p_start, 'in_person', b.location, array[b.person_id], 'scheduled',
            nullif(trim(coalesce(p_note,'')), ''))
    returning id into iid;
    update public.candidates set interview_token = null,
           status = case when status in ('new','screening') then 'interview' else status end,
           updated_at = now()
     where id = p_candidate;
    select id into eid from public.events where source_type = 'interview' and source_id = iid;
    return jsonb_build_object('ok', true, 'kind', 'interview', 'event_id', eid, 'interview_id', iid,
      'start', p_start, 'end', p_end, 'tz', tz, 'with', b.display_name,
      'venue', b.venue, 'location', b.location, 'person_id', b.person_id, 'host_email', host_email);
  end if;

  insert into public.events (source_type, entity_id, title, description, start_ts, end_ts, timezone, location,
                             person_ids, status, meta)
  values ('meeting', b.entity_id, 'Meeting · ' || left(trim(p_name), 80), nullif(trim(coalesce(p_note,'')), ''),
          p_start, p_end, tz, b.location, array[b.person_id], 'booked',
          jsonb_build_object('booked_via', 'book_page', 'guest_name', left(trim(p_name),120),
                             'guest_email', lower(trim(p_email)), 'guest_phone', left(coalesce(p_phone,''),40)))
  returning id into eid;
  return jsonb_build_object('ok', true, 'kind', 'meeting', 'event_id', eid, 'start', p_start, 'end', p_end,
    'tz', tz, 'with', b.display_name, 'venue', b.venue, 'location', b.location, 'person_id', b.person_id, 'host_email', host_email);
end $$;

revoke all on function public._booking_within_hours(jsonb,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.booking_page_info(text) from public;
revoke all on function public.booking_busy(text,timestamptz,timestamptz) from public;
revoke all on function public.booking_create(text,timestamptz,text,text,text,text,text,uuid,uuid,text) from public;
grant execute on function public.booking_page_info(text) to anon, authenticated;
grant execute on function public.booking_busy(text,timestamptz,timestamptz) to anon, authenticated;
grant execute on function public.booking_create(text,timestamptz,text,text,text,text,text,uuid,uuid,text) to anon, authenticated;
