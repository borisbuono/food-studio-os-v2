-- calendar: _hr_wire — offer interview slots from the hiring board (2026-09-21)
-- offer_interview_slots(candidate, interviewer?) mints a one-shot token on the
-- candidate and returns the interviewer's /book slug. The board builds the
-- link /book/<slug>?intent=interview&candidate=<id>&k=<token> plus a drafted
-- ES/EN message with the next 3 free slots. NOTHING auto-sends.
-- booking_create (re-created): location falls back to the venue address,
-- interview format 'in-person' (matches the board), status_history appended.

create or replace function public.offer_interview_slots(p_candidate uuid, p_interviewer uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; pid uuid; bslug text; tok uuid := gen_random_uuid();
begin
  select id, entity_id, name into c from public.candidates where id = p_candidate;
  if not found or c.entity_id not in (select public.current_person_entities()) then
    raise exception 'not your candidate' using errcode = '42501';
  end if;
  pid := coalesce(p_interviewer, (select id from public.team_members where auth_user_id = auth.uid() order by created_at limit 1));
  select slug into bslug from public.booking_profiles where person_id = pid and active;
  if bslug is null then
    return jsonb_build_object('ok', false, 'error', 'no_booking_profile');
  end if;
  update public.candidates set interview_token = tok, interview_offered_at = now(), updated_at = now() where id = p_candidate;
  return jsonb_build_object('ok', true, 'token', tok, 'slug', bslug, 'candidate_name', c.name, 'interviewer', pid);
end $$;
revoke all on function public.offer_interview_slots(uuid, uuid) from public, anon;
grant execute on function public.offer_interview_slots(uuid, uuid) to authenticated;

create or replace function public.booking_create(p_slug text, p_start timestamptz, p_name text, p_email text,
  p_phone text default null, p_note text default null, p_intent text default 'meeting',
  p_candidate uuid default null, p_token uuid default null, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b record; tz text; host_email text; loc text; p_end timestamptz; eid uuid; iid uuid; cname text; cstatus text; buf interval;
begin
  select bp.*, coalesce(en.timezone,'Europe/Madrid') tz, en.name venue, coalesce(bp.location, en.address_line1, en.name) loc into b
    from public.booking_profiles bp join public.entities en on en.id = bp.entity_id
   where bp.slug = lower(p_slug) and bp.active;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  tz := b.tz; loc := b.loc;
  select t.email into host_email from public.team_members t where t.id = b.person_id;
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
  perform pg_advisory_xact_lock(hashtext('booking:' || b.person_id::text));
  if exists (select 1 from public.events e
              where b.person_id = any(e.person_ids)
                and (not e.all_day or e.source_type = 'external')
                and e.source_type not in ('task','social','prep','haccp','commercial')
                and e.start_ts < p_end + buf and coalesce(e.end_ts, e.start_ts + interval '30 minutes') > p_start - buf) then
    return jsonb_build_object('ok', false, 'error', 'slot_taken');
  end if;

  if p_intent = 'interview' and p_candidate is not null then
    select c.name, c.status into cname, cstatus from public.candidates c
     where c.id = p_candidate and c.entity_id = b.entity_id
       and c.interview_token is not null and c.interview_token = p_token;
    if cname is null then return jsonb_build_object('ok', false, 'error', 'invalid_interview_link'); end if;
    insert into public.interviews (candidate_id, scheduled_at, format, location, interviewer_ids, status, notes)
    values (p_candidate, p_start, 'in-person', loc, array[b.person_id], 'scheduled',
            nullif(trim(coalesce(p_note,'')), ''))
    returning id into iid;
    update public.candidates set interview_token = null, updated_at = now(),
           status = case when status in ('new','screening') then 'interview' else status end,
           status_history = case when status in ('new','screening')
             then coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                  'at', now(), 'from', status, 'to', 'interview', 'by', 'book_page', 'reason', 'candidate picked a slot'))
             else status_history end
     where id = p_candidate;
    select id into eid from public.events where source_type = 'interview' and source_id = iid;
    return jsonb_build_object('ok', true, 'kind', 'interview', 'event_id', eid, 'interview_id', iid,
      'start', p_start, 'end', p_end, 'tz', tz, 'with', b.display_name,
      'venue', b.venue, 'location', loc, 'person_id', b.person_id, 'host_email', host_email);
  end if;

  insert into public.events (source_type, entity_id, title, description, start_ts, end_ts, timezone, location,
                             person_ids, status, meta)
  values ('meeting', b.entity_id, 'Meeting · ' || left(trim(p_name), 80), nullif(trim(coalesce(p_note,'')), ''),
          p_start, p_end, tz, loc, array[b.person_id], 'booked',
          jsonb_build_object('booked_via', 'book_page', 'guest_name', left(trim(p_name),120),
                             'guest_email', lower(trim(p_email)), 'guest_phone', left(coalesce(p_phone,''),40)))
  returning id into eid;
  return jsonb_build_object('ok', true, 'kind', 'meeting', 'event_id', eid, 'start', p_start, 'end', p_end,
    'tz', tz, 'with', b.display_name, 'venue', b.venue, 'location', loc, 'person_id', b.person_id, 'host_email', host_email);
end $$;
revoke all on function public.booking_create(text,timestamptz,text,text,text,text,text,uuid,uuid,text) from public;
grant execute on function public.booking_create(text,timestamptz,text,text,text,text,text,uuid,uuid,text) to anon, authenticated;
