import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

function clip(s: string, n = 200) { s = (s || "").trim(); return s.length > n ? s.slice(0, n).trim() + "…" : s; }

export default async function Sops() {
  const plans = (await supabase.from("haccp_plans").select("plan_code,plan_name,status,responsible_role,description,review_frequency,next_review_due").order("plan_code")).data || [];
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Libro Azul · SOPs & HACCP</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">How we do it, correctly</h1>
      <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">The how-to that grounds the daily tasks. {plans.length} plans on record.</p>

      <div className="mt-8 space-y-4">
        {plans.map((p: any, i: number) => (
          <div key={i} className="rounded-2xl border border-black/10 bg-card p-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-serif text-2xl text-ink">{noEmoji(p.plan_name || "Untitled plan")}</h2>
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{p.status || ""}</span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-clay">{[p.plan_code, p.responsible_role, p.review_frequency].filter(Boolean).join(" · ")}</p>
            {p.description ? <p className="mt-3 font-sans text-[14px] leading-relaxed text-ink-soft">{clip(p.description)}</p> : null}
          </div>
        ))}
        {!plans.length ? <p className="font-sans text-[14px] text-clay">No SOPs recorded yet.</p> : null}
      </div>
    </main>
  );
}
