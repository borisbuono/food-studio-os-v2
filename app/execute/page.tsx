import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Execute() {
  const tasks = await supabase.from("tasks").select("*", { count: "exact", head: true }).eq("is_active", true).eq("task_type", "cleaning");
  const mep = await supabase.from("mep_dishes").select("*", { count: "exact", head: true }).eq("is_active", true);
  const sops = await supabase.from("haccp_plans").select("*", { count: "exact", head: true });
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Execute · service</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">The daily loop</h1>
      <div className="mt-8 space-y-4">
        <Link href="/execute/today" className="block rounded-2xl border border-black/10 bg-card p-6 transition hover:border-ember/40">
          <p className="font-sans text-xs font-medium text-ember">Today</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">Today’s priorities</h2>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">Your 4–5 priority preps, covers & cleaning due today.</p>
        </Link>
        <Link href="/execute/prep" className="block rounded-2xl border border-black/10 bg-card p-6 transition hover:border-ember/40">
          <p className="font-sans text-xs font-medium text-ember">Prep · MEP</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">{mep.count ?? 0} prep dishes</h2>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">Mise en place by station, with components.</p>
        </Link>
        <Link href="/execute/cleaning" className="block rounded-2xl border border-black/10 bg-card p-6 transition hover:border-ember/40">
          <p className="font-sans text-xs font-medium text-ember">Cleaning</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">{tasks.count ?? 0} cleaning tasks</h2>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">Daily & weekly schedule, by station.</p>
        </Link>
        <Link href="/execute/sops" className="block rounded-2xl border border-black/10 bg-card p-6 transition hover:border-ember/40">
          <p className="font-sans text-xs font-medium text-ember">Libro Azul · SOPs</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">{sops.count ?? 0} plans</h2>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">HACCP plans and how-to that ground the tasks.</p>
        </Link>
        <Link href="/execute/briefing" className="block rounded-2xl border border-black/10 bg-card p-6 transition hover:border-ember/40">
          <p className="font-sans text-xs font-medium text-ember">Briefing</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">Before service</h2>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">The morning division of work — who's doing what.</p>
        </Link>
      </div>
    </main>
  );
}
