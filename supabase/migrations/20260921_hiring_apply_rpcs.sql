-- Public apply page without the service-role key.
-- Three SECURITY DEFINER functions are the only anon surface; candidates and
-- the hiring-cvs bucket stay closed to anon except one narrow upload rule.
alter table public.candidates add column if not exists apply_token uuid;

create or replace function public.apply_page_info(p_slug text)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'legal_name', coalesce(e.legal_name, e.name), 'accent', e.accent_color,
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'station', o.station,
                  'role', o.role, 'languages_required', o.languages_required) order by o.created_at desc)
                  from public.job_openings o where o.entity_id = e.id and o.status = 'open'), '[]'::jsonb))
  from public.entities e
  where e.slug = p_slug and coalesce(e.hiring_enabled, true) and coalesce(e.is_active, true);
$$;

create or replace function public.apply_submit(
  p_slug text, p_name text, p_email text, p_phone text, p_answers jsonb, p_opening uuid,
  p_ip_hash text, p_source text, p_utm text, p_notes text, p_touch text, p_retain date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ent uuid; v_open uuid; v_id uuid; v_tok uuid := gen_random_uuid(); n int;
begin
  select id into v_ent from public.entities
   where slug = p_slug and coalesce(hiring_enabled, true) and coalesce(is_active, true);
  if v_ent is null then raise exception 'unknown kitchen'; end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_phone), '') = ''
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'name, email and phone are required';
  end if;
  -- per-connection limit (hash supplied by our route) + per-house flood caps
  select count(*) into n from public.candidates where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if n >= 3 then raise exception 'rate limited'; end if;
  select count(*) into n from public.candidates where entity_id = v_ent and consent_at > now() - interval '10 minutes';
  if n >= 20 then raise exception 'rate limited'; end if;
  select count(*) into n from public.candidates where entity_id = v_ent and consent_at > now() - interval '1 day';
  if n >= 150 then raise exception 'rate limited'; end if;
  if p_opening is not null then
    select id into v_open from public.job_openings where id = p_opening and entity_id = v_ent and status = 'open';
  end if;
  insert into public.candidates (entity_id, job_opening_id, name, email, phone, source, source_ref, notes, answers,
     status, status_history, ip_hash, consent_at, retain_until, apply_token)
  values (v_ent, v_open, left(btrim(p_name), 200), left(btrim(p_email), 200), left(btrim(p_phone), 50),
     left(coalesce(nullif(p_source, ''), 'apply_page'), 40), nullif(left(p_utm, 200), ''), nullif(left(p_notes, 4000), ''),
     p_answers, 'new', jsonb_build_array(jsonb_build_object('at', now(), 'to', 'new', 'by', null, 'reason', 'applied via /apply page')),
     left(p_ip_hash, 128), now(), coalesce(p_retain, (now() + interval '1 year')::date), v_tok)
  returning id into v_id;
  insert into public.candidate_touches (candidate_id, channel, direction, kind, body, notes)
  values (v_id, 'apply_page', 'inbound', 'reply', left(p_touch, 10000), 'applied via the public page — answers included');
  return jsonb_build_object('id', v_id, 'entity_id', v_ent, 'token', v_tok);
end $$;

-- Second half of the same submission: the route has read the CV and scored it.
-- Only works once, with the token, within 15 minutes of submit.
create or replace function public.apply_finish(
  p_id uuid, p_token uuid, p_profile jsonb, p_summary text, p_score int, p_reasons jsonb,
  p_flags text[], p_cv_path text, p_languages text[], p_years numeric, p_rtw text, p_location text, p_availability text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.candidates set
    profile = coalesce(p_profile, '{}'::jsonb), summary = left(p_summary, 2000),
    score = greatest(0, least(100, p_score)), score_reasons = coalesce(p_reasons, '[]'::jsonb),
    review_flags = coalesce(p_flags, '{}'), parsed_at = now(),
    cv_path = case when p_cv_path like entity_id::text || '/' || id::text || '.%' then p_cv_path else cv_path end,
    languages = coalesce(p_languages, languages), years_experience = coalesce(p_years, years_experience),
    right_to_work = coalesce(left(p_rtw, 40), right_to_work), location = coalesce(left(p_location, 200), location),
    availability = coalesce(left(p_availability, 300), availability),
    apply_token = null
  where id = p_id and apply_token = p_token and consent_at > now() - interval '15 minutes';
  return found;
end $$;

-- Anon may upload exactly one CV, to <entity>/<candidate>.<ext>, for a candidate
-- that is mid-submission (token still set). No anon read, list or delete.
create or replace function public.fn_apply_can_upload(p_name text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.candidates c
    where c.apply_token is not null and c.consent_at > now() - interval '15 minutes' and c.cv_path is null
      and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp|heic|heif)$'
      and split_part(p_name, '/', 1) = c.entity_id::text
      and split_part(split_part(p_name, '/', 2), '.', 1) = c.id::text);
$$;

drop policy if exists hiring_cvs_apply_upload on storage.objects;
create policy hiring_cvs_apply_upload on storage.objects for insert to anon
  with check (bucket_id = 'hiring-cvs' and public.fn_apply_can_upload(name));

revoke all on function public.apply_page_info(text) from public;
revoke all on function public.apply_submit(text,text,text,text,jsonb,uuid,text,text,text,text,text,date) from public;
revoke all on function public.apply_finish(uuid,uuid,jsonb,text,int,jsonb,text[],text,text[],numeric,text,text,text) from public;
revoke all on function public.fn_apply_can_upload(text) from public;
grant execute on function public.apply_page_info(text) to anon, authenticated;
grant execute on function public.apply_submit(text,text,text,text,jsonb,uuid,text,text,text,text,text,date) to anon, authenticated;
grant execute on function public.apply_finish(uuid,uuid,jsonb,text,int,jsonb,text[],text,text[],numeric,text,text,text) to anon, authenticated;
grant execute on function public.fn_apply_can_upload(text) to anon, authenticated;
