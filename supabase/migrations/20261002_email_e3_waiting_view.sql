-- Email channel — E3: the waiting count matches the cards (a thread still at
-- 'new' has not been sorted yet and is not on the screen).
create or replace view public.email_inbox_waiting
with (security_invoker = true) as
select entity_id, count(*)::int as waiting
  from public.email_threads
 where status in ('classified','drafted') and not flagged
 group by entity_id;
grant select on public.email_inbox_waiting to authenticated;
