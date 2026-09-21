-- calendar: advisor tidy (2026-09-21) — internal helpers not callable over REST;
-- fixed search_path on the two non-definer helpers.
revoke all on function public._entity_id_for_key(text) from public, anon, authenticated;
revoke all on function public._entity_tz(uuid) from public, anon, authenticated;
alter function public._prep_event_id(uuid, date) set search_path = public, pg_temp;
alter function public._booking_within_hours(jsonb, text, timestamptz, timestamptz) set search_path = public, pg_temp;
