import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Execute() {
  const tasks = await supabase.from("tasks").select("*", { count: "exact", head: true }).eq("is_active", true);
  const mep = await supabase.from("mep_dishes").select("*", { count: "exact", head: true }).eq("is_active", true);
  const cards = [
    { kicker: "Today", title: "Today\u2019s priorities", blurb: "Clock in, your 4\u20135 priority preps, covers & special diets.", soon: true },
    { kicker: "Prep \u00b7 MEP", title: (mep.count ?? 0) + " prep dishes", blurb: "Mise en place by station, checkable.", soon: true },
    { kicker: "Cleaning", title: (tasks.count ?? 0) + " tasks", blurb: "Daily / weekly / monthly, by station + dishwasher.", soon: true },
  ];
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">\u2190 home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Execute \u00b7 service</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">The daily loop</h1>
      <div className="mt-8 space-y-4">
        {cards.map((c, n) => (
          <div key={n} className="rounded-2xl border border-black/10 bg-card p-6">
            <div className="flex items-center justify-between">
              <p className="font-sans text-xs font-medium text-ember">{c.kicker}</p>
              {c.soon ? <span className="font-mono text-[10px] uppercase tracking-wide text-clay">building next</span> : null}
            </div>
            <h2 className="mt-1 font-serif text-2xl text-ink">{c.title}</h2>
            <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">{c.blurb}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
