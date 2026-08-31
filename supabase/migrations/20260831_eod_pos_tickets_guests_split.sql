-- Boris walk 2026-08-31: split "covers" into two orthogonal signals.
--
--   • tickets  = item count from Fresto z.quantity (each dish/coffee = 1)
--   • guests   = real physical guest count (Boris keys manually, or we
--                parse the closing-report email "Guests: N" line when it
--                fires)
--
-- Earlier today an ad-hoc backfill wrote Fresto's z.quantity into
-- eod_pos.covers. That's item count, not people — a table of two ordering
-- 3 courses + wine + a coffee shows as ~8 "covers". Boris flagged 320 at
-- BM Aug 23 and 37 at Taller Aug 28 as impossible; audit confirmed the
-- conflation.
--
-- Multi-day z-reports (spans across midnight or a multi-day close) dump
-- aggregate cash onto a single day; when that happens we flag it so the
-- Studio card can show a SPAN pill rather than lie.
--
-- `covers` is kept for now (other callers still read it) but is nulled
-- for source='fresto' rows so nothing accidentally treats item-count as
-- guest-count. Column will be dropped in a later pass once callers are
-- weaned off.

ALTER TABLE public.eod_pos
  ADD COLUMN IF NOT EXISTS tickets integer,
  ADD COLUMN IF NOT EXISTS orders_count integer,
  ADD COLUMN IF NOT EXISTS tables_count integer,
  ADD COLUMN IF NOT EXISTS guests integer,
  ADD COLUMN IF NOT EXISTS guests_source text,
  ADD COLUMN IF NOT EXISTS guests_keyed_by uuid,
  ADD COLUMN IF NOT EXISTS guests_keyed_at timestamptz,
  ADD COLUMN IF NOT EXISTS z_spans_days boolean DEFAULT false;

-- covers had a NOT NULL constraint from the original two-record split
-- migration. Now that Fresto rows null it out, the constraint has to go.
ALTER TABLE public.eod_pos ALTER COLUMN covers DROP NOT NULL;

ALTER TABLE public.eod_pos
  DROP CONSTRAINT IF EXISTS eod_pos_guests_source_chk;
ALTER TABLE public.eod_pos
  ADD CONSTRAINT eod_pos_guests_source_chk
  CHECK (guests_source IS NULL OR guests_source IN ('email','manual','import'));

-- Freeze the mis-labelling: the current covers values are actually
-- item counts (Fresto z.quantity). Move them into tickets so we don't
-- lose the number, then null covers on Fresto rows so no caller mistakes
-- them for guests going forward.
UPDATE public.eod_pos
   SET tickets = covers
 WHERE source = 'fresto' AND tickets IS NULL AND covers IS NOT NULL;

UPDATE public.eod_pos
   SET covers = NULL
 WHERE source = 'fresto';

COMMENT ON COLUMN public.eod_pos.tickets IS 'Item count from Fresto z.quantity (each dish/coffee/wine = 1). Not people.';
COMMENT ON COLUMN public.eod_pos.guests  IS 'Real physical guest count. Sourced by email parse or manual key.';
COMMENT ON COLUMN public.eod_pos.guests_source IS 'One of: email, manual, import. Manual trumps email in the writer.';
COMMENT ON COLUMN public.eod_pos.z_spans_days IS 'true when the day was covered by a z-report whose fromDate != toDate.date; cash/card figures on this row are aggregated and unreliable for the specific day.';
COMMENT ON COLUMN public.eod_pos.covers IS 'DEPRECATED for Fresto rows. Legacy readers only. Use tickets or guests.';
