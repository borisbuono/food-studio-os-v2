-- Amendment to the EOD split (see 20260705_eod_two_record_split.sql,
-- 20260707_eod_deviations_is_system.sql).
--
-- HOUSE RULE UPDATE (Boris, 2026-07-07): the auto-deduction of the Fresto POS
-- "Cash" line from Food revenue is correct for IFL (Taller) and BM (Bistro
-- Mondo) — the two venues Boris actively operates — but NOT for every venue.
-- Some venues (advisory clients on Phase 4, or venues with real till-based
-- cash service) legitimately book cash sales, and auto-deducting kills their
-- revenue.
--
-- Fix: promote the rule from a global constant into a per-restaurant flag.
-- Default TRUE (matches the two operating venues today), can be flipped FALSE
-- per restaurant from /administrate/finance/setup/[entity].
--
-- Second addition: when a user edits the amount of an auto-generated (system)
-- deviation, we now require them to record WHY — legit cash exchange, no card
-- terminal, till discrepancy, etc. The reason lives on the deviation row and
-- is surfaced in the audit trail alongside the amount change.
--
-- See: memory/eod_posting_cash_deduction_rule.md,
--      memory/ifl_cash_line_is_not_revenue.md,
--      memory/pos_vs_accounting_separation.md.

alter table public.restaurants
  add column if not exists deduct_pos_cash_from_food boolean not null default true;

comment on column public.restaurants.deduct_pos_cash_from_food is
  'When TRUE (default), the EOD flow auto-inserts a system deviation that deducts '
  'the Fresto Cash line from Food revenue on accounting seed. Set FALSE per '
  'restaurant when cash sales are legitimate (venues with till service, advisory '
  'clients not on the IFL/BM cash-line-as-mistake rule).';

-- Explicitly assert TRUE for IFL (Taller) + BM (Bistro Mondo) — the two venues
-- where the rule is confirmed correct. Utopia (sandbox) inherits the default
-- TRUE. Any restaurants added later inherit the default TRUE and can be flipped
-- FALSE from the setup page.
update public.restaurants
  set deduct_pos_cash_from_food = true
  where id in (
    'ca83e06f-a24d-43d7-bce4-57ac341d190f',   -- Taller (IFL entity)
    'fb4d008f-2d2a-4e0d-a525-6e0e36af0259'    -- Bistrot Mondo (BM entity)
  );

-- Per-day override reason for system deviations. When Boris edits the amount
-- of the auto cash-deduction row on a specific day, he must record a categorised
-- reason so the audit trail explains why the system default was overridden.
-- NULL means: user left the system default in place OR the row is a plain user
-- deviation (not a system row).
alter table public.eod_deviations
  add column if not exists is_system_override_reason text;

comment on column public.eod_deviations.is_system_override_reason is
  'When a user edits the amount of a system (is_system = true) deviation, the '
  'reason is recorded here. Values: legit_cash_exchange | no_card_terminal | '
  'till_discrepancy | corrected_pos_mistake | other. NULL means the system '
  'default was left alone, or the row is a user deviation.';
