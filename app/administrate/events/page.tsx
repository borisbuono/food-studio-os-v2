import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

const ORDER = ["enquiry", "proposal", "confirmed", "completed", "cancelled"];
const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");

export default async function Events() {
  const evs = (await supabase.from("sales_events").select("title,event_type,status,client_name,event_date,guests_count,estimated_revenue,estimated_gp_pct,theme").order("event_date", { ascending: true })).data || [];
  const groups: Record<string, any[]> = {};
  evs.forEach((e: any) => { const k = (e.status || "other").toLowerCase(); (groups[k] ||= []).push(e); });
  const keys = Object.keys(groups).sort((a, b) => { const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate" className="font-sans text-sm text-ink-soft">← administrate</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Events · the pipeline</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Catering & private events</h1>

      {keys.map((k) => (
        <section key={k} className="mt-8">
          <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{k} · {groups[k].length}</p>
          <div className="mt-3 space-y-4">
            {groups[k].map((e: any, i: number) => (
              <div key={i} className="rounded-2xl border border-black/10 bg-card p-6">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-serif text-2xl text-ink">{noEmoji(e.title || e.event_type || "Event")}</h2>
                  <span className="font-mono text-[11px] text-clay">{e.event_date || ""}</span>
                </div>
                <p className="mt-1 font-sans text-[14px] text-ink-soft">{[e.client_name, e.guests_count ? e.guests_count + " guests" : "", e.theme].filter(Boolean).join(" · ")}</p>
                {(e.estimated_revenue || e.estimated_gp_pct) ? (
                  <p className="mt-3 font-mono text-[12px] text-clay">{e.estimated_revenue ? eur(Number(e.estimated_revenue)) + " est." : ""}{e.estimated_gp_pct ? " · " + Math.round(Number(e.estimated_gp_pct)) + "% GP" : ""}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}
      {!evs.length ? <p className="mt-8 font-sans text-[14px] text-clay">No events in the pipeline yet.</p> : null}
    </main>
  );
}
