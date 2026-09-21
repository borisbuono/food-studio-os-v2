-- 2026-09-21 · how old is the price behind a dish cost?
--
-- Item-level purchase lines stop in 2025 (2026 Holded documents carry no
-- line detail), so the pricer now falls back to the newest price it holds
-- however old it is, rather than printing nothing. That is only honest if
-- the age travels with the number.
--
--   price_asof — oldest of the per-ingredient newest invoice dates
--   price_tier — fresh (≤30d) | recent (≤180d) | stale (older)

alter table public.menu_dish_costing add column if not exists price_asof date;
alter table public.menu_dish_costing add column if not exists price_tier text
  check (price_tier is null or price_tier in ('fresh','recent','stale'));
