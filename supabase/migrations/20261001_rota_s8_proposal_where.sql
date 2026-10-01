-- 20261001_rota_s8_proposal_where.sql
-- Rota S8 — the proposal says WHERE (Boris's ruling C, 2026-10-01).
--
-- fn_rota_propose now works per SERVICE (lunch / dinner) and per area, and
-- returns lines, each one an action the manager can accept on its own:
--   remove   a whole shift that is surplus for the service's forecast        (−€)
--   shorten  a shift spanning both services, cut the surplus service's part   (−€)
--   extend   a shift in the other service to cover a shortfall, if cheaper    (+€)
--   add      hours nobody is planned for: area, service, minutes, est. €      (+€)
-- Each line carries covers forecast vs the staffing band (need vs have) as its
-- reason. Nothing is applied by the OS: fn_rota_proposal_accept applies ONE
-- line after the manager's tap; an "add" line needs the shift the manager
-- created (person chosen by them), the OS never picks the person.

-- does a shift cover a service? lunch = starts before 16:00; dinner = starts at/after 16:00, or runs past 18:30, or overnight
create or replace function public._rota_shift_covers(p_start time, p_end time, p_service text)
returns boolean language sql immutable as $$
  select case p_service when 'lunch' then p_start < '16:00'::time
                        else (p_start >= '16:00'::time or p_end > '18:30'::time or p_end <= p_start) end;
$$;

drop function if exists public.fn_rota_propose(uuid, date);
create or replace function public.fn_rota_propose(p_entity uuid, p_week_start date)
returns public.rota_proposals language plpgsql security definer set search_path = public, pg_temp as $$
declare st public.rota_settings; f record; svc text; ar text; items jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb; fc jsonb := '[]'::jsonb;
        before_eur numeric := 0; delta numeric := 0; need int; have int; covers int; r record; cut int; p public.rota_proposals; week_rev numeric := 0;
        avg_rate numeric; add_minutes int; add_eur numeric; ext record; line_no int := 0; part_minutes int; reason text; svc_label text;
begin
  if not public.fn_is_entity_manager(auth.uid(), p_entity) then raise exception 'manager required'; end if;
  st := public.fn_rota_settings(p_entity);
  select coalesce(sum(planned_minutes * coalesce(hourly_cost, 0) / 60.0), 0) into before_eur
    from public.rota_shifts where entity_id = p_entity and service_date >= p_week_start and service_date < p_week_start + 7 and status <> 'cancelled';

  for f in select * from public.fn_rota_forecast(p_entity, p_week_start) loop
    week_rev := week_rev + coalesce(f.forecast_revenue, 0);
    fc := fc || jsonb_build_object('service_date', f.service_date, 'booked', f.booked_covers, 'avg_4w', f.avg_covers_4w, 'covers', f.forecast_covers, 'lunch', f.lunch_covers, 'dinner', f.dinner_covers,
                                   'revenue', f.forecast_revenue, 'basis', f.basis, 'last_year', f.last_year_covers, 'holiday', f.holiday, 'uplift', f.uplift);
    foreach svc in array array['lunch','dinner'] loop
      covers := case svc when 'lunch' then f.lunch_covers else f.dinner_covers end;
      svc_label := to_char(f.service_date, 'Dy') || ' ' || svc;
      foreach ar in array array['foh','boh'] loop
        need := public.fn_rota_required(st.staffing_bands, covers, ar);
        select count(*) into have from public.rota_shifts s
         where s.entity_id = p_entity and s.service_date = f.service_date and s.status <> 'cancelled' and s.area = ar and public._rota_shift_covers(s.start_time, s.end_time, svc);
        reason := format('%s covers forecast %s%s → %s %s needed, %s planned', covers, svc_label, case when f.holiday is not null then ' (' || f.holiday || ')' else '' end, need, upper(ar), have);

        if have > need then
          -- surplus: most expensive first; a shift that also covers the other service is shortened, not removed
          cut := have - need;
          for r in
            select s.id, s.person_id, tm.name, s.start_time, s.end_time, s.planned_minutes, s.hourly_cost,
                   public._rota_shift_covers(s.start_time, s.end_time, case svc when 'lunch' then 'dinner' else 'lunch' end) spans_other
              from public.rota_shifts s left join public.team_members tm on tm.id = s.person_id
             where s.entity_id = p_entity and s.service_date = f.service_date and s.status <> 'cancelled' and s.area = ar and public._rota_shift_covers(s.start_time, s.end_time, svc)
             order by s.planned_minutes * coalesce(s.hourly_cost, 0) desc, s.start_time
             limit cut
          loop
            line_no := line_no + 1;
            if r.spans_other then
              -- shorten: lunch part = start → 16:00 ; dinner part = 18:30 → end
              part_minutes := case svc when 'lunch' then greatest(0, (extract(epoch from ('16:00'::time - r.start_time)) / 60)::int)
                                       else greatest(0, (extract(epoch from (case when r.end_time <= r.start_time then r.end_time + interval '24 hours' else r.end_time end - '18:30'::time)) / 60)::int) end;
              if part_minutes <= 0 then continue; end if;
              items := items || jsonb_build_object('line_id', 'L' || line_no, 'action', 'shorten', 'service_date', f.service_date, 'service', svc, 'area', ar,
                'shift_id', r.id, 'person_id', r.person_id, 'name', r.name, 'start', to_char(r.start_time, 'HH24:MI'), 'end', to_char(r.end_time, 'HH24:MI'),
                'new_start', case svc when 'lunch' then '16:00' else to_char(r.start_time, 'HH24:MI') end, 'new_end', case svc when 'lunch' then to_char(r.end_time, 'HH24:MI') else '18:30' end,
                'minutes', -part_minutes, 'eur_delta', round(-part_minutes * coalesce(r.hourly_cost, 0) / 60.0, 2), 'reason', reason, 'covers', covers, 'need', need, 'have', have, 'status', 'proposed');
              delta := delta - part_minutes * coalesce(r.hourly_cost, 0) / 60.0;
            else
              items := items || jsonb_build_object('line_id', 'L' || line_no, 'action', 'remove', 'service_date', f.service_date, 'service', svc, 'area', ar,
                'shift_id', r.id, 'person_id', r.person_id, 'name', r.name, 'start', to_char(r.start_time, 'HH24:MI'), 'end', to_char(r.end_time, 'HH24:MI'),
                'minutes', -r.planned_minutes, 'eur_delta', round(-r.planned_minutes * coalesce(r.hourly_cost, 0) / 60.0, 2), 'reason', reason, 'covers', covers, 'need', need, 'have', have, 'status', 'proposed');
              delta := delta - r.planned_minutes * coalesce(r.hourly_cost, 0) / 60.0;
            end if;
          end loop;

        elsif have < need then
          -- shortfall: extend a same-area shift from the other service if that is cheaper than a new one; else add hours
          add_minutes := case svc when 'lunch' then 300 else 360 end;
          select avg(x.rate) into avg_rate from (
            select public.fn_person_rate(p_entity, m.person_id, f.service_date) rate from public.memberships m
             where m.entity_id = p_entity and m.status = 'active' and lower(coalesce(m.area, '')) = ar) x where x.rate is not null;
          if avg_rate is null then select avg(x.rate) into avg_rate from (select public.fn_person_rate(p_entity, m.person_id, f.service_date) rate from public.memberships m where m.entity_id = p_entity and m.status = 'active') x where x.rate is not null; end if;
          add_eur := round(add_minutes * coalesce(avg_rate, 0) / 60.0, 2);
          for i in 1..(need - have) loop
            line_no := line_no + 1;
            select s.id, s.person_id, tm.name, s.start_time, s.end_time, s.hourly_cost into ext
              from public.rota_shifts s left join public.team_members tm on tm.id = s.person_id
             where s.entity_id = p_entity and s.service_date = f.service_date and s.status <> 'cancelled' and s.area = ar
               and not public._rota_shift_covers(s.start_time, s.end_time, svc)
               and not exists (select 1 from jsonb_array_elements(items) it where (it->>'shift_id')::uuid = s.id)
             order by coalesce(s.hourly_cost, 999999) limit 1;
            -- extend: lunch shortfall → start earlier (12:00); dinner shortfall → end later (23:30)
            if ext.id is not null and ext.hourly_cost is not null and (avg_rate is null or ext.hourly_cost <= avg_rate) then
              part_minutes := case svc when 'lunch' then greatest(60, (extract(epoch from (ext.start_time - '12:00'::time)) / 60)::int)
                                       else greatest(60, (extract(epoch from ('23:30'::time - ext.end_time)) / 60)::int) end;
              items := items || jsonb_build_object('line_id', 'L' || line_no, 'action', 'extend', 'service_date', f.service_date, 'service', svc, 'area', ar,
                'shift_id', ext.id, 'person_id', ext.person_id, 'name', ext.name, 'start', to_char(ext.start_time, 'HH24:MI'), 'end', to_char(ext.end_time, 'HH24:MI'),
                'new_start', case svc when 'lunch' then '12:00' else to_char(ext.start_time, 'HH24:MI') end, 'new_end', case svc when 'lunch' then to_char(ext.end_time, 'HH24:MI') else '23:30' end,
                'minutes', part_minutes, 'eur_delta', round(part_minutes * ext.hourly_cost / 60.0, 2), 'reason', reason, 'covers', covers, 'need', need, 'have', have, 'status', 'proposed');
              delta := delta + part_minutes * ext.hourly_cost / 60.0;
            else
              items := items || jsonb_build_object('line_id', 'L' || line_no, 'action', 'add', 'service_date', f.service_date, 'service', svc, 'area', ar,
                'start', case svc when 'lunch' then '12:00' else '18:00' end, 'end', case svc when 'lunch' then '17:00' else '00:00' end,
                'minutes', add_minutes, 'eur_delta', add_eur, 'rate_basis', case when avg_rate is null then 'no rates set' else 'avg ' || upper(ar) || ' rate €' || round(avg_rate, 2) end,
                'reason', reason, 'covers', covers, 'need', need, 'have', have, 'status', 'proposed');
              delta := delta + add_eur;
            end if;
          end loop;
          warns := warns || jsonb_build_object('service_date', f.service_date, 'service', svc, 'area', ar, 'have', have, 'need', need, 'covers', covers);
        end if;
      end loop;
    end loop;
  end loop;

  insert into public.rota_proposals (entity_id, week_start, created_by, before_eur, after_eur, forecast, items, warnings)
  values (p_entity, p_week_start, auth.uid(), round(before_eur, 2), round(before_eur + delta, 2), fc, items, warns)
  returning * into p;
  insert into public.rota_weeks (entity_id, week_start, forecast_revenue) values (p_entity, p_week_start, round(week_rev, 2))
  on conflict (entity_id, week_start) do update set forecast_revenue = coalesce(public.rota_weeks.forecast_revenue, excluded.forecast_revenue), updated_at = now();
  return p;
end $$;

-- accept ONE line (the manager's tick) --------------------------------------------
drop function if exists public.fn_rota_proposal_accept(uuid, uuid, boolean);
create or replace function public.fn_rota_proposal_accept(p_proposal uuid, p_line text, p_accept boolean default true, p_new_shift uuid default null)
returns public.rota_proposals language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.rota_proposals; it jsonb; new_items jsonb := '[]'::jsonb; found boolean := false; act text; sid uuid;
begin
  select * into p from public.rota_proposals where id = p_proposal;
  if p.id is null then raise exception 'proposal not found'; end if;
  if not public.fn_is_entity_manager(auth.uid(), p.entity_id) then raise exception 'manager required'; end if;
  for it in select * from jsonb_array_elements(p.items) loop
    if it->>'line_id' = p_line and it->>'status' = 'proposed' then
      found := true; act := it->>'action'; sid := nullif(it->>'shift_id', '')::uuid;
      if p_accept then
        if act = 'remove' then
          update public.rota_shifts set status = 'cancelled' where id = sid and entity_id = p.entity_id;
        elsif act in ('shorten', 'extend') then
          update public.rota_shifts set start_time = (it->>'new_start')::time, end_time = (it->>'new_end')::time where id = sid and entity_id = p.entity_id and status <> 'cancelled';
        elsif act = 'add' then
          if p_new_shift is null then raise exception 'an add line needs the shift you created (who works it is your call)'; end if;
          if not exists (select 1 from public.rota_shifts where id = p_new_shift and entity_id = p.entity_id) then raise exception 'shift not found on this house'; end if;
          it := it || jsonb_build_object('shift_id', p_new_shift);
        end if;
        it := it || jsonb_build_object('status', 'accepted', 'decided_at', now());
      else
        it := it || jsonb_build_object('status', 'declined', 'decided_at', now());
      end if;
    end if;
    new_items := new_items || it;
  end loop;
  if not found then raise exception 'line not open on this proposal'; end if;
  update public.rota_proposals set items = new_items,
         status = case when not exists (select 1 from jsonb_array_elements(new_items) x where x->>'status' = 'proposed') then 'closed' else 'open' end
   where id = p.id returning * into p;
  return p;
end $$;

grant execute on function public.fn_rota_propose(uuid, date), public.fn_rota_proposal_accept(uuid, text, boolean, uuid) to authenticated;
