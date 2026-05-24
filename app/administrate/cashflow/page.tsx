import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");

export default async function CashFlow() {
  const venues = (await supabase.from("restaurants").select("id,name").order("name")).data || [];
  const eod = (await supabase.from("eod_reports").select("restaurant_id,report_date,revenue,revenue_labour").order("report_date", { ascending: false })).data || [];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/finance" className="font-sans text-sm text-ink-soft">← finance</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Cash flow</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Money in</h1>

      {venues.map((v: any) => {
        const rs = eod.filter((e: any) => e.restaurant_id === v.id).slice(0, 6);
        if (!rs.length) return null;
        return (
          <section key={v.id} className="mt-8">
            <h2 className="font-serif text-2xl text-ink">{v.name}</h2>
            <ul className="mt-3 divide-y divide-black/10 border-t border-black/10">
              {rs.map((r: any, i: number) => (
                <li key={i} className="flex items-baseline justify-between py-2">
                  <span className="font-mono text-[12px] text-clay">{r.report_date}</span>
                  <span className="font-sans text-[14px] text-ink-soft">{eur(Number(r.revenue || 0))} in{r.revenue_labour ? " · " + eur(Number(r.revenue_labour)) + " labour" : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Bank outflows + reconciled balance connect when Holded is synced</p>
    </main>
  );
}
