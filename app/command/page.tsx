import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Command() {
  
  const supabase = supabaseServer();const flags = (await supabase.from("review_flags").select("flag_type,description,skill_category,resolved,created_at").order("resolved").order("created_at", { ascending: false })).data || [];
  const entities = await supabase.from("entities").select("*", { count: "exact", head: true });
  const coa = await supabase.from("chart_of_accounts").select("*", { count: "exact", head: true });
  const skills = await supabase.from("agent_skills").select("*", { count: "exact", head: true }).eq("is_active", true);
  const open = flags.filter((f: any) => !f.resolved);

  const tiles = [
    { href: "/administrate/holdings", label: "Entities", n: entities.count ?? 0 },
    { href: "/administrate/finance", label: "Accounts", n: coa.count ?? 0 },
    { href: "/administrate/settings", label: "Skills", n: skills.count ?? 0 },
  ];

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ink-soft">Command center</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">The control room</h1>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="rounded-2xl border border-line bg-card p-4 text-center transition hover:border-line">
            <p className="font-serif text-2xl text-ink">{t.n}</p>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{t.label}</p>
          </Link>
        ))}
      </div>

      <section className="mt-8">
        <p className="font-sans text-xs font-medium text-clay">Review flags · {open.length} open</p>
        <ul className="mt-2 divide-y divide-black/10 border-t border-black/10">
          {flags.map((f: any, i: number) => (
            <li key={i} className="py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-serif text-[16px] text-ink">{noEmoji(f.flag_type || "Flag")}</span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{f.resolved ? "resolved" : f.skill_category || "open"}</span>
              </div>
              {f.description ? <p className="mt-1 font-sans text-[14px] leading-relaxed text-ink-soft">{f.description}</p> : null}
            </li>
          ))}
          {!flags.length ? <p className="py-3 font-sans text-[14px] text-clay">No flags.</p> : null}
        </ul>
      </section>

      <section className="mt-8">
        <p className="font-sans text-xs font-medium text-clay">Activity</p>
        <p className="mt-2 font-sans text-[14px] text-ink-soft">The live activity feed (audit log + agent calls) appears here once the system is logging events.</p>
      </section>
    </main>
  );
}
