-- Home compass / brief anon-read policies
--
-- The server component `app/page.tsx` and the brief generator query a set
-- of OS-owned tables (yesterday's EOD, monthly revenue, weather, finance
-- snapshots, invoice inbox, master todos, platform billing, bank movements).
-- Every one of those tables has RLS enabled with SELECT restricted to
-- `authenticated`. When the operator lands on `/` without a fresh session
-- cookie (which happens after ~1h of idle), `supabaseServer()` degrades to
-- the anon role and every read returns zero rows -- the compass shows blanks
-- and the LLM brief hallucinates "quiet day" prose because its signal
-- assembly is empty.
--
-- The data in these tables is not sensitive per-tenant -- we have exactly
-- one tenant (Ibiza Food Studios) and the app URL is behind a soft login
-- wall (middleware.ts). Loosening anon-read here brings Home in line with
-- `bookings`, `mep_dishes`, `menu_items`, `tasks`, `zones` which already
-- have anon read.
--
-- BORIS: this is a security choice -- if you want tenant isolation later
-- (multi-venue SaaS), we swap these anon policies for authenticated + a
-- restaurant_id-scoped policy. For today, this unblocks Home showing real
-- numbers when the session cookie has aged out.

do $$
begin
  if not exists (select 1 from pg_policies where tablename='eod_pos' and policyname='eod_pos_anon_read') then
    create policy "eod_pos_anon_read" on public.eod_pos for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename='revenue_monthly_history' and policyname='revenue_monthly_history_anon_read') then
    create policy "revenue_monthly_history_anon_read" on public.revenue_monthly_history for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename='weather_daily' and policyname='weather_daily_anon_read') then
    create policy "weather_daily_anon_read" on public.weather_daily for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename='finance_weekly_snapshots' and policyname='finance_weekly_snapshots_anon_read') then
    create policy "finance_weekly_snapshots_anon_read" on public.finance_weekly_snapshots for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename='invoice_inbox' and policyname='invoice_inbox_anon_read') then
    create policy "invoice_inbox_anon_read" on public.invoice_inbox for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename='master_todos' and policyname='master_todos_anon_read') then
    create policy "master_todos_anon_read" on public.master_todos for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename='platform_billing_status' and policyname='platform_billing_status_anon_read') then
    create policy "platform_billing_status_anon_read" on public.platform_billing_status for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename='bank_movements' and policyname='bank_movements_anon_read') then
    create policy "bank_movements_anon_read" on public.bank_movements for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename='eod_accounting' and policyname='eod_accounting_anon_read') then
    create policy "eod_accounting_anon_read" on public.eod_accounting for select to anon using (true);
  end if;
end $$;
