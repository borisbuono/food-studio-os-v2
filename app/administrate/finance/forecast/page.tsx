import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export default async function Forecast() {
  const venues = (await supabase.from("restaurants").select("id,name").order("name")).data || [];
  const eod = (await supabase.from("eod_reports").select("restaurant_id,report_date,revenue,actual_covers,revenue_labour").order("report_date", { ascending: false })).data || [];

  const byVenue = venues
    .map((v: any) => ({ ...v, rs: eod.filter((e: any) => e.restaurant_id === v.id) }))
    .filter((x: any) => x.rs.length >= 1);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/finance" className="font-sans text-sm text-ochre">← finance</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Forecast · next period</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Where the numbers point</h1>
      <p className="mt-3 font-sans text-[15px] leading-relaxed text-ink-soft">A read on the trend from your end-of-day reports, a simple projection for the next period, and a labour budget to hold margin. The CFO view explains the move, it doesn’t just show it.</p>

      {byVenue.map((v: any) => {
        const L = v.rs[0], P = v.rs[1];
        const rev = Number(L.revenue || 0), cov = Number(L.actual_covers || 0);
        const avg = cov ? rev / cov : 0;
        const pRev = P ? Number(P.revenue || 0) : 0, pCov = P ? Number(P.actual_covers || 0) : 0;
        const pAvg = pCov ? pRev / pCov : 0;
        const revTrend = pRev ? (rev / pRev - 1) : 0;
        const covTrend = pCov ? (cov / pCov - 1) : 0;
        const proj = rev * (1 + clamp(revTrend, -0.2, 0.2));
        const labourActual = L.revenue_labour ? Number(L.revenue_labour) / rev : null;
        const labourBudget = proj * 0.30;

        let read = "Not enough history yet to read a trend.";
        if (P) {
          const dirR = revTrend >= 0.02 ? "up" : revTrend <= -0.02 ? "down" : "flat";
          const dirA = pAvg ? (avg / pAvg - 1) : 0;
          if (dirR === "up" && covTrend > 0.02 && Math.abs(dirA) < 0.02) read = "Growth is coming from volume — more covers at a steady average spend. Protect the experience and watch labour scales with the room.";
          else if (dirR === "up" && dirA > 0.02) read = "Revenue and average spend both up — you're selling more and selling better. The menu work is landing.";
          else if (dirR === "down") read = "Revenue softened versus the prior period — check covers vs. average spend below to see whether it's footfall or basket size, and hold labour to budget.";
          else read = "Broadly flat period over period — stable, but no momentum. A menu-engineering push on the puzzles could move it.";
        }

        return (
          <section key={v.id} className="mt-8 rounded-2xl border border-black/10 bg-card p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-2xl text-ink">{v.name}</h2>
              <span className="font-mono text-[11px] text-clay">from {L.report_date}</span>
            </div>
            <p className="mt-3 font-serif text-3xl text-ink">{eur(proj)} <span className="font-sans text-[14px] text-ink-soft">projected</span></p>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">last {eur(rev)} · {cov.toLocaleString("en-GB")} covers · {eur(avg)} avg{P ? " · " + (revTrend >= 0 ? "up " : "down ") + Math.abs(Math.round(revTrend * 100)) + "% vs prior" : ""}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div><p className="font-serif text-xl text-ink">{eur(labourBudget)}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Labour budget · 30%</p></div>
              <div><p className={"font-serif text-xl " + (labourActual != null && labourActual <= 0.32 ? "text-olive" : "text-ember")}>{labourActual != null ? Math.round(labourActual * 100) + "%" : "—"}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Labour last period</p></div>
            </div>
            <p className="mt-4 font-serif text-[16px] leading-relaxed text-ink-soft">{read}</p>
          </section>
        );
      })}
      {!byVenue.length ? <p className="mt-8 font-sans text-[14px] text-clay">No end-of-day reports to forecast from yet.</p> : null}
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Simple trend projection · a demand model (weather, events, day-part) is the next step — partner-grade, not guesswork</p>
    </main>
  );
}
