-- Amendment to the EOD split (see 20260705_eod_two_record_split.sql).
--
-- HOUSE RULE (Boris, LOCKED 2026-07-07): the Fresto POS "Cash" line is not real
-- revenue — it's the end-of-day mistake/deficit bucket, orphan cash that Fresto
-- defaults into Food at ring-up. When we create an accounting EOD from a POS EOD,
-- we MUST auto-generate a signed deviation that deducts the Cash line from Food.
--
-- See: memory/eod_posting_cash_deduction_rule.md, memory/ifl_cash_line_is_not_revenue.md
--
-- This migration adds the `is_system` flag to `eod_deviations` so system-generated
-- rows (the auto cash-deficit deduction, in particular) are visually distinct in the
-- UI and cannot be deleted. Users MAY edit the amount if a legit cash exchange
-- happened (e.g. a real exchange transaction), but they cannot remove the row.
--
-- Rows created before this migration are treated as user-entered (default false).

alter table public.eod_deviations
  add column if not exists is_system boolean not null default false;

create index if not exists eod_deviations_is_system_idx
  on public.eod_deviations (is_system) where is_system = true;

-- Delete guard — system rows may never be deleted at the DB level. User rows keep
-- the pre-existing permissive delete policy from 20260705_eod_two_record_split.sql.
drop policy if exists "eod_deviations_auth_delete" on public.eod_deviations;
create policy "eod_deviations_auth_delete" on public.eod_deviations
  for delete to authenticated using (is_system = false);

-- Update guard — system rows may be UPDATED (Boris can amend the amount if the
-- cash was a legit exchange transaction), but the flag itself cannot flip. Enforced
-- by trigger below since RLS with-check does not easily reference OLD.
drop policy if exists "eod_deviations_auth_update" on public.eod_deviations;
create policy "eod_deviations_auth_update" on public.eod_deviations
  for update to authenticated using (true) with check (true);

create or replace function public.eod_deviations_lock_is_system()
returns trigger language plpgsql as $$
begin
  if OLD.is_system is distinct from NEW.is_system then
    raise exception 'eod_deviations.is_system is immutable';
  end if;
  return NEW;
end
$$;

drop trigger if exists eod_deviations_lock_is_system on public.eod_deviations;
create trigger eod_deviations_lock_is_system
  before update on public.eod_deviations
  for each row execute function public.eod_deviations_lock_is_system();
