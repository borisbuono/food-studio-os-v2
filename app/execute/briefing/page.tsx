import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Briefing() {
  const today = new Date().toISOString().slice(0, 10);
  const briefs = (await supabase.from("briefings").select("briefing_type,content,service_date,created_at,structured_content").order("service_date", { ascending: false }).limit(20)).data || [];
  const handover = briefs.find((b: any) => b.briefing_type === "handover" && (b.service_date === today || !b.service_date));
  const rest = briefs.filter((b: any) => b !== handover);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-6 font-sans text-xs font-medium text-basil">Briefing · the pass-down</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Before service</h1>

      {handover ? (
        <div className="mt-6 rounded-2xl border border-black/10 bg-card p-6">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-[11px] uppercase tracking-wide text-basil">From the close-down{handover.structured_content?.closed_by ? " · " + handover.structured_content.closed_by : ""}</span>
            <span className="font-mono text-[11px] text-clay">{handover.service_date || ""}</span>
          </div>
          {handover.content ? <p className="mt-3 whitespace-pre-line font-serif text-[17px] leading-relaxed text-ink">{String(handover.content)}</p> : null}
          {handover.structured_content ? (
            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-black/10 pt-4 sm:grid-cols-3">
              <Col title="Carried over" rows={handover.structured_content.carryover} empty="Nothing left open" />
              <Col title="Prep today" rows={handover.structured_content.tomorrow_prep} empty="None set" />
              <Col title="To buy" rows={handover.structured_content.shopping} empty="Nothing" />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8 space-y-4">
        {rest.map((b: any, i: number) => (
          <div key={i} className="rounded-2xl border border-black/10 bg-card p-6">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-[11px] uppercase tracking-wide text-basil">{b.briefing_type || "briefing"}</span>
              <span className="font-mono text-[11px] text-clay">{b.service_date || ""}</span>
            </div>
            {b.content ? <p className="mt-3 whitespace-pre-line font-serif text-[16px] leading-relaxed text-ink-soft">{String(b.content)}</p> : null}
          </div>
        ))}
        {!briefs.length ? <p className="font-sans text-[14px] text-clay">No briefings yet — run the close-down Pass and tomorrow’s opening briefing appears here.</p> : null}
      </div>
    </main>
  );
}

function Col({ title, rows, empty }: { title: string; rows?: string[]; empty: string }) {
  const list = Array.isArray(rows) ? rows : [];
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{title} · {list.length}</p>
      <ul className="mt-1 space-y-1">
        {list.length ? list.map((r, i) => <li key={i} className="font-sans text-[13px] text-ink-soft">{r}</li>) : <li className="font-sans text-[13px] text-clay">{empty}</li>}
      </ul>
    </div>
  );
}
