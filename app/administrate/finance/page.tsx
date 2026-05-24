import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");

export default async function Finance() {
  const venues = (await supabase.from("restaurants").select("id,name").order("name")).data || [];
  const reports = (await supabase.from("eod_reports").select("restaurant_id,report_date,actual_covers,revenue,revenue_food,revenue_wine,revenue_bar").order("report_date", { ascending: false })).data || [];
  const coa = (await supabase.from("chart_of_accounts").select("code,label_en,label_es,direction,is_active").eq("is_active", true).order("code")).data || [];

  const byVenue = venues.map((v: any) => ({ ...v, rs: reports.filter((r: any) => r.restaurant_id === v.id) })).filter((x: any) => x.rs.length);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate" className="font-sans text-sm text-ink-soft">← administrate</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Finance · the numbers, explained</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">How the house is doing</h1>
      <div className="mt-4 flex gap-4 font-sans text-sm text-ochre">
        <Link href="/administrate/cashflow">Cash flow →</Link>
        <Link href="/administrate/invoices">Missing invoices →</Link>
        <Link href="/administrate/finance/eod">EOD reports →</Link>
        <Link href="/administrate/finance/variance">Variance →</Link>
      </div>

      {byVenue.map((v: any) => {
        const latest = v.rs[0], prev = v.rs[1];
        const rev = Number(latest.revenue || 0);
        const cov = Number(latest.actual_covers || 0);
        const avg = cov ? rev / cov : 0;
        const prevRev = prev ? Number(prev.revenue || 0) : 0;
        const delta = prevRev ? Math.round((rev / prevRev - 1) * 100) : null;
        const deltaWord = delta === null ? "" : delta >= 0 ? `up ${delta}% vs prior period` : `down ${Math.abs(delta)}% vs prior period`;
        return (
          <section key={v.id} className="mt-8">
            <div className="rounded-2xl border border-black/10 bg-card p-6">
              <div className="flex items-baseline justify-between">
                <h2 className="font-serif text-2xl text-ink">{v.name}</h2>
                <span className="font-mono text-[11px] text-clay">{latest.report_date}</span>
              </div>
              <p className="mt-3 font-serif text-4xl text-ink">{eur(rev)}</p>
              <p className="mt-1 font-sans text-[14px] text-ink-soft">{cov.toLocaleString("en-GB")} covers · {eur(avg)} avg spend{deltaWord ? " · " + deltaWord : ""}</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[["Food", latest.revenue_food], ["Wine", latest.revenue_wine], ["Bar", latest.revenue_bar]].map(([l, n]: any, i: number) => (
                  <div key={i}><p className="font-serif text-xl text-ink">{eur(Number(n || 0))}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">{l}</p></div>
                ))}
              </div>
            </div>
            {v.rs.length > 1 ? (
              <ul className="mt-3 divide-y divide-black/10">
                {v.rs.slice(1, 6).map((r: any, i: number) => (
                  <li key={i} className="flex items-baseline justify-between py-2">
                    <span className="font-mono text-[12px] text-clay">{r.report_date}</span>
                    <span className="font-sans text-[14px] text-ink-soft">{eur(Number(r.revenue || 0))} · {Number(r.actual_covers || 0).toLocaleString("en-GB")} cov</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
      {!byVenue.length ? <p className="mt-8 font-sans text-[14px] text-clay">No end-of-day reports yet.</p> : null}

      <section className="mt-10">
        <p className="font-sans text-xs font-medium text-clay">Chart of accounts · {coa.length}</p>
        <ul className="mt-2 divide-y divide-black/10">
          {coa.map((a: any, i: number) => (
            <li key={i} className="flex items-baseline justify-between gap-4 py-2">
              <span className="font-sans text-[14px] text-ink">{a.label_en || a.label_es}</span>
              <span className="font-mono text-[11px] text-clay">{a.code}{a.direction ? " · " + a.direction : ""}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Holded sync + missing-invoice tracking arrive next</p>
    </main>
  );
}
