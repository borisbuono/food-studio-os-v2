import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Briefing() {
  const briefs = (await supabase.from("briefings").select("briefing_type,content,service_date,created_at").order("service_date", { ascending: false })).data || [];
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Briefing · who's doing what</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Before service</h1>

      <div className="mt-8 space-y-4">
        {briefs.map((b: any, i: number) => (
          <div key={i} className="rounded-2xl border border-black/10 bg-card p-6">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ember">{b.briefing_type || "briefing"}</span>
              <span className="font-mono text-[11px] text-clay">{b.service_date || ""}</span>
            </div>
            {b.content ? <p className="mt-3 whitespace-pre-line font-serif text-[16px] leading-relaxed text-ink-soft">{String(b.content)}</p> : null}
          </div>
        ))}
        {!briefs.length ? <p className="font-sans text-[14px] text-clay">No briefings yet — the morning division of work will appear here.</p> : null}
      </div>
    </main>
  );
}
