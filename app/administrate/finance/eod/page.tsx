import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");

export default async function EodList() {
  const venues = (await supabase.from("restaurants").select("id,name")).data || [];
  const vname = new Map(venues.map((v: any) => [v.id, v.name]));
  const eod = (await supabase.from("eod_reports").select("restaurant_id,report_date,actual_covers,revenue,revenue_food,revenue_wine,revenue_bar,eighty_six_notes,wastage_notes").order("report_date", { ascending: false }).limit(60)).data || [];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/finance" className="font-sans text-sm text-ink-soft">← finance</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">End-of-day reports</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{eod.length} reports</h1>

      <div className="mt-6 space-y-4">
        {eod.map((r: any, i: number) => (
          <div key={i} className="rounded-2xl border border-black/10 bg-card p-5">
            <div className="flex items-baseline justify-between">
              <span className="font-serif text-[18px] text-ink">{vname.get(r.restaurant_id) || "Venue"}</span>
              <span className="font-mono text-[11px] text-clay">{r.report_date}</span>
            </div>
            <p className="mt-1 font-sans text-[14px] text-ink-soft">{eur(Number(r.revenue || 0))} · {Number(r.actual_covers || 0).toLocaleString("en-GB")} covers</p>
            <p className="mt-1 font-mono text-[11px] text-clay">food {eur(Number(r.revenue_food || 0))} · wine {eur(Number(r.revenue_wine || 0))} · bar {eur(Number(r.revenue_bar || 0))}</p>
            {r.eighty_six_notes ? <p className="mt-2 font-sans text-[13px] text-ink-soft">86: {r.eighty_six_notes}</p> : null}
          </div>
        ))}
        {!eod.length ? <p className="font-sans text-[14px] text-clay">No reports yet.</p> : null}
      </div>
    </main>
  );
}
